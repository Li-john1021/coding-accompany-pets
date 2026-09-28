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

// 单实例:二次启动不重复拉起,把已有实例顶到前台
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', () => { if (petWin && !petWin.isDestroyed()) petWin.moveTop(); });

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
  let s = Math.max(0.3, Math.min(2.5, Number(config.load().petScale) || 1));
  // 用户滚轮误拧到极小时桌宠几乎不可见，创建时抬到可辨识尺寸
  if (s < 0.8) {
    console.log('[pet] scale too small: ' + s + ' -> 1');
    s = 1;
    const cfg = config.load();
    cfg.petScale = 1;
    config.save();
  }
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
  const cur = Math.max(0.3, Math.min(2.5, Number(config.load().petScale) || 1));
  const next = Math.max(0.3, Math.min(2.5, cur * (delta > 0 ? 1.1 : 1 / 1.1)));
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
    Object.assign(cfg, patch);
    config.save();
    registerHotkey();
    setMouseRecordHook();
    if (modelChanged) petBroadcast('v2p:pet-model-changed', { name: cfg.petModel });
    if (triggerChanged) petBroadcast('v2p:trigger-mode-changed', { mode: cfg.triggerMode });
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
  ipcMain.handle('v2p:submit', async (_e, { audio, mime, options }) => {
    try {
      const buf = Buffer.from(audio);
      const opts = options || {};
      if (config.load().previewEnabled && !opts.mode && !opts.transcriptOnly) {
        // 预览卡：只转写，等用户选模式后再 process
        opts.transcriptOnly = true;
      }
      const result = await pipeline.run(buf, mime, setState, opts);
      if (result.preview && config.load().previewEnabled) {
        const skip = Number(config.load().previewSkipChars) || 12;
        if ((result.raw || '').trim().length < skip) {
          const r2 = await pipeline.processText(result.raw, 'default', setState);
          const { insertText } = require('./insert');
          const ins = await insertText(r2.text, config.load().insertMode || 'paste');
          const out = { raw: result.raw, polished: r2.text, mode: r2.mode, note: r2.note, ...ins };
          setState('done');
          petBroadcast('v2p:result', out);
          return { ok: true, ...out };
        }
        showPreviewWindow(result.raw);
        petBroadcast('v2p:toast', { text: '请在预览卡中选择处理方式' });
        return { ok: true, ...result, preview: true };
      }
      petBroadcast('v2p:result', result);
      return { ok: true, ...result };
    } catch (err) {
      setState('error');
      const msg = String(err.message || err);
      petBroadcast('v2p:toast', { text: msg.slice(0, 120) });
      return { ok: false, error: msg };
    }
  });

  // 纯文本整理（选区浮条 / 预览卡共用）
  ipcMain.handle('v2p:process-text', async (_e, { text, mode }) => {
    const r = await pipeline.processText(String(text || ''), mode || 'default', setState);
    pendingPreview = Object.assign({ raw: String(text || '') }, r);
    return { ok: true, ...r };
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

  // 鼠标侧键录音开关
  ipcMain.handle('v2p:set-mouse-record', (_e, on) => {
    const cfg = config.load();
    cfg.mouseRecord = !!on;
    config.save();
    setMouseRecordHook();
    return { ok: true, enabled: cfg.mouseRecord };
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

  ipcMain.handle('v2p:pet-image', () => ({ dataUrl: currentPetImageDataUrl() }));

  // Live2D 皮肤：当前模型名 + 可用列表（用户目录与内置 assets/models 下含 *.model3.json 的目录）

  // Live2D 皮肤：当前模型名 + 可用列表（用户目录与内置 assets/models 下含 *.model3.json 的目录）

  // 删除用户自建皮肤（内置皮肤不在用户目录，天然受保护）

  // 画板反推涂装用:皮肤贴图页的 model:// 基址(用户自建与内置都可,只读)

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

  // 画板反推涂装用:皮肤贴图页的 model:// 基址(用户自建与内置都可,只读)
  ipcMain.handle('v2p:pet-model-texture-base', (_e, { name }) => {
    const skin = String(name || '').replace(/[^A-Za-z0-9_\-一-龥]/g, '').slice(0, 48);
    if (!skin) return { ok: false };
    const dir = resolveModelDir(skin);
    if (!dir || !fs.existsSync(path.join(dir, 'demomodel2.1024'))) return { ok: false };
    return { ok: true, base: 'model://' + encodeURIComponent(skin) + '/demomodel2.1024' };
  });

  // 向量眼睛贴片:整包落盘 + 广播宠物窗

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
  if (!gotLock) return;   // 未拿到锁的二次实例直接退出
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
  try { if (petWin && !petWin.isDestroyed()) petWin.show(); } catch {}
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

// ---------------- 选中浮条：拖选后弹出，点选才处理（禁止自动过模型） ----------------
let paletteWin = null;
let activePaletteSelection = null;
let selectionGestureId = 0;
let paletteRunActive = false;
const { shouldShowPalette, meetsMinimumCharacters } = require('./palette-gate');
const { probeSelection } = require('./palette-probe');

function createPaletteWindow() {
  if (paletteWin && !paletteWin.isDestroyed()) return paletteWin;
  paletteWin = new BrowserWindow({
    width: 170,
    height: 230,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 浮条永不抢焦点，若允许节流则 spinner/状态会冻住
      backgroundThrottling: false
    }
  });
  paletteWin.loadFile(path.join(__dirname, '..', 'renderer', 'palette.html'));
  paletteWin.setAlwaysOnTop(true, 'screen-saver');
  paletteWin.on('closed', () => { paletteWin = null; });
  return paletteWin;
}

function hidePalette() {
  if (paletteWin && !paletteWin.isDestroyed()) paletteWin.hide();
}

function showPaletteAt(x, y, preview, longText, selectionId) {
  const win = createPaletteWindow();
  if (!win) return;
  const [w, h] = win.getSize();
  const display = require('electron').screen.getDisplayNearestPoint({ x, y });
  const area = display.workArea;
  let left = Math.round(x) - 20;
  let top = Math.round(y) + 18;
  if (left + w > area.x + area.width) left = area.x + area.width - w - 8;
  if (top + h > area.y + area.height) top = Math.round(y) - h - 12;
  if (left < area.x) left = area.x + 8;
  if (top < area.y) top = area.y + 8;
  win.setPosition(left, top);
  win.showInactive();
  win.webContents.send('v2p:palette-show', { preview: String(preview || '').slice(0, 200), long: !!longText, selectionId });
}


// 用户自己 Ctrl+C 复制意图：短窗口内不弹浮条
let lastUserCopyAt = 0;

function paletteDebugLog(line) {
  try {
    const fs = require('fs');
    const path = require('path');
    const f = path.join(require('electron').app.getPath('userData'), 'palette-debug.log');
    fs.appendFileSync(f, new Date().toISOString() + ' ' + line + '\n');
  } catch { /* ignore */ }
}

function isOverOwnWindow(x, y) {
  const wins = [petWin, paletteWin, settingsWin, previewWin, paintWin];
  for (const w of wins) {
    if (!w || w.isDestroyed() || !w.isVisible()) continue;
    const b = w.getBounds();
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) return true;
  }
  return false;
}

function invalidatePaletteSelection() {
  selectionGestureId += 1;
  activePaletteSelection = null;
}

function isCurrentPaletteSelection(selection) {
  return !!selection && activePaletteSelection === selection && selection.id === selectionGestureId;
}

async function revalidatePaletteSelection(selection) {
  if (!isCurrentPaletteSelection(selection) || recordingActive || config.load().paletteEnabled === false) return false;
  const current = await probeSelection(selection.start, selection.end, { requireFocusedTarget: true });
  return isCurrentPaletteSelection(selection) && current &&
    current.controlId === selection.controlId && current.text === selection.text;
}

async function captureAndShowPalette(start, end, screenX, screenY, gestureId) {
  const cfg = config.load();
  const selection = await probeSelection(start, end, { requireFocusedTarget: true });
  if (gestureId !== selectionGestureId || recordingActive) return;
  const gate = shouldShowPalette({
    selection,
    enabled: cfg.paletteEnabled !== false,
    recording: recordingActive,
    userCopyAt: lastUserCopyAt,
    now: Date.now()
  });
  if (!gate.ok) {
    paletteDebugLog('SKIP ' + gate.reason);
    return;
  }
  const minChars = Number(cfg.paletteMinChars) || 20;
  if (!meetsMinimumCharacters(selection, minChars)) {
    paletteDebugLog('SKIP threshold len=' + selection.text.trim().length);
    return;
  }
  if (isOverOwnWindow(screenX, screenY) || gestureId !== selectionGestureId || recordingActive) {
    paletteDebugLog('SKIP own-window');
    return;
  }
  const paletteSelection = {
    id: gestureId, start, end, controlId: selection.controlId,
    text: selection.text, processName: selection.processName
  };
  activePaletteSelection = paletteSelection;
  paletteDebugLog('SHOW_BAR proc=' + selection.processName + ' len=' + selection.text.length);
  showPaletteAt(screenX, screenY, '', selection.text.trim().length > minChars, gestureId);
}

function isPaletteVisible() {
  return !!(paletteWin && !paletteWin.isDestroyed() && paletteWin.isVisible());
}

// 点浮条外 / Esc：无副作用关闭（零 LLM）
function dismissPaletteIfVisible() {
  if (!isPaletteVisible()) return false;
  hidePalette();
  invalidatePaletteSelection();
  return true;
}

ipcMain.handle('v2p:palette-run', async (_e, { mode, selectionId }) => {
  if (paletteRunActive) return { ok: false, error: '处理中，请稍候' };
  const selection = activePaletteSelection;
  if (!selection || selection.id !== selectionId || !isCurrentPaletteSelection(selection)) {
    return { ok: false, error: '选区已变化，请重新选择文本' };
  }
  paletteRunActive = true;
  try {
    if (!(await revalidatePaletteSelection(selection))) {
      return { ok: false, error: '选区已变化，请重新选择文本' };
    }
    const cfg0 = config.load();
    const minChars = Number(cfg0.paletteMinChars) || 20;
    if (!meetsMinimumCharacters(selection, minChars)) {
      return { ok: false, error: '选中不足 ' + minChars + ' 字，未处理' };
    }
    const clipboard = require('electron').clipboard;
    const oldClipboard = clipboard.readText() || '';
    paletteDebugLog('RUN_CONFIRMED len=' + selection.text.length + ' mode=' + mode);

    const r = await pipeline.processText(selection.text, mode === 'structure' ? 'structure' : 'optimize', setState);
    if (!(await revalidatePaletteSelection(selection))) {
      paletteDebugLog('RUN_CANCELLED stale-after-process');
      return { ok: false, error: '处理期间选区已变化，已取消写回' };
    }
    const cfg = config.load();
    const copyOnly = !!cfg.writeBackCopyOnly;
    if (copyOnly) {
      clipboard.writeText(r.text);
      const payload = {
        raw: selection.text,
        polished: r.text,
        mode: r.mode,
        degraded: r.degraded,
        note: r.note || '结果已复制到剪贴板',
        inserted: false,
        copiedOnly: true
      };
      setState('done');
      petBroadcast('v2p:result', payload);
      setTimeout(() => setState('idle'), 2500);
      return { ok: true, ...payload };
    }

    const { insertText } = require('./insert');
    const ins = await insertText(r.text, 'paste', { target: selection });
    if (ins.cancelled) {
      paletteDebugLog('RUN_CANCELLED active-target-changed');
      return { ok: false, error: '当前输入目标已变化，已取消写回' };
    }
    if (ins.inserted && cfg.clipboardRestore) {
      try { clipboard.writeText(oldClipboard); } catch { /* ignore */ }
    }
    const fallbackNote = ins.inserted ? (r.note || '完成') : (r.note ? r.note + '；' : '') + '已复制，请手动粘贴';
    const payload = {
      raw: selection.text,
      polished: r.text,
      mode: r.mode,
      degraded: r.degraded,
      note: fallbackNote,
      inserted: ins.inserted,
      copiedOnly: ins.copiedOnly
    };
    setState('done');
    petBroadcast('v2p:result', payload);
    setTimeout(() => setState('idle'), 2500);
    return { ok: true, ...payload };
  } catch (err) {
    paletteDebugLog('RUN_ERR ' + (err && err.message));
    return { ok: false, error: String(err.message || err).slice(0, 160) };
  } finally {
    paletteRunActive = false;
  }
});

ipcMain.handle('v2p:palette-copy-raw', async (_e, { selectionId }) => {
  const selection = activePaletteSelection;
  if (!selection || selection.id !== selectionId || !(await revalidatePaletteSelection(selection))) {
    return { ok: false, error: '选区已变化，请重新选择文本' };
  }
  require('electron').clipboard.writeText(selection.text);
  return { ok: true };
});

ipcMain.handle('v2p:palette-dismiss', (_e, { selectionId }) => {
  if (!activePaletteSelection || activePaletteSelection.id !== selectionId || selectionGestureId !== selectionId) {
    return { ok: false, stale: true };
  }
  hidePalette();
  invalidatePaletteSelection();
  return { ok: true };
});

// ---------------- 语音预览卡（默认关，设置可开） ----------------
let previewWin = null;
let pendingPreview = null;

function createPreviewWindow() {
  if (previewWin && !previewWin.isDestroyed()) return previewWin;
  previewWin = new BrowserWindow({
    width: 480,
    height: 360,
    frame: false,
    transparent: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#1e1f24',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  previewWin.loadFile(path.join(__dirname, '..', 'renderer', 'preview.html'));
  previewWin.setAlwaysOnTop(true, 'screen-saver');
  previewWin.on('closed', () => { previewWin = null; });
  return previewWin;
}

function showPreviewWindow(raw) {
  pendingPreview = { raw };
  const win = createPreviewWindow();
  if (!win) return;
  win.center();
  win.show();
  win.focus();
  win.webContents.send('v2p:preview-show', { raw: String(raw || '') });
}

ipcMain.handle('v2p:preview-insert', async (_e, { text, copyOnly }) => {
  const { insertText } = require('./insert');
  const cfg = config.load();
  const mode = copyOnly ? 'clipboard' : (cfg.insertMode || 'paste');
  return insertText(String(text || ''), mode);
});

ipcMain.handle('v2p:preview-close', (_e, payload) => {
  if (previewWin && !previewWin.isDestroyed()) previewWin.hide();
  if (payload && payload.ok) {
    petBroadcast('v2p:result', {
      raw: (pendingPreview && pendingPreview.raw) || '',
      polished: (payload && payload.text) || (pendingPreview && pendingPreview.raw) || '',
      mode: payload.mode || (pendingPreview && pendingPreview.mode) || 'none',
      degraded: !!(payload && payload.degraded) || !!(pendingPreview && pendingPreview.degraded),
      note: (payload && payload.note) || (pendingPreview && pendingPreview.note) || '',
      inserted: !!payload.inserted,
      copiedOnly: payload.copiedOnly !== false
    });
  } else {
    petBroadcast('v2p:toast', { text: '已取消预览' });
  }
  pendingPreview = null;
  setState('idle');
  return { ok: true };
});

// ---------------- 鼠标侧键录音:全局鼠标钩子,侧键=热键的等价触发 ----------------
let mouseHookOn = false;
let selDown = false, selDragging = false, selStartX = 0, selStartY = 0;
let activeSelectionGesture = null;

function setMouseRecordHook() {
  const cfg = config.load();
  const want = cfg.mouseRecord === true || cfg.paletteEnabled !== false;
  if (want === mouseHookOn) return;
  if (want) {
    try {
      const { uIOhook } = require('uiohook-napi');
      // 注意:uiohook-napi 1.x 的事件名是小写字符串('mousedown'),不是 EventType 数值常量
      uIOhook.on('mousedown', (e) => {
        if (e.button === 4) {
          if (!petWin || petWin.isDestroyed()) return;
          if (config.load().mouseRecord === true) {
            if (recordingActive) {
              recordingActive = false;
              petBroadcast('v2p:hotkey-stop');
            } else {
              recordingActive = true;
              petBroadcast('v2p:hotkey-start');
            }
          }
          return;
        }
        // uiohook 左键 = 1（0 兼容）
        const isLeft = e.button === 1 || e.button === 0;
        if (isLeft && config.load().paletteEnabled !== false) {
          if (isPaletteVisible() && paletteWin && !paletteWin.isDestroyed()) {
            const b = paletteWin.getBounds();
            const inBar = e.x >= b.x && e.x <= b.x + b.width && e.y >= b.y && e.y <= b.y + b.height;
            if (!inBar) {
              dismissPaletteIfVisible();
              return;
            }
            return;
          }
          const gestureId = ++selectionGestureId;
          activeSelectionGesture = { id: gestureId, start: { x: e.x, y: e.y }, clicks: Number(e.clicks) || 1 };
          selDown = true;
          selDragging = false;
          selStartX = e.x;
          selStartY = e.y;
        }
      });
      uIOhook.on('mousemove', (e) => {
        if (!selDown || selDragging) return;
        if (Math.hypot(e.x - selStartX, e.y - selStartY) > 12) selDragging = true;
      });
      uIOhook.on('mouseup', (e) => {
        const isLeft = e.button === 1 || e.button === 0;
        if (!isLeft || !selDown) return;
        selDown = false;
        const gesture = activeSelectionGesture;
        activeSelectionGesture = null;
        const dragged = selDragging;
        selDragging = false;
        if (!gesture || (!dragged && gesture.clicks < 2)) return;
        if (config.load().paletteEnabled === false) return;
        if (isOverOwnWindow(e.x, e.y)) { selDown = false; return; }
        const end = { x: e.x, y: e.y };
        const delay = dragged ? 140 : 160;
        setTimeout(() => {
          captureAndShowPalette(gesture.start, end, e.x, e.y, gesture.id).catch((err) => {
            console.log('[palette]', err && err.message ? err.message : err);
          });
        }, delay);
      });
      // Esc：无副作用关闭浮条（focusable:false 收不到 keydown，走全局钩子）
      uIOhook.on('keydown', (e) => {
        if (e.keycode === 1 || e.keycode === 27) {
          if (dismissPaletteIfVisible()) console.log('[palette] Esc close');
          return;
        }
        if (e.keycode === 46 && (e.ctrlKey || e.metaKey)) {
          lastUserCopyAt = Date.now();
          dismissPaletteIfVisible();
        }
      });
      uIOhook.start();
      mouseHookOn = true;
      console.log('[mouse] hook on');
    } catch (e) {
      console.log('[mouse] hook fail:' + (e.message || e));
    }
  } else {
    try { require('uiohook-napi').uIOhook.stop(); } catch { /* 未启动过 */ }
    mouseHookOn = false;
    console.log('[mouse] hook off');
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
