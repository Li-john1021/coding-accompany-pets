// pet-live2d.js — 内嵌 Live2D 渲染：加载 BongoCat 皮肤，按语音状态驱动表演
//
// 图层顺序（从下到上）：
//   background（皮肤自带键盘/桌沿） → 键帽高亮 → Live2D 猫本体 → 耳机配件
// 键盘与配件都不在 moc3 里：键盘是皮肤 resources/background.png，
// 耳机是通用配件（基座 20 个网格中没有任何耳机零件，只能叠层实现）。
//
// 表演不依赖 motion3/exp3（那些是给 BongoCat 键鼠钩子用的），
// 直接写 cubism 参数，皮肤能否复用只取决于参数名约定。
(function () {
  const canvas = document.getElementById('l2d');
  const stageEl = document.getElementById('stage');

  const BASE_W = 612, BASE_H = 354;      // 键盘图层原生尺寸（也是 moc3 native 尺寸）
  const VIEW_W = 284, VIEW_H = Math.round(VIEW_W * BASE_H / BASE_W);
  const L2D = { bgScale: VIEW_W / BASE_W, modelScale: 1 };
  const ANGLE_RANGE = 30;                // ParamAngle* 的取值范围

  // 状态 → 表演配方。tap=每秒敲击次数（0=不敲），hp=是否戴耳机，head=头部动作
  const BEHAVIOR = {
    idle:         { tap: 0,   hp: 0, head: 'calm'   },
    listening:    { tap: 0,   hp: 1, head: 'listen' },   // 你在说话：戴耳机听，不敲
    transcribing: { tap: 3.2, hp: 0, head: 'calm'   },   // 转写中：匀速敲
    polishing:    { tap: 3.2, hp: 0, head: 'calm'   },
    inserting:    { tap: 9,   hp: 0, head: 'nod'    },   // 写回光标：加速狂敲
    done:         { tap: 9,   hp: 0, head: 'nod'    },
    typing:       { tap: 9,   hp: 0, head: 'nod'    },
    error:        { tap: 0,   hp: 0, head: 'shake'  }
  };

  let app = null, model = null;
  let layers = null;
  const keyPool = [];
  let loud = 0, loudTarget = 0;
  let state = 'idle', clock = 0, tapT = 0, lastBeat = -1;
  let ax = 0, ay = 0, az = 0;
  let override = null;     // 探针：--probe=Param3=30 强制盖写参数，用于实测哪个参数才是敲击轴

  let P = null;            // 参数访问器（带真实 min/max）

  // Cubism4 的 coreModel 没有 setParameterValue(id, value)，只有 ByIndex/ById。
  // 之前误用前者 + catch{} 静默，导致整个表演层静挂——参数不存在必须响亮报错。
  function buildParamAccess(core) {
    const cache = new Map();
    const complained = new Set();
    const info = (id) => {
      if (!cache.has(id)) {
        let m = null;
        try {
          const i = core.getParameterIndex(id);
          if (i >= 0 && i < core.getParameterCount()) {
            m = { i, min: core.getParameterMinimumValue(i), max: core.getParameterMaximumValue(i), def: core.getParameterDefaultValue(i) };
          }
        } catch { m = null; }
        cache.set(id, m);
      }
      return cache.get(id);
    };
    const complain = (id) => {
      if (complained.has(id)) return;
      complained.add(id);
      console.error('[live2d] 参数不存在，驱动无效：' + id);
    };
    return {
      info,
      list() { return [...cache.entries()].filter(([, v]) => v).map(([k, v]) => `${k}#${v.i}[${v.min}..${v.max}]`); },
      norm(id, t) {                    // t: 0..1，自动映射到参数实际范围
        const m = info(id); if (!m) return complain(id);
        core.setParameterValueByIndex(m.i, m.min + (m.max - m.min) * Math.max(0, Math.min(1, t)));
      },
      raw(id, v) {                     // 直接给参数值（角度类参数用）
        const m = info(id); if (!m) return complain(id);
        core.setParameterValueByIndex(m.i, v);
      }
    };
  }

  // 参数真值表：cdi3.json 不写范围，只有运行时能给出真实 min/max——靠猜会把值打给未接线或量级 wrong 的参数
  function dumpParams() {
    const want = ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ', 'ParamEyeLOpen', 'ParamEyeROpen',
      'CatParamLeftHandDown', 'CatParamRightHandDown', 'Param', 'Param2', 'Param3', 'Param4', 'Param5'];
    const out = want.map((id) => {
      const m = P.info(id);
      return id + '=' + (m ? `#${m.i}[${m.min}..${m.max}]=${m.def}` : 'MISSING');
    });
    console.log('[live2d] PARAM RANGE ' + JSON.stringify(out));
  }

  async function loadSprite(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const bmp = await createImageBitmap(await resp.blob());
    return new PIXI.Sprite(PIXI.Texture.from(bmp));
  }

  // 统计不透明像素数：部分键帽图除了键本身还带了“引线/光效”，
  // 随机叠上来会在键盘上留一团重影，用像素量把它们筛掉
  function opaqueCount(bmp) {
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n;
  }

  async function loadModel(url) {
    unload();
    if (!window.PIXI || !window.PIXI.live2d || !window.live2dcubismcore) {
      console.warn('[live2d] 运行时未加载 PIXI=' + !!window.PIXI
        + ' live2d=' + !!(window.PIXI && window.PIXI.live2d)
        + ' cubismcore=' + !!window.live2dcubismcore);
      return false;
    }
    if (!url) return false;
    try {
      if (!app) {
        app = new PIXI.Application({
          view: canvas, width: VIEW_W, height: VIEW_H,
          backgroundAlpha: 0, antialias: true, autoStart: false
        });
        // 优先级设为负数：排在 pixi-live2d-display 内部的 motion/physics 更新之后，
        // 否则我们写的参数会被它当帧覆盖
        app.ticker.add((dt) => tick(dt * app.ticker.deltaMS / 1000), -100);
        layers = {
          bg: new PIXI.Container(), keys: new PIXI.Container(),
          model: new PIXI.Container(), acc: new PIXI.Container()
        };
        app.stage.addChild(layers.bg, layers.keys, layers.model, layers.acc);
      }
      const dirUrl = url.slice(0, url.lastIndexOf('/') + 1);

      model = await PIXI.live2d.Live2DModel.from(url);
      model.scale.set(L2D.bgScale * L2D.modelScale);
      model.anchor.set(0, 0);
      model.x = 0; model.y = 0;
      layers.model.addChild(model);

      await setupBackground(dirUrl);
      await setupKeyCaps(dirUrl);

      stageEl.classList.add('live2d');
      P = buildParamAccess(model.internalModel.coreModel);   // 先建访问器，dumpParams 要用它读真实范围
      app.start();
      dumpParams();
      console.log('[live2d] 模型加载成功: ' + url + ' keycaps=' + keyPool.length);
      return true;
    } catch (e) {
      console.error('[live2d] 模型加载失败:', e);
      unload();
      return false;
    }
  }

  async function setupBackground(dirUrl) {
    try {
      const bg = await loadSprite(dirUrl + 'resources/background.png');
      bg.scale.set(L2D.bgScale);
      layers.bg.addChild(bg);
    } catch (e) { console.warn('[live2d] 无 background 图层：' + e.message); }
  }

  async function setupKeyCaps(dirUrl) {
    let keys = [];
    try { keys = (await window.v2p.keyCaps()).keys || []; } catch { return; }
    // 随机取一批即可：每次敲击只点亮其中一张，看不出少了哪些键
    const pick = keys.sort(() => Math.random() - 0.5);
    for (const rel of pick) {
      if (keyPool.length >= 14) break;
      try {
        const resp = await fetch(dirUrl + rel);
        if (!resp.ok) continue;
        const bmp = await createImageBitmap(await resp.blob());
        if (opaqueCount(bmp) > 6000) continue;      // 带引线的整块装饰图，只要纯键帽
        const sp = new PIXI.Sprite(PIXI.Texture.from(bmp));
        sp.scale.set(L2D.bgScale);
        sp.alpha = 0; sp.visible = false;
        layers.keys.addChild(sp);
        keyPool.push({ sp, active: false, a: 0 });
      } catch { /* 单张失败不影响其余 */ }
    }
  }

  function popKey() {
    const free = keyPool.filter((k) => !k.active);
    if (!free.length) return;
    const k = free[(Math.random() * free.length) | 0];
    // 键帽图自带“按键指示线”，不透明度太高会在键盘上留一团重影；
    // 压到 0.55 既看得出“按到了”，又不抢键盘本身的线稿
    k.active = true; k.a = 0.55; k.sp.visible = true;
  }

  function unload() {
    if (app) {
      app.stop();
      // 只清各图层的内容，图层容器必须留在舞台上——之前 removeChildren 把
      // 容器一并摘走，切肤后新模型挂到脱离舞台的 layers.model 上，画布永远空白
      if (layers) for (const k in layers) layers[k].removeChildren();
    }
    try { if (model) model.destroy(); } catch { /* 旧模型可能已处于坏状态 */ }
    model = null; keyPool.length = 0;
    P = null;   // 旧 core 已销，参数访问器不能继续指向它（切肤后会静默失效）
    tapT = 0; lastBeat = -1;
    stageEl.classList.remove('live2d');
  }

  function tick(dt) {
    if (!model) return;
    clock += dt;
    const core = model.internalModel.coreModel;
    if (!P) P = buildParamAccess(core);
    const set = (id, v) => P.raw(id, v);
    const bh = BEHAVIOR[state] || BEHAVIOR.idle;

    // 音量：上冲快、回落慢，做出"听着你在说话"的呼吸感
    loud += (loudTarget - loud) * (loudTarget > loud ? 0.35 : 0.10);
    loudTarget *= 0.88;

    // ---- 头部 ----
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
    set('ParamAngleX', ax); set('ParamAngleY', ay); set('ParamAngleZ', az);
    // 听的时候眼睛看着你，其余时候微微游移
    const eye = bh.head === 'listen' ? 0 : Math.sin(clock * 0.6) * 0.35;
    set('ParamEyeBallX', eye);
    set('ParamEyeBallY', bh.head === 'listen' ? -0.1 : Math.sin(clock * 0.9) * 0.2);

    // ---- 手 ----
    // 注意：HandDown 是「抬起/按下」两层网格的交叉淡化参数，中间值会让两层各以半透明
    // 叠加（用户看到的“透明手”）。因此所有取值只打 0 或 1，切换要快就用高频率翻转。
    if (bh.tap > 0) {
      tapT += dt * bh.tap;
      const ph = tapT % 1;
      const pr = (tapT + 0.5) % 1;
      set('CatParamLeftHandDown', ph < 0.5 ? 1 : 0);
      set('CatParamRightHandDown', pr < 0.5 ? 1 : 0);
      const beat = Math.floor(tapT);
      if (beat !== lastBeat) { lastBeat = beat; popKey(); popKey(); }
    } else {
      // 不敲键（待命/听）：爪子抬起。0=完全抬起，是模型的稳定姿态
      set('CatParamLeftHandDown', 0); set('CatParamRightHandDown', 0);
    }

    // ---- 键帽高亮衰减 ----
    for (const k of keyPool) {
      if (!k.active) continue;
      k.a -= dt / 0.22;
      if (k.a <= 0) { k.active = false; k.a = 0; k.sp.visible = false; }
      k.sp.alpha = k.a;
    }

    // 探针优先于一切行为输出，便于单独观察某个参数的效果
    if (override) for (const k in override) set(k, override[k]);

    app.render();
  }

  window.petLive2d = {
    setState(s) {
      if (BEHAVIOR[s]) state = s;
      else if (s === 'recording') state = 'listening';
    },
    // 录音时把麦克风 RMS 灌进来（0~1），驱动头部摆动幅度
    setLoudness(v) { loudTarget = Math.max(0, Math.min(1, v * 5)); },
    setProbe(obj) { override = (obj && Object.keys(obj).length) ? obj : null; },
    // 用户校准覆盖：传 null 恢复内置基准；改完立即生效（静态量由 tick 变更检测重应用）
    loadModel,
    active: () => !!model,
    state: () => state
  };
})();
