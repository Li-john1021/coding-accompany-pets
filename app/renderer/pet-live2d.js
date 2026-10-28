// pet-live2d.js — 通用 Live2D / BongoCat 皮肤渲染
//
// 核心约定（与 BongoCat 一致）：
//   - 模型 model3.json 的 canvasinfo 就是整张皮肤的原生画布；
//   - background.png、resources/*-keys/*.png 都是和画布同尺寸的整页图；
//   - 所有图层必须共用同一套 sceneRoot 变换，绝不能一层 contain、一层 cover。
//
// 兼容策略：
//   - 有 background 就叠底图；没有就用模型自身画布；
//   - 自动量出模型/底图/键帽的可见包围盒，裁掉透明边（可用 opts.scene 覆盖）；
//   - 运行时探测参数：左右手、鼠标、嘴、眼球、身体、呼吸，只驱动存在的参数；
//   - 没有手参数就只亮键帽；没有键帽就只做头/眼/呼吸；标准模型也能单独站立。
(function () {
  const canvas = document.getElementById('l2d');
  const stageEl = document.getElementById('stage');

  const BASE_STAGE_W = 360;
  const MAX_STAGE_H = 440;
  const DEFAULT_STAGE = { w: 284, h: 164 };
  const CHROME_H = 142;

  const BEHAVIOR = {
    idle:         { tap: 0,   head: 'calm',   mouth: 'idle' },
    listening:    { tap: 0,   head: 'listen', mouth: 'loud' },
    transcribing: { tap: 3.2, head: 'calm',   mouth: 'soft' },
    structuring:  { tap: 3.0, head: 'calm',   mouth: 'soft' },
    optimizing:   { tap: 3.0, head: 'calm',   mouth: 'soft' },
    polishing:    { tap: 2.6, head: 'calm',   mouth: 'soft' },
    inserting:    { tap: 8,   head: 'nod',    mouth: 'soft' },
    processing:   { tap: 1.5, head: 'calm',   mouth: 'soft' },
    typing:       { tap: 8,   head: 'nod',    mouth: 'soft' },
    done:         { tap: 7,   head: 'nod',    mouth: 'idle' },
    error:        { tap: 0,   head: 'shake',  mouth: 'idle' }
  };

  let app = null;
  let model = null;
  let sceneRoot = null;
  let bgSprite = null;
  let sceneRect = null;
  let skinMode = 'keyboard';
  let skinName = '';
  const keyPool = [];
  let letterPool = [];
  let leftPool = [];
  let rightPool = [];
  let lastKeySide = '';
  let stageSize = { ...DEFAULT_STAGE };

  let loud = 0, loudTarget = 0;
  let mouth = 0;
  let state = 'idle', clock = 0, tapT = 0, lastBeat = -1;
  let tapRate = 0, tapJitterAt = 0;
  let ax = 0, ay = 0, az = 0;
  let override = null;
  let mouse = { x: 0, y: 0, has: false };
  let lastError = '';

  let P = null;
  const cap = {
    angle: false, eyeBall: false, body: false, breath: false,
    leftHand: false, rightHand: false,
    mouse: false, mouseBtn: false,
    mouth: '', mouthForm: false
  };

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function buildParamAccess(core) {
    const cache = new Map();
    const complained = new Set();
    const info = (id) => {
      if (!cache.has(id)) {
        let m = null;
        try {
          const i = core.getParameterIndex(id);
          if (i >= 0 && i < core.getParameterCount()) {
            m = {
              i,
              min: core.getParameterMinimumValue(i),
              max: core.getParameterMaximumValue(i),
              def: core.getParameterDefaultValue(i)
            };
          }
        } catch { m = null; }
        cache.set(id, m);
      }
      return cache.get(id);
    };
    const complain = (id) => {
      if (complained.has(id)) return;
      complained.add(id);
      console.warn('[live2d] 参数不存在，跳过：' + id);
    };
    return {
      info,
      has(id) { return !!info(id); },
      raw(id, v) {
        const m = info(id); if (!m) return complain(id);
        core.setParameterValueByIndex(m.i, clamp(v, m.min, m.max));
      },
      /** t: 0..1 映射到参数真实范围 */
      norm(id, t) {
        const m = info(id); if (!m) return complain(id);
        core.setParameterValueByIndex(m.i, m.min + (m.max - m.min) * clamp(t, 0, 1));
      },
      /** 角度类：-30..30 度映射到参数真实范围 */
      angle(id, deg) {
        const m = info(id); if (!m) return complain(id);
        const t = (clamp(deg, -30, 30) + 30) / 60;
        core.setParameterValueByIndex(m.i, m.min + (m.max - m.min) * t);
      },
      /** 对称量：-1..1 映射到参数真实范围 */
      signed(id, v) {
        const m = info(id); if (!m) return complain(id);
        const t = (clamp(v, -1, 1) + 1) / 2;
        core.setParameterValueByIndex(m.i, m.min + (m.max - m.min) * t);
      }
    };
  }

  function probeCaps() {
    cap.angle = P.has('ParamAngleX') || P.has('ParamAngleY') || P.has('ParamAngleZ');
    cap.eyeBall = P.has('ParamEyeBallX') || P.has('ParamEyeBallY');
    cap.body = P.has('ParamBodyAngleX') || P.has('ParamBodyAngleY') || P.has('ParamBodyAngleZ');
    cap.breath = P.has('ParamBreath');
    cap.leftHand = P.has('CatParamLeftHandDown');
    cap.rightHand = P.has('CatParamRightHandDown');
    cap.mouse = P.has('ParamMouseX') || P.has('ParamMouseY');
    cap.mouseBtn = P.has('ParamMouseLeftDown') || P.has('ParamMouseRightDown');
    cap.mouth = P.has('ParamMouthOpenY') ? 'ParamMouthOpenY' : (P.has('ParamMouthOpen') ? 'ParamMouthOpen' : '');
    cap.mouthForm = P.has('ParamMouthForm');
    console.log('[live2d] CAP ' + JSON.stringify(cap));
  }

  function cubismCoreVersion() {
    try {
      const Version = window.Live2DCubismCore && window.Live2DCubismCore.Version;
      const v = Version && Version.csmGetVersion && Version.csmGetVersion();
      if (typeof v === 'number') return `${v >>> 24}.${(v >> 16) & 255}.${v & 65535}`;
      if (typeof v === 'string') return v;
    } catch { /* 老核心没有 Version API */ }
    return '';
  }

  /** MOC3 v6（Cubism 5-r.5 之后）需要 Core 6.0.1+；提前给出可读错误 */
  async function ensureCoreSupportsModel(url) {
    const cv = cubismCoreVersion();
    const major = parseInt(cv, 10);
    if (!Number.isFinite(major) || major >= 6) return;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const json = await resp.json();
      const moc = json && json.FileReferences && json.FileReferences.Moc;
      if (!moc) return;
      const mocUrl = new URL(moc, url).href;
      const r = await fetch(mocUrl);
      if (!r.ok) return;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length < 8) return;
      const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      if (magic !== 'MOC3') return;
      const ver = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
      if (ver >= 6) {
        throw new Error(`该皮肤是 MOC3 v${ver}，当前 Cubism Core ${cv || '未知'} 太旧；请换用 Cubism 5-r.5（Core 6.0.1）或更高版本的 live2dcubismcore.min.js。`);
      }
    } catch (e) {
      if (/MOC3 v/.test(String(e.message || e))) throw e;
      // 读不到版本就交给模型加载器报原始错误
    }
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败 ' + url));
      img.src = url;
    });
  }

  function imageSize(img) {
    return { w: img.naturalWidth || img.width || 1, h: img.naturalHeight || img.height || 1 };
  }

  /** 2D canvas 采样不透明包围盒；maxDim 用于限制分析分辨率 */
  function imageAlphaBBox(img, maxDim = 1024) {
    const { w, h } = imageSize(img);
    const k = Math.min(1, maxDim / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k));
    const ch = Math.max(1, Math.round(h * k));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    const d = ctx.getImageData(0, 0, cw, ch).data;
    let minX = cw, minY = ch, maxX = -1, maxY = -1;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (d[(y * cw + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return {
      x: minX / k, y: minY / k,
      w: (maxX + 1 - minX) / k, h: (maxY + 1 - minY) / k
    };
  }

  function unionRect(rects) {
    const valid = rects.filter((r) => r && r.w > 0 && r.h > 0);
    if (!valid.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of valid) {
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function clampRect(rect, w, h) {
    const x = clamp(rect.x, 0, w);
    const y = clamp(rect.y, 0, h);
    return {
      x,
      y,
      w: clamp(rect.w, 1, w - x),
      h: clamp(rect.h, 1, h - y)
    };
  }

  /** 渲染一帧模型，读回 alpha 包围盒；大画布会降采样 */
  function modelBBox(nw, nh) {
    const maxDim = 2048;
    const k = Math.min(1, maxDim / Math.max(nw, nh));
    const a = Math.max(1, Math.round(nw * k));
    const b = Math.max(1, Math.round(nh * k));
    const prevScale = model.scale.x;
    const prevX = model.x, prevY = model.y;
    try {
      app.renderer.resize(a, b);
      sceneRoot.scale.set(1);
      sceneRoot.position.set(0, 0);
      model.scale.set(k);
      model.x = 0; model.y = 0;
      if (bgSprite) bgSprite.visible = false;
      for (const key of keyPool) key.sp.visible = false;
      try { model.update(0); } catch { /* 旧版本没有 update 也不影响 */ }
      app.render();
      // 直接读主画布：pixi 的 extract.pixels 在部分 Live2D 模型上会抛错
      const view = app.view;
      const pw = view.width || app.renderer.width;
      const ph = view.height || app.renderer.height;
      const c2 = document.createElement('canvas');
      c2.width = pw; c2.height = ph;
      const ctx = c2.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(view, 0, 0);
      const data = ctx.getImageData(0, 0, pw, ph).data;
      let minX = pw, minY = ph, maxX = -1, maxY = -1;
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          if (data[(y * pw + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return null;
      const res = (app.renderer.resolution || 1) * k;
      return {
        x: minX / res, y: minY / res,
        w: (maxX + 1 - minX) / res,
        h: (maxY + 1 - minY) / res
      };
    } catch (e) {
      console.warn('[live2d] 模型包围盒分析失败：' + (e.message || e) + ' | ' + (e.stack || ''));
      return null;
    } finally {
      try {
        model.scale.set(prevScale);
        model.x = prevX; model.y = prevY;
        if (bgSprite) bgSprite.visible = true;
        for (const key of keyPool) key.sp.visible = key.active;
      } catch { /* 模型已销毁时忽略 */ }
    }
  }

  function chooseScene(nw, nh, bgImg, keyImages, savedScene) {
    if (savedScene && Number.isFinite(savedScene.x) && Number.isFinite(savedScene.y)) {
      const r = clampRect(savedScene, nw, nh);
      if (r.w >= 8 && r.h >= 8) return r;
    }
    const rects = [];
    const mb = modelBBox(nw, nh);
    if (mb) rects.push(mb);
    if (bgImg) rects.push(imageAlphaBBox(bgImg, 1024));
    for (const img of keyImages.slice(0, 6)) rects.push(imageAlphaBBox(img, 512));
    const u = unionRect(rects);
    if (!u) return { x: 0, y: 0, w: nw, h: nh };
    const pad = Math.max(6, Math.min(u.w, u.h) * 0.03);
    const padded = clampRect({ x: u.x - pad, y: u.y - pad, w: u.w + pad * 2, h: u.h + pad * 2 }, nw, nh);
    // 几乎占满画布时不做无意义的裁边
    if (padded.w > nw * 0.92 && padded.h > nh * 0.92) return { x: 0, y: 0, w: nw, h: nh };
    return padded;
  }

  function computeStage(rect) {
    let w = BASE_STAGE_W;
    let h = w * rect.h / rect.w;
    if (h > MAX_STAGE_H) {
      h = MAX_STAGE_H;
      w = h * rect.w / rect.h;
    }
    return {
      w: Math.round(clamp(w, 180, 720)),
      h: Math.round(clamp(h, 110, 720))
    };
  }

  function applyBodySize(stageW, stageH, notify = true) {
    stageSize = { w: stageW, h: stageH };
    stageEl.style.width = stageW + 'px';
    stageEl.style.height = stageH + 'px';
    canvas.style.width = stageW + 'px';
    canvas.style.height = stageH + 'px';
    const bodyW = Math.max(300, stageW + 16);
    const bodyH = stageH + CHROME_H;
    document.body.style.width = bodyW + 'px';
    document.body.style.height = bodyH + 'px';
    try {
      const status = document.getElementById('status');
      const actions = document.getElementById('action-row');
      const rowW = Math.min(284, stageW);
      if (status) status.style.width = rowW + 'px';
      if (actions) actions.style.width = rowW + 'px';
    } catch { /* ignore */ }
    if (app && app.renderer) app.renderer.resize(stageW, stageH);
    if (notify && window.v2p && window.v2p.petContentSize) {
      window.v2p.petContentSize(bodyW, bodyH).catch(() => {});
    }
  }

  function applySceneTransform() {
    if (!sceneRoot || !sceneRect) return;
    const scale = Math.min(stageSize.w / sceneRect.w, stageSize.h / sceneRect.h);
    sceneRoot.scale.set(scale);
    sceneRoot.position.set(
      (stageSize.w - sceneRect.w * scale) / 2 - sceneRect.x * scale,
      (stageSize.h - sceneRect.h * scale) / 2 - sceneRect.y * scale
    );
  }

  function resetLayout() {
    applyBodySize(DEFAULT_STAGE.w, DEFAULT_STAGE.h);
    stageEl.classList.remove('live2d');
  }

  async function loadKeyCaps(baseUrl) {
    keyPool.length = 0; letterPool = []; leftPool = []; rightPool = [];
    let caps = { keys: [], letters: [], left: [], right: [] };
    try { caps = await window.v2p.keyCaps(); } catch { return []; }
    const all = (caps.letters && caps.letters.length) ? caps.letters : (caps.keys || []);
    const rels = [];
    const seen = new Set();
    for (const rel of all.concat(caps.keys || [])) {
      if (!rel || seen.has(rel)) continue;
      seen.add(rel);
      rels.push(rel);
      if (rels.length >= 28) break;
    }
    const imgs = [];
    for (const rel of rels) {
      try {
        const img = await loadImage(baseUrl + rel);
        const ratio = alphaRatio(img);
        // 整页装饰图（几乎铺满整张画布）不要，键帽/气泡/小手都是小面积
        if (ratio > 0.45) continue;
        const sp = new PIXI.Sprite(PIXI.Texture.from(img));
        sp.anchor.set(0, 0);
        sp.scale.set(1);
        sp.alpha = 0;
        sp.visible = false;
        const base = rel.split('/').pop().replace(/\.[^.]+$/, '');
        const side = rel.includes('/right-keys/') ? 'right' : 'left';
        const entry = { sp, rel, base, side, active: false, a: 0, decay: 0.2 };
        keyPool.push(entry);
        if (/^Key[A-Z]$/i.test(base) || /^Num[0-9]$/i.test(base) || /^Digit[0-9]$/i.test(base)) letterPool.push(entry);
        (side === 'right' ? rightPool : leftPool).push(entry);
        imgs.push(img);
      } catch { /* 单张失败忽略 */ }
    }
    if (!letterPool.length) letterPool = keyPool.slice();
    console.log('[live2d] keycaps=' + keyPool.length + ' letters=' + letterPool.length + ' imgs=' + imgs.length);
    return imgs;
  }

  function alphaRatio(img) {
    const { w, h } = imageSize(img);
    const k = Math.min(1, 128 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * k));
    const ch = Math.max(1, Math.round(h * k));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    const d = ctx.getImageData(0, 0, cw, ch).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n / (cw * ch);
  }

  /**
   * Cubism Core 6.0.1 把 getDrawableRenderOrders 变成了空返回值；
   * pixi-live2d-display 0.4/0.5 仍按旧 API 遍历，导致 doDrawModel 崩。
   * 这里用 drawables.drawOrders（或顺序索引）补上，兼容新旧 Core。
   */
  function patchCoreCompat(live2dModel) {
    try {
      const cm = live2dModel && live2dModel.internalModel && live2dModel.internalModel.coreModel;
      if (!cm) return;
      let orders = null;
      try { orders = typeof cm.getDrawableRenderOrders === 'function' ? cm.getDrawableRenderOrders() : null; } catch { orders = null; }
      if (orders && typeof orders.length === 'number') return;
      const modelData = cm.getModel && cm.getModel();
      const fallback = (modelData && modelData.renderOrders)
        || (modelData && modelData.drawables && modelData.drawables.drawOrders)
        || Array.from({ length: typeof cm.getDrawableCount === 'function' ? cm.getDrawableCount() : 0 }, (_, i) => i);
      cm.getDrawableRenderOrders = () => fallback;
      console.log('[live2d] patched getDrawableRenderOrders for Cubism Core 6');
    } catch (e) {
      console.warn('[live2d] Core 兼容补丁失败：' + (e.message || e));
    }
  }

  async function loadModel(url, opts = {}) {
    unload();
    skinMode = opts.mode || 'keyboard';
    skinName = opts.name || '';
    if (!window.PIXI || !window.PIXI.live2d || !window.live2dcubismcore) {
      console.warn('[live2d] 运行时未加载');
      return false;
    }
    if (!url) return false;
    const baseUrl = opts.baseUrl || url.slice(0, url.lastIndexOf('/') + 1);
    lastError = '';
    try {
      await ensureCoreSupportsModel(url);
      if (!app) {
        app = new PIXI.Application({
          view: canvas,
          width: DEFAULT_STAGE.w,
          height: DEFAULT_STAGE.h,
          backgroundAlpha: 0,
          antialias: true,
          autoStart: false,
          autoDensity: true,
          preserveDrawingBuffer: true,
          resolution: Math.min(2, window.devicePixelRatio || 1)
        });
        app.ticker.maxFPS = 30;
        app.ticker.add(() => tick(app.ticker.deltaMS / 1000), -100);
      }
      applyBodySize(DEFAULT_STAGE.w, DEFAULT_STAGE.h, false);

      model = await PIXI.live2d.Live2DModel.from(url);
      patchCoreCompat(model);
      const nw = Math.round((model.internalModel && model.internalModel.width) || model.width || 1024);
      const nh = Math.round((model.internalModel && model.internalModel.height) || model.height || 1024);

      sceneRoot = new PIXI.Container();
      sceneRoot.sortableChildren = false;
      app.stage.addChild(sceneRoot);

      // 背景：有就加，没有就只靠模型自身
      let bgImg = null;
      try {
        bgImg = await loadImage(baseUrl + 'resources/background.png');
        bgSprite = new PIXI.Sprite(PIXI.Texture.from(bgImg));
        bgSprite.anchor.set(0, 0);
        const bs = imageSize(bgImg);
        // 背景和模型画布理论上同尺寸；不同尺寸时按 cover 铺到模型画布
        const s = Math.max(nw / bs.w, nh / bs.h);
        bgSprite.scale.set(s);
        bgSprite.x = (nw - bs.w * s) / 2;
        bgSprite.y = (nh - bs.h * s) / 2;
        sceneRoot.addChild(bgSprite);
      } catch {
        bgSprite = null;
        console.warn('[live2d] 无 background，使用模型自带场景');
      }

      model.anchor.set(0, 0);
      model.scale.set(1);
      model.x = 0; model.y = 0;
      sceneRoot.addChild(model);

      const keyImgs = await loadKeyCaps(baseUrl);
      for (const k of keyPool) sceneRoot.addChild(k.sp);

      sceneRect = chooseScene(nw, nh, bgImg, keyImgs, opts.scene);
      const st = computeStage(sceneRect);
      applyBodySize(st.w, st.h);
      applySceneTransform();
      if (!opts.scene && window.v2p && window.v2p.skinSceneSave) {
        window.v2p.skinSceneSave(skinName, sceneRect).catch(() => {});
      }

      P = buildParamAccess(model.internalModel.coreModel);
      probeCaps();
      stageEl.classList.add('live2d');
      app.start();
      console.log('[live2d] loaded ' + url + ' canvas=' + nw + 'x' + nh
        + ' scene=' + JSON.stringify(sceneRect) + ' stage=' + st.w + 'x' + st.h
        + ' mode=' + skinMode + ' keys=' + keyPool.length);
      return true;
    } catch (e) {
      lastError = String(e && e.message || e);
      if (/Unknown error/i.test(lastError)) {
        lastError = '模型加载失败：' + lastError + '（常见原因是 Cubism Core 版本过旧；MOC3 v6 需要 Core 6.0.1+ / Cubism 5-r.5）';
      }
      console.error('[live2d] 模型加载失败:', e);
      unload();
      resetLayout();
      return false;
    }
  }

  function unload() {
    if (app) {
      app.stop();
      if (sceneRoot) {
        for (const k of keyPool) {
          try { k.sp.destroy({ texture: true, baseTexture: true }); } catch { /* ignore */ }
        }
        try { sceneRoot.destroy({ children: true }); } catch { /* ignore */ }
      }
    }
    try { if (model) model.destroy(); } catch { /* ignore */ }
    model = null; sceneRoot = null; bgSprite = null; sceneRect = null;
    keyPool.length = 0; letterPool = []; leftPool = []; rightPool = [];
    P = null;
    tapT = 0; lastBeat = -1; tapRate = 0; mouth = 0;
    Object.assign(cap, {
      angle: false, eyeBall: false, body: false, breath: false,
      leftHand: false, rightHand: false, mouse: false, mouseBtn: false,
      mouth: '', mouthForm: false
    });
    stageEl.classList.remove('live2d');
  }

  function popKey() {
    const src = letterPool.length ? letterPool : keyPool;
    if (!src.length) return null;
    const free = src.filter((k) => !k.active);
    const pool = free.length ? free : src;
    const k = pool[(Math.random() * pool.length) | 0];
    if (!k) return null;
    k.active = true;
    k.a = 0.78 + Math.random() * 0.18;
    k.decay = 0.2 + Math.random() * 0.16;
    k.sp.visible = true;
    lastKeySide = k.side;
    return k;
  }

  function tick(dt) {
    if (!model || !P) return;
    clock += dt;
    const bh = BEHAVIOR[state] || BEHAVIOR.idle;

    if (bh.tap > 0) {
      if (clock >= tapJitterAt) {
        tapRate = bh.tap * (0.55 + Math.random() * 1.1);
        tapJitterAt = clock + 0.35 + Math.random() * 0.55;
      }
    } else {
      tapRate = 0;
    }

    loud += (loudTarget - loud) * (loudTarget > loud ? 0.35 : 0.10);
    loudTarget *= 0.88;

    // ---- 头部：状态动作 + 鼠标跟随 ----
    if (bh.head === 'listen') {
      ax = Math.sin(clock * 2.1) * (4 + loud * 16);
      ay = -loud * 10 + Math.sin(clock * 1.3) * 2;
      az = Math.sin(clock * 0.9) * (3 + loud * 9);
    } else if (bh.head === 'nod') {
      ax = 0; ay = Math.abs(Math.sin(clock * 6.5)) * 12; az = Math.sin(clock * 1.1) * 3;
    } else if (bh.head === 'shake') {
      ax = Math.sin(clock * 9) * 15; ay = 0; az = Math.sin(clock * 9) * 6;
    } else {
      ax = Math.sin(clock * 0.5) * 4; ay = Math.sin(clock * 0.8) * 2; az = Math.sin(clock * 0.7) * 5;
    }

    let mx = 0, my = 0;
    if (mouse.has) {
      mx = clamp(mouse.x, -1, 1);
      my = clamp(mouse.y, -1, 1);
    }
    P.angle('ParamAngleX', ax + mx * 12);
    P.angle('ParamAngleY', ay - my * 8);
    P.angle('ParamAngleZ', az + mx * 3);

    if (cap.eyeBall) {
      const eyeX = bh.head === 'listen' ? 0 : Math.sin(clock * 0.6) * 0.35 + mx * 0.45;
      const eyeY = bh.head === 'listen' ? -0.1 : Math.sin(clock * 0.9) * 0.2 - my * 0.35;
      P.signed('ParamEyeBallX', eyeX);
      P.signed('ParamEyeBallY', eyeY);
    }
    if (cap.body) {
      P.angle('ParamBodyAngleX', ax * 0.25 + mx * 3);
      P.angle('ParamBodyAngleY', ay * 0.2 - my * 2);
      P.angle('ParamBodyAngleZ', az * 0.4 + mx * 2);
    }
    if (cap.breath) P.norm('ParamBreath', 0.5 + 0.5 * Math.sin(clock * 1.4));
    if (cap.mouse) {
      P.signed('ParamMouseX', mx);
      P.signed('ParamMouseY', -my);
    }

    // ---- 嘴：听的时候跟着音量开合，其它状态轻微 ----
    let mouthTarget = 0;
    if (bh.mouth === 'loud') mouthTarget = clamp(loud * 0.9 + 0.04, 0, 1);
    else if (bh.mouth === 'soft') mouthTarget = 0.06 + 0.04 * Math.abs(Math.sin(clock * 2.2));
    mouth += (mouthTarget - mouth) * 0.25;
    if (cap.mouth) P.norm(cap.mouth, mouth);

    // ---- 敲击：手 / 鼠标键 / 键帽 ----
    const typing = bh.tap > 0;
    if (typing) {
      tapT += dt * tapRate;
      const ph = tapT % 1;
      const pr = (tapT + 0.5) % 1;
      if (cap.leftHand && cap.rightHand) {
        P.norm('CatParamLeftHandDown', ph < 0.5 ? 1 : 0);
        P.norm('CatParamRightHandDown', pr < 0.5 ? 1 : 0);
      } else if (cap.leftHand) {
        P.norm('CatParamLeftHandDown', ph < 0.5 ? 1 : 0);
      } else if (cap.rightHand) {
        P.norm('CatParamRightHandDown', ph < 0.5 ? 1 : 0);
      }
      if (cap.mouseBtn) {
        if (P.has('ParamMouseLeftDown')) P.norm('ParamMouseLeftDown', ph < 0.5 ? 1 : 0);
        if (P.has('ParamMouseRightDown')) P.norm('ParamMouseRightDown', pr < 0.5 ? 1 : 0);
      }
      const beat = Math.floor(tapT);
      if (beat !== lastBeat) {
        lastBeat = beat;
        popKey();
      }
    } else {
      if (cap.leftHand) P.norm('CatParamLeftHandDown', 0);
      if (cap.rightHand) P.norm('CatParamRightHandDown', 0);
      if (P.has('ParamMouseLeftDown')) P.norm('ParamMouseLeftDown', 0);
      if (P.has('ParamMouseRightDown')) P.norm('ParamMouseRightDown', 0);
    }

    for (const k of keyPool) {
      if (!k.active) continue;
      k.a -= dt / (k.decay || 0.22);
      if (k.a <= 0) { k.active = false; k.a = 0; k.sp.visible = false; }
      k.sp.alpha = k.a;
    }

    if (override) {
      for (const id in override) {
        const v = override[id];
        if (typeof v === 'number') P.raw(id, v);
      }
    }

    app.render();
  }

  function hasVisiblePixels() {
    try {
      if (!canvas) return false;
      if (app) app.render();
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = canvas.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(canvas, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
      return false;
    } catch {
      return true;
    }
  }

  window.petLive2d = {
    hasVisiblePixels,
    resetLayout,
    setState(s) {
      if (BEHAVIOR[s]) state = s;
      else if (s === 'recording') state = 'listening';
    },
    setLoudness(v) { loudTarget = Math.max(0, Math.min(1, v * 5)); },
    setMouse(nx, ny) { mouse.x = nx; mouse.y = ny; mouse.has = true; },
    setProbe(obj) { override = (obj && Object.keys(obj).length) ? obj : null; },
    loadModel,
    unload,
    active: () => !!model,
    state: () => state,
    error: () => lastError,
    caps: () => ({ ...cap }),
    stage: () => ({ ...stageSize, scene: sceneRect ? { ...sceneRect } : null })
  };
})();