// main.js — 应用入口：托盘常驻 + 设置窗口 + 宠物悬浮窗 + 全局热键 + IPC
const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, globalShortcut, dialog, shell, protocol, net
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, domainToUnicode } = require('url');
const config = require('./config');
const models = require('./models');
const pipeline = require('./pipeline');
const paint = require('./paint');

app.setAppUserModelId('voice2prompt.app');

// 自定义特权协议 model:// ——向渲染层提供本地 Live2D 模型文件。
// file:// 页面默认被 webSecurity 拦 fetch，故用标准 scheme 映射到 assets/models 目录。
protocol.registerSchemesAsPrivileged([
  { scheme: 'model', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  // kit:// → 画板的零件分层素材目录（只读）
  { scheme: 'kit', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  // res:// → app/assets 下的通用资源（配件贴图等）
  { scheme: 'res', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);
const MODELS_ROOT = path.join(__dirname, '..', 'assets', 'models');
// 用户皮肤目录（打包后 asar 只读，新皮肤往这里放），优先级高于内置
const USER_MODELS_ROOT = path.join(app.getPath('userData'), 'models');
// 按名字解析皮肤目录：先用户目录后内置
const resolveModelDir = (name) => {
  for (const root of [USER_MODELS_ROOT, MODELS_ROOT]) {
    const p = path.join(root, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
};

let tray = null;
let settingsWin = null;
let petWin = null;
let paintWin = null;
let recordingActive = false; // 全局热键触发录音时的状态标记
let setEyesTimer = null;     // 眼睛配置防抖落盘

const petBroadcast = (channel, payload) => {
  if (petWin && !petWin.isDestroyed()) petWin.webContents.send(channel, payload);
};
const settingsBroadcast = (channel, payload) => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send(channel, payload);
};
// 状态双轨广播：内置宠物窗（第一方）与宠物桥（外部宠物）收同一套事件。
// setStage 会记住当前状态并在宠物接入时补发
const setState = (stage) => {
  petBroadcast('v2p:state', { stage });
};

// ---------------- 窗口 ----------------
function openSettings() {
  if (settingsWin) {
    // 设置窗也是单例：重开时刷新数据，避免页面上停留旧配置、一保存就把旧值写回去
    settingsWin.show();
    settingsWin.focus();
    settingsBroadcast('v2p:settings-refresh');
    return;
  }
  settingsWin = new BrowserWindow({
    width: 860,
    height: 700,
    title: 'Voice2Prompt 设置',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  // 捕获快捷键途中直接关窗：全局热键已被 unregisterAll 暂停，这里恢复
  settingsWin.on('closed', () => { settingsWin = null; registerHotkey(); });
}

// 创建皮肤窗口：给键盘猫零件上色，画完一键生成可用皮肤
function openPaint(opts = {}) {
  if (paintWin) { paintWin.show(); paintWin.focus(); return; }
  paintWin = new BrowserWindow({
    width: 1360,
    height: 880,
    title: '创建皮肤',
    autoHideMenuBar: true,
    backgroundColor: '#1e1f24',
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  const paintQuery = {};
  if (opts.selftest) paintQuery.selftest = '1';
  if (opts.job) paintQuery.job = String(opts.job);
  paintWin.loadFile(path.join(__dirname, '..', 'renderer', 'paint.html'),
    Object.keys(paintQuery).length ? { query: paintQuery } : undefined);
  paintWin.on('closed', () => { paintWin = null; });
}

function createPetWindow() {
  const s = Math.max(0.6, Math.min(2.5, Number(config.load().petScale) || 1));
  petWin = new BrowserWindow({
    width: Math.round(300 * s),
    height: Math.round(230 * s),
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    // 关键：点击宠物不抢焦点，否则 SendKeys 的 Ctrl+V 会粘到宠物窗而非用户的编辑器
    focusable: false,
    webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  petWin.loadFile(path.join(__dirname, '..', 'renderer', 'pet.html'));
  petWin.webContents.setZoomFactor(s);
  // 悬浮窗允许出现在所有虚拟桌面
  petWin.setAlwaysOnTop(true, 'screen-saver');
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  petWin.on('closed', () => { petWin = null; });
}

// 窗口尺寸 ↔ 缩放系数。滚轮缩放时内容用 zoomFactor 放大，窗口跟随等比变化，
// 锚定中心（两边各扩/缩一半），宠物不会跑偏
function applyPetScale(delta) {
  if (!petWin || petWin.isDestroyed()) return;
  const cur = Math.max(0.6, Math.min(2.5, Number(config.load().petScale) || 1));
  const next = Math.max(0.6, Math.min(2.5, cur * (delta > 0 ? 1.1 : 1 / 1.1)));
  if (Math.abs(next - cur) < 0.001) return;
  const [x, y] = petWin.getPosition();
  const [w, h] = petWin.getSize();
  petWin.setBounds({
    x: Math.round(x - (w * (next / cur - 1)) / 2),
    y: Math.round(y - (h * (next / cur - 1)) / 2),
    width: Math.round(300 * next),
    height: Math.round(230 * next)
  });
  petWin.webContents.setZoomFactor(next);
  const cfg = config.load();
  cfg.petScale = next;
  config.save();
}

// ---------------- 全局热键（按一下开始 / 再按一下结束） ----------------
function registerHotkey() {
  globalShortcut.unregisterAll();
  const combo = config.load().hotkey;
  if (!combo) return;
  const ok = globalShortcut.register(combo, () => {
    if (!petWin || petWin.isDestroyed()) return;
    if (recordingActive) {
      recordingActive = false;
      petBroadcast('v2p:hotkey-stop');
    } else {
      recordingActive = true;
      petBroadcast('v2p:hotkey-start');
    }
  });
  if (!ok) {
    petBroadcast('v2p:toast', { text: `热键 ${combo} 注册失败，可能被占用` });
  }
}

// ---------------- 托盘 ----------------
function createTray() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL(trayFallbackIcon()) : icon);
  const menu = Menu.buildFromTemplate([
    { label: '设置 / 模型管理', click: openSettings },
    {
      label: '显示宠物',
      type: 'checkbox',
      checked: true,
      click: (item) => {
        if (item.checked) { if (!petWin) createPetWindow(); else petWin.show(); }
        else if (petWin) petWin.hide();
      }
    },
    { type: 'separator' },
    { label: '退出 Voice2Prompt', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Voice2Prompt：按住说话，直出高质量提示词');
  tray.setContextMenu(menu);
  tray.on('click', openSettings);
}

// 16x16 简易橙色圆点托盘图标（dataURL），避免缺图标文件时托盘为空
function trayFallbackIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7" fill="#ff9f43"/><circle cx="6" cy="7" r="1" fill="#333"/><circle cx="10" cy="7" r="1" fill="#333"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// ---------------- 宠物图片 ----------------
function petDir() {
  const dir = path.join(app.getPath('userData'), 'pet');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function currentPetImageDataUrl() {
  const cfg = config.load();
  const candidates = [];
  if (cfg.petImage) candidates.push(path.join(petDir(), cfg.petImage));
  candidates.push(path.join(__dirname, '..', 'assets', 'pet.png'));
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p);
      const ext = path.extname(p).toLowerCase();
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/png';
      return `data:${mime};base64,${data.toString('base64')}`;
    }
  }
  return '';
}

// ---------------- IPC ----------------
function registerIpc() {
  ipcMain.handle('v2p:get-config', () => {
    const cfg = { ...config.load() };
    // 下发给设置页时解码 apiKey，便于编辑；保存时渲染层重新编码回传
    cfg.asrProviders = cfg.asrProviders.map((p) => ({ ...p, apiKey: config.unmask(p.apiKey) }));
    cfg.llmProviders = cfg.llmProviders.map((p) => ({ ...p, apiKey: config.unmask(p.apiKey) }));
    return cfg;
  });

  ipcMain.handle('v2p:save-config', (_e, patch) => {
    const cfg = config.load();
    const modelChanged = 'petModel' in patch && patch.petModel !== cfg.petModel;
    const triggerChanged = 'triggerMode' in patch && patch.triggerMode !== cfg.triggerMode;
    const hpEnabledChanged = 'petHeadphoneEnabled' in patch
      && (!!patch.petHeadphoneEnabled !== !!cfg.petHeadphoneEnabled);
    Object.assign(cfg, patch);
    config.save();
    registerHotkey();
    if (modelChanged) petBroadcast('v2p:pet-model-changed', { name: cfg.petModel });
    if (triggerChanged) petBroadcast('v2p:trigger-mode-changed', { mode: cfg.triggerMode });
    if (hpEnabledChanged) petBroadcast('v2p:pet-headphone-changed', { enabled: !!cfg.petHeadphoneEnabled });
    return { ok: true };
  });

  // 设置页录制快捷键期间暂停全局热键，避免按下的组合键直接触发录音
  ipcMain.handle('v2p:hotkey-capturing', (_e, on) => {
    if (on) globalShortcut.unregisterAll();
    else registerHotkey();
    return { ok: true };
  });

  ipcMain.handle('v2p:validate-model', async (_e, { kind, provider }) => {
    // 注意：渲染层传来的 apiKey 已是明文（get-config 时解码过），此处不得再 unmask
    try {
      return kind === 'asr' ? await models.validateAsr(provider) : await models.validateLlm(provider);
    } catch (err) {
      return { ok: false, error: String(err.message || err).slice(0, 200) };
    }
  });

  // 宠物窗提交录音结果，跑完整管线
  ipcMain.handle('v2p:submit', async (_e, { audio, mime }) => {
    try {
      const buf = Buffer.from(audio);
      const result = await pipeline.run(buf, mime, setState);
      petBroadcast('v2p:result', result);
      return { ok: true, ...result };
    } catch (err) {
      setState('error');
      const msg = String(err.message || err);
      petBroadcast('v2p:toast', { text: msg.slice(0, 120) });
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle('v2p:recording-flag', (_e, active) => {
    recordingActive = !!active;
    return { ok: true };
  });

  // 宠物窗移动（拖拽）
  ipcMain.handle('v2p:pet-move', (_e, { dx, dy }) => {
    if (!petWin || petWin.isDestroyed()) return;
    const [x, y] = petWin.getPosition();
    petWin.setPosition(Math.round(x + dx), Math.round(y + dy));
  });

  // 滚轮缩放宠物窗（渲染层转发方向），缩放系数持久化
  ipcMain.handle('v2p:pet-scale', (_e, dir) => { applyPetScale(Number(dir) || 0); return { ok: true, scale: config.load().petScale }; });

  // 耳机校准：渲染层 Alt+拖动/Alt+滚轮 得到的绝对锚点，持久化并广播
  let hpSaveTimer = null;
  ipcMain.handle('v2p:set-hp-tweak', (_e, hp) => {
    if (!hp || !Number.isFinite(hp.cx) || !Number.isFinite(hp.cy) || !Number.isFinite(hp.targetSpan)) return { ok: false };
    const cfg = config.load();
    // rotDeg 可选透传：字段若写死三个，回播会把校准旋转冲掉（override 丢字段）
    cfg.petHeadphone = {
      cx: +hp.cx.toFixed(4), cy: +hp.cy.toFixed(4), targetSpan: +hp.targetSpan.toFixed(4),
      ...(Number.isFinite(hp.rotDeg) ? { rotDeg: +hp.rotDeg.toFixed(2) } : {})
    };
    clearTimeout(hpSaveTimer);
    hpSaveTimer = setTimeout(() => config.save(), 300);
    petBroadcast('v2p:pet-hp-changed', cfg.petHeadphone);
    return { ok: true };
  });
  ipcMain.handle('v2p:reset-hp-tweak', () => {
    const cfg = config.load();
    cfg.petHeadphone = null;
    config.save();
    petBroadcast('v2p:pet-hp-changed', null);
    return { ok: true };
  });

  ipcMain.handle('v2p:pet-image', () => ({ dataUrl: currentPetImageDataUrl() }));

  // Live2D 皮肤：当前模型名 + 可用列表（用户目录与内置 assets/models 下含 *.model3.json 的目录）
  ipcMain.handle('v2p:pet-model', () => {
    const name = config.load().petModel || '';
    const url = name && resolveModelDir(name) ? `model://${name}/` : '';
    return { name, url };
  });

  // 删除用户自建皮肤（内置皮肤不在用户目录，天然受保护）
  ipcMain.handle('v2p:pet-model-delete', (_e, { name }) => {
    const skin = String(name || '').replace(/[^A-Za-z0-9_\-一-龥]/g, '').slice(0, 48);
    if (!skin) return { ok: false, error: '皮肤名不合法' };
    const root = path.join(app.getPath('userData'), 'models');
    const dir = path.join(root, skin);
    if (path.normalize(dir).startsWith(path.normalize(root)) === false || !fs.existsSync(dir)) {
      return { ok: false, error: '皮肤不存在（内置皮肤不可删除）' };
    }
    fs.rmSync(dir, { recursive: true, force: true });
    const cfg = config.load();
    if (cfg.petModel === skin) {
      cfg.petModel = '';
      config.save();
      petBroadcast('v2p:pet-model-changed', { name: '' });
    }
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send('v2p:pet-model-list-changed', {});
    }
    return { ok: true, name: skin };
  });

  // 画板反推涂装用:皮肤贴图页的 model:// 基址(用户自建与内置都可,只读)
  ipcMain.handle('v2p:pet-model-texture-base', (_e, { name }) => {
    const skin = String(name || '').replace(/[^A-Za-z0-9_\-一-龥]/g, '').slice(0, 48);
    if (!skin) return { ok: false };
    const dir = resolveModelDir(skin);
    if (!dir || !fs.existsSync(path.join(dir, 'demomodel2.1024'))) return { ok: false };
    return { ok: true, base: 'model://' + encodeURIComponent(skin) + '/demomodel2.1024' };
  });

  // 鼠标侧键录音开关
  ipcMain.handle('v2p:set-mouse-record', (_e, on) => {
    const cfg = config.load();
    cfg.mouseRecord = !!on;
    config.save();
    setMouseRecordHook();
    return { ok: true, enabled: cfg.mouseRecord };
  });

  // 向量眼睛贴片:整包落盘 + 广播宠物窗
  ipcMain.handle('v2p:set-eyes', (_e, cfg) => {
    // cfg: null(未启用/回退模型原眼) 或 {mode, colorL, colorR, r, cxL, cyL, cxR, cyR}
    if (cfg !== null && (typeof cfg !== 'object' || typeof cfg.mode !== 'string')) return { ok: false };
    const c = config.load();
    c.petEyes = cfg;
    clearTimeout(setEyesTimer);
    setEyesTimer = setTimeout(() => config.save(), 300);
    petBroadcast('v2p:pet-eyes-changed', cfg);
    return { ok: true };
  });

  ipcMain.handle('v2p:pet-model-list', () => {
    const names = new Set();
    for (const root of [USER_MODELS_ROOT, MODELS_ROOT]) {
      try {
        for (const d of fs.readdirSync(root, { withFileTypes: true })) {
          if (d.isDirectory() && fs.readdirSync(path.join(root, d.name)).some((f) => f.endsWith('.model3.json'))) {
            names.add(d.name);
          }
        }
      } catch { /* 目录不存在则跳过 */ }
    }
    return { models: [...names] };
  });

  // 当前皮肤里的键帽图（敲击高亮用）；每张都是与背景同尺寸的整页图
  ipcMain.handle('v2p:key-caps', () => {
    const name = config.load().petModel || '';
    const dir = resolveModelDir(name);
    if (!dir) return { keys: [] };
    const out = [];
    for (const sub of ['left-keys', 'right-keys']) {
      const d = path.join(dir, 'resources', sub);
      try {
        for (const f of fs.readdirSync(d)) if (f.endsWith('.png')) out.push(`resources/${sub}/${f}`);
      } catch { /* 皮肤可能不带键帽 */ }
    }
    return { keys: out };
  });

  ipcMain.handle('v2p:open-models-folder', () => {
    fs.mkdirSync(USER_MODELS_ROOT, { recursive: true });
    shell.openPath(USER_MODELS_ROOT);
    return { ok: true };
  });

  ipcMain.handle('v2p:pick-pet-image', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: '选择宠物图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile']
    });
    if (canceled || !filePaths.length) return { ok: false };
    const src = filePaths[0];
    const ext = path.extname(src).toLowerCase() || '.png';
    const name = `custom${ext}`;
    fs.copyFileSync(src, path.join(petDir(), name));
    const cfg = config.load();
    cfg.petImage = name;
    config.save();
    petBroadcast('v2p:pet-image-changed', { dataUrl: currentPetImageDataUrl() });
    return { ok: true };
  });

  ipcMain.handle('v2p:open-config-folder', () => {
    shell.openPath(app.getPath('userData'));
    return { ok: true };
  });

  ipcMain.handle('v2p:open-settings', () => {
    openSettings();
    return { ok: true };
  });

  ipcMain.handle('v2p:open-paint', (_e, job) => {
    // 画板窗口是单例：已开时不能只 show——那会让"修改皮肤 B"仍停在
    // 上一次的涂装上下文（用户看到的"绘图保留之前皮肤的特征"就是这个）
    if (paintWin && !paintWin.isDestroyed()) {
      paintWin.webContents.send('v2p:paint-switch-job', { job: String(job || 'my-skin') });
      paintWin.show();
      paintWin.focus();
      return { ok: true, reused: true };
    }
    openPaint(job ? { job: String(job) } : {});
    return { ok: true };
  });

}

// 连拍验收：锁定某个状态，逐帧 capturePage 存成帧图，供 frames_to_gif.py 合成
// 静帧看不出“戴耳机听 / 加速狂敲”，必须用连续帧才能验收动画是否真的在动
async function recordFrames(stage, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const N = 42;
  for (let i = 0; i < N; i++) {
    if (!petWin || petWin.isDestroyed()) break;
    petBroadcast('v2p:state', { stage });
    // 模拟人在说话：起伏包络 + 微量噪声，给“听”的状态提供音量驱动
    petBroadcast('v2p:loudness', Math.max(0, 0.34 + 0.3 * Math.sin(i * 0.5) + Math.random() * 0.08));
    await new Promise((r) => setTimeout(r, 70));
    try {
      const img = await petWin.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, `f${String(i).padStart(3, '0')}.png`), img.toPNG());
    } catch (e) { console.log('[record] frame fail: ' + e.message); }
  }
  console.log('[record] done ' + outDir);
}

// ---------------- 生命周期 ----------------
app.whenReady().then(() => {
  // model://<模型名>/<相对路径> → 用户皮肤目录或内置 assets/models 下的同名目录
  protocol.handle('model', async (req) => {
    const u = new URL(req.url);
    // 标准scheme 的 host 会被 IDNA 规范化：中文皮肤名到达时是 punycode(xn--…)，
    // 兼容裸 host/punycode/百分号编码三种形态，谁能在磁盘上命中就用谁
    const candidates = [...new Set([domainToUnicode(u.host), decodeURIComponent(u.host), u.host])]
      .filter(Boolean);
    const dir = candidates.map(resolveModelDir).find(Boolean) || '';
    const host = candidates.find((h) => resolveModelDir(h)) || u.host;
    const rel = path.normalize(path.join(host, decodeURIComponent(u.pathname))).replace(/^([/\\])+/, '');
    const filePath = dir ? path.join(dir, rel.slice(path.normalize(host).length + 1)) : '';
    if (!filePath || !filePath.startsWith(dir) || !fs.existsSync(filePath)) {
      return new Response('not found', { status: 404 });
    }
    const res = await net.fetch(pathToFileURL(filePath).toString());
    // 必须显式带 CORS 头：PIXI 用 <img crossOrigin> 加载贴图，file:// 页面下会被判跳域而失败
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  });

  // kit://<相对路径> → paint_kit/<相对路径>（画板只读素材）
  protocol.handle('kit', async (req) => {
    const u = new URL(req.url);
    const root = paint.kitRoot();
    const rel = decodeURIComponent(path.join(u.host, u.pathname)).replace(/^([/\\])+/, '');
    const filePath = path.join(root, rel);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
      return new Response('not found', { status: 404 });
    }
    const res = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  });

  // res://<相对路径> → app/assets/<相对路径>（配件贴图等通用资源）
  protocol.handle('res', async (req) => {
    const u = new URL(req.url);
    const root = path.join(__dirname, '..', 'assets');
    const rel = decodeURIComponent(path.join(u.host, u.pathname)).replace(/^([/\\])+/, '');
    const filePath = path.join(root, rel);
    if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
      return new Response('not found', { status: 404 });
    }
    const res = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  });

  config.load();
  registerIpc();
  paint.register();
  createTray();
  createPetWindow();
  registerHotkey();
  // 置顶保活：别的置顶窗口弹出/全屏应用退出后 z 序可能压过宠物，定期把宠物顶回最上层。
  // moveTop 不抢焦点，不打断打字
  setInterval(() => { if (petWin && !petWin.isDestroyed() && petWin.isVisible()) petWin.moveTop(); }, 4000);
  setMouseRecordHook();
  // 调试入口：electron . --paint 直接开画板；--paint-selftest 额外跑越界自检
  if (process.argv.includes('--paint') || process.argv.includes('--paint-selftest')) {
    openPaint({ selftest: process.argv.includes('--paint-selftest') });
  }

  // 截图通道：--shot=<pet|paint>=<文件路径>
  // 用 capturePage 而非屏幕拓印：不依赖窗口是否被遮挡，透明窗还能直接拿到带 alpha 的 PNG
  process.argv.forEach((a) => {
    const m = /^--shot=([^=]+)=(.+)$/.exec(a);
    if (!m) return;
    const [, target, file] = m;
    setTimeout(async () => {
      const win = target === 'paint' ? paintWin : petWin;
      if (!win || win.isDestroyed()) { console.log('[shot] 窗口不存在: ' + target); return; }
      try {
        // 窗口可能处于未绘制状态，capturePage 会拿到 0x0：先强制唤起并等一帧
        win.show(); win.focus(); win.moveTop();
        await new Promise((r) => setTimeout(r, 700));
        const b = win.getContentBounds();
        console.log('[shot] ' + target + ' bounds=' + JSON.stringify(b) + ' vis=' + win.isVisible() + ' min=' + win.isMinimized());
        const img = await win.webContents.capturePage();
        const buf = img.toPNG();
        console.log('[shot] ' + target + ' size=' + JSON.stringify(img.getSize()) + ' bytes=' + buf.length);
        if (!buf.length) { console.log('[shot] 空图，1.5s 后重试'); await new Promise((r) => setTimeout(r, 1500)); }
        require('fs').mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, img.toPNG());
        console.log('[shot] saved ' + target + ' -> ' + file);
      } catch (e) { console.log('[shot] fail: ' + e.message); }
    }, target === 'paint' ? 14000 : 8000);
  });

  // 录帧：--record=<state>=<帧目录>
  process.argv.forEach((a) => {
    const m = /^--record=([^=]+)=(.+)$/.exec(a);
    if (m) setTimeout(() => recordFrames(m[1], m[2]), 5000);
  });

  // 参数探针：--probe=Param3=30,CatParamLeftHandDown=1（配合 --shot 拍静态对比图）
  process.argv.forEach((a) => {
    const m = /^--probe=(.+)$/.exec(a);
    if (!m) return;
    const obj = {};
    m[1].split(',').forEach((kv) => {
      const i = kv.indexOf('=');
      if (i > 0) obj[kv.slice(0, i)] = parseFloat(kv.slice(i + 1));
    });
    setTimeout(() => petBroadcast('v2p:probe', obj), 6000);
  });
  // 无任何模型配置时，首启自动打开设置页引导
  const cfg = config.load();
  if (!cfg.asrProviders.length || !cfg.llmProviders.length) openSettings();
});

// ---------------- 鼠标侧键录音:全局鼠标钩子,侧键=热键的等价触发 ----------------
let mouseHookOn = false;

function setMouseRecordHook() {
  const want = config.load().mouseRecord === true;
  if (want === mouseHookOn) return;
  if (want) {
    try {
      const { uIOhook, EventType } = require('uiohook-napi');
      uIOhook.on(EventType.EVENT_MOUSE_PRESSED, (e) => {
        if (e.button !== 4) return;   // 4 = XButton1(后退侧键)
        if (!petWin || petWin.isDestroyed()) return;
        if (recordingActive) {
          recordingActive = false;
          petBroadcast('v2p:hotkey-stop');
        } else {
          recordingActive = true;
          petBroadcast('v2p:hotkey-start');
        }
      });
      uIOhook.start();
      mouseHookOn = true;
      console.log('[mouse] 侧键录音已启用');
    } catch (e) {
      console.log('[mouse] 钩子启动失败:' + (e.message || e));
    }
  } else {
    try { require('uiohook-napi').uIOhook.stop(); } catch { /* 未启动过 */ }
    mouseHookOn = false;
    console.log('[mouse] 侧键录音已关闭');
  }
}

function stopMouseRecordHook() {
  if (mouseHookOn) { try { require('uiohook-napi').uIOhook.stop(); } catch { } mouseHookOn = false; }
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopMouseRecordHook();
});

// 后台常驻：关闭所有窗口也不退出（托盘退出才算退出）
app.on('window-all-closed', () => {
  // 不调用 app.quit() 即保持后台常驻；仅托盘菜单"退出"会置 isQuitting
});
