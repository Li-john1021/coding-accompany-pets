// pet.js — 宠物悬浮窗：长按录音 / 拖拽移动 / 单击开设置 / 状态展示
const stage = document.getElementById('stage');
const petImg = document.getElementById('pet');
const statusEl = document.getElementById('status');
const bubble = document.getElementById('bubble');

// 进入监听时随机弹一句，替代耳机做「在听」的表演反馈
const LISTEN_LINES = [
  '你说，我在听', '嗯嗯，在听呢', '洗耳恭听～', '麦克风就位，请开口',
  '耳朵竖起来了，慢慢说', '在听在听，都记下了', '准备完毕，开麦吧'
];

const STATUS_TEXT = {
  idle: '按住我说话',
  listening: '🎙️ 正在聆听…松开结束',
  transcribing: '👂 语音转文字…',
  polishing: '✨ 整理优化中…',
  inserting: '📋 写入光标…',
  done: '✅ 完成',
  error: '❌ 出错了'
};

let bubbleTimer = null;
function say(text, ms = 3500) {
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
}

function setState(s) {
  const prev = curStage;
  curStage = s;
  stage.className = s + (window.petLive2d && window.petLive2d.active() ? ' live2d' : '');
  statusEl.textContent = STATUS_TEXT[s] || s;
  if (window.petLive2d) window.petLive2d.setState(s);
  if (s === 'listening' && prev !== 'listening' && !calibOn) {
    say(LISTEN_LINES[(Math.random() * LISTEN_LINES.length) | 0], 2600);
  }
}

// ---------------- 录音（PCM 采集 + 前端编 WAV） ----------------
// 说明：部分 ASR（如小米 MiMo）只收 wav/mp3，不收 webm，
// 故弃用 MediaRecorder 的 webm 输出，改为 ScriptProcessor 采 PCM 直接编成 16k 单声道 WAV。
let mediaStream = null;
let audioCtx = null;
let procNode = null;
let pcmBuffers = [];
let isRecording = false;
let starting = false;   // 堆塞 getUserMedia 挂起期间的双启动竞态
let cancelled = false;  // 拖拽取消录音时，不提交半截音频

const TARGET_SAMPLE_RATE = 16000;

// 把麦克风音量告诉 Live2D，驱动“听你说话时头部跟着摆”；节流到 30Hz
let lastLoudAt = 0;
function reportLoudness(data) {
  const now = performance.now();
  if (now - lastLoudAt < 33) return;
  lastLoudAt = now;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / data.length);
  if (window.petLive2d) window.petLive2d.setLoudness(rms);
}

function downsample(channelData, fromRate, toRate) {
  if (fromRate === toRate) return channelData;
  const ratio = fromRate / toRate;
  const len = Math.floor(channelData.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), channelData.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += channelData[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

async function startRecording() {
  if (isRecording || starting) return;
  starting = true;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    starting = false;
    window.v2p.setRecordingFlag(false); // 失败回传，避免主进程热键状态失同步
    setState('error');
    say('无法访问麦克风：' + (e.message || e));
    setTimeout(() => setState('idle'), 3000);
    return;
  }
  starting = false;
  pcmBuffers = [];
  cancelled = false;
  audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(mediaStream);
  procNode = audioCtx.createScriptProcessor(4096, 1, 1);
  procNode.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    pcmBuffers.push(downsample(data.slice(), audioCtx.sampleRate, TARGET_SAMPLE_RATE));
    reportLoudness(data);
  };
  source.connect(procNode);
  procNode.connect(audioCtx.destination);
  isRecording = true;
  setState('listening');
  window.v2p.setRecordingFlag(true);
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  if (window.petLive2d) window.petLive2d.setLoudness(0);
  try {
    if (procNode) { procNode.disconnect(); procNode = null; }
    if (audioCtx) { await audioCtx.close(); audioCtx = null; }
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  } catch { /* ignore */ }

  if (cancelled) {
    cancelled = false;
    pcmBuffers = [];
    setState('idle');
    say('已取消');
    window.v2p.setRecordingFlag(false);
    return;
  }
  try {
    const total = pcmBuffers.reduce((n, b) => n + b.length, 0);
    const merged = new Float32Array(total);
    let off = 0;
    for (const b of pcmBuffers) { merged.set(b, off); off += b.length; }
    pcmBuffers = [];
    const wav = encodeWav(merged, TARGET_SAMPLE_RATE);
    if (wav.length < 6000) { setState('idle'); say('录音太短啦，再试一次'); return; }
    setState('transcribing');
    statusEl.textContent = '👂 语音转文字…';
    const res = await window.v2p.submit(wav, 'audio/wav');
    if (!res.ok) {
      setState('error');
      say(res.error || '处理失败', 6000);
      setTimeout(() => setState('idle'), 4000);
    }
  } catch (e) {
    setState('error');
    say('提交失败：' + (e.message || e), 6000);
    setTimeout(() => setState('idle'), 4000);
  } finally {
    window.v2p.setRecordingFlag(false);
  }
}

// ---------------- 鼠标交互：拖动=移动；录音触发方式由设置切换 ----------------
// hold（默认）：长按=录音，松开结束，拖动取消；单击=打开设置
// click：单击=开始监听，再次单击=结束并转录；右键=打开设置；拖动=移动/取消
let triggerMode = 'hold';

let down = false, dragging = false, holdTimer = null;
let lastX = 0, lastY = 0, startX = 0, startY = 0;
let downTime = 0;   // click 模式防误触：过长的按住不算「单击」
let hpDrag = null;  // Alt+拖动校准耳机（此时不移动窗口、不触发录音）
// 耳机校准模式：耳机平时只在录音时显形，调它之前得先能看见——
// Alt 悬停/按住即显形+头部定格，停止 Alt 操作约 1.5s 后自动退出
let calibOn = false, calibUntil = 0, curStage = 'idle';
function setCalib(on) {
  if (on === calibOn) return;
  calibOn = on;
  if (window.petLive2d) window.petLive2d.setCalibrating(on);
  if (on) updateCalibStatus();
  else statusEl.textContent = STATUS_TEXT[curStage] || curStage;
}
function updateCalibStatus() {
  const hp = window.petLive2d.getHP();
  statusEl.textContent = `🎧 校准 x${(hp.cx * 100).toFixed(1)} y${(hp.cy * 100).toFixed(1)}`
    + ` 缩${(hp.targetSpan * 100).toFixed(0)} 转${(hp.rotDeg || 0).toFixed(0)}°`
    + ` · 拖动平移 Alt+滚轮缩放 Shift+滚轮旋转`;
}
function pokeCalib(ms) {
  calibUntil = performance.now() + ms;
  setCalib(true);
}
setInterval(() => { if (calibOn && performance.now() > calibUntil) setCalib(false); }, 250);
const calibRecent = () => calibOn || performance.now() < calibUntil;

// 耳机配件总开关（设置里可关）：关了录音也不戴，Alt 校准一并失效
let hpEnabled = true;
function applyHpEnabled(on) {
  hpEnabled = !!on;
  if (window.petLive2d) window.petLive2d.setHeadphoneEnabled(hpEnabled);
  if (!hpEnabled) { hpDrag = null; setCalib(false); }
}
window.v2p.getConfig().then((cfg) => applyHpEnabled(cfg && cfg.petHeadphoneEnabled !== false));
if (window.v2p.onHeadphoneEnabledChanged) window.v2p.onHeadphoneEnabledChanged(applyHpEnabled);

// ---------------- 向量眼睛贴片(三种模式:model 原眼 / painted 手绘 / vector 圆贴片) ----------------
// vector 模式下:Ctrl+拖动=整对移动, Ctrl+滚轮=大小, Ctrl+Shift+滚轮=眼距;设置页改颜色
let eyes = null, eyesDrag = null, eyesUntil = 0, eyesTimer = null;
function applyEyes(cfg) {
  eyes = (cfg && cfg.mode === 'vector') ? cfg : null;
  if (window.petLive2d) window.petLive2d.setEyes(eyes);
}
function eyesPoke() {
  eyesUntil = performance.now() + 2000;
  statusEl.textContent = `👁 眼睛:拖动移动 · Ctrl+滚轮大小 · Ctrl+Shift+滚轮眼距 · Ctrl+Alt+滚轮旋转(${(eyes.rot || 0).toFixed(0)}°)`;
}
setInterval(() => {
  if (eyesUntil && performance.now() > eyesUntil && !eyesDrag) {
    eyesUntil = 0;
    statusEl.textContent = STATUS_TEXT[curStage] || curStage;
  }
}, 250);
function eyesPush() {
  clearTimeout(eyesTimer);
  eyesTimer = setTimeout(() => window.v2p.setEyes(eyes), 150);
}
function eyesMovePair(dxCss, dyCss) {
  if (!eyes) return;
  const k = stage.getBoundingClientRect().width / 284;
  eyes.cxL += dxCss / k / 284; eyes.cxR += dxCss / k / 284;
  eyes.cyL += dyCss / k / 164; eyes.cyR += dyCss / k / 164;
  applyEyes(eyes); eyesPush();
}
function eyesSize(dir) {
  if (!eyes) return;
  eyes.r = Math.max(0.015, Math.min(0.3, eyes.r * (dir > 0 ? 1.06 : 1 / 1.06)));
  applyEyes(eyes); eyesPush();
}
function eyesGap(dir) {
  if (!eyes) return;
  const d = dir * 0.008;
  eyes.cxL -= d; eyes.cxR += d;
  applyEyes(eyes); eyesPush();
}
function eyesRotate(dir) {
  if (!eyes) return;
  eyes.rot = Math.max(-45, Math.min(45, (eyes.rot || 0) + dir * 3));
  applyEyes(eyes); eyesPush();
}
window.v2p.getConfig().then((cfg) => applyEyes(cfg && cfg.petEyes));
if (window.v2p.onEyesChanged) window.v2p.onEyesChanged(applyEyes);

function cancelHold() { clearTimeout(holdTimer); holdTimer = null; }

// click 模式：一次完整的点击（未拖动）切换监听状态
function clickToggle() {
  if (isRecording) stopRecording();
  else if (!starting) startRecording();
}

stage.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (e.altKey && hpEnabled) { hpDrag = { x: e.screenX, y: e.screenY }; pokeCalib(2500); return; }   // 耳机校准
  if (e.altKey) return;
  if (e.ctrlKey && eyes) { eyesDrag = { x: e.screenX, y: e.screenY }; eyesPoke(); return; }         // 眼睛对位
  if (e.ctrlKey) return;
  if (calibRecent()) return;   // 刚在校准,这次点击当作收尾,不触发录音/菜单
  down = true; dragging = false;
  downTime = performance.now();
  startX = lastX = e.screenX;
  startY = lastY = e.screenY;
  if (triggerMode === 'hold') holdTimer = setTimeout(() => { if (down && !dragging) startRecording(); }, 260);
});

window.addEventListener('mousemove', (e) => {
  if (hpDrag) { hpNudge(e.screenX - hpDrag.x, e.screenY - hpDrag.y); hpDrag.x = e.screenX; hpDrag.y = e.screenY; pokeCalib(2500); return; }
  if (eyesDrag) { eyesMovePair(e.screenX - eyesDrag.x, e.screenY - eyesDrag.y); eyesDrag.x = e.screenX; eyesDrag.y = e.screenY; eyesPoke(); return; }
  if (e.altKey && hpEnabled) pokeCalib(1500);   // Alt 悬停:耳机显形供观察
  if (!down) return;
  const dx = e.screenX - lastX, dy = e.screenY - lastY;
  if (!dragging && Math.hypot(e.screenX - startX, e.screenY - startY) > 8) {
    dragging = true;
    cancelHold();
    if (isRecording) {
      cancelled = true; // 拖动取消录音，onstop 不会提交半截音频
      stopRecording();
    }
  }
  if (dragging && (dx || dy)) {
    lastX = e.screenX; lastY = e.screenY;
    window.v2p.petMove(dx, dy);
  }
});

window.addEventListener('mouseup', (e) => {
  if (hpDrag) { hpDrag = null; hpPush(); pokeCalib(1500); return; }
  if (eyesDrag) { eyesDrag = null; eyesPoke(); return; }
  if (e.button !== 0 || !down) return;
  down = false;
  cancelHold();
  if (triggerMode === 'hold') {
    if (isRecording) stopRecording();
    else if (!dragging) window.v2p.openSettings(); // 单击打开设置
  } else if (!dragging && performance.now() - downTime < 500 && !calibRecent()) {
    // 防误触：按住超过 500ms 才松手（明显不是干脆的单击）不触发
    clickToggle();
  }
  dragging = false;
});

// ---------------- 滚轮缩放 & 耳机校准 ----------------
// 普通滚轮：整窗缩放（0.6~2.5，主进程持久化）；Alt+滚轮：缩放耳机；
// Alt+拖动：平移耳机。校准值写回 config.petHeadphone，换肤后可重新校
let hpTimer = null;
function hpPush() {
  clearTimeout(hpTimer);
  hpTimer = setTimeout(() => window.v2p.setHeadphoneTweak(window.petLive2d.getHP()), 120);
}
function hpNudge(dxCss, dyCss) {
  const s = stage.getBoundingClientRect().width / 284;   // 换算当前窗口缩放
  const hp = window.petLive2d.getHP();
  const next = { ...hp, cx: hp.cx + dxCss / s / 284, cy: hp.cy + dyCss / s / 164 };
  window.petLive2d.setHPOverride(next);
  hpPush();
}
function hpZoom(dir) {
  const hp = window.petLive2d.getHP();
  const next = { ...hp, targetSpan: Math.max(0.05, Math.min(0.8, hp.targetSpan * (dir > 0 ? 1.05 : 1 / 1.05))) };
  window.petLive2d.setHPOverride(next);
  hpPush();
  updateCalibStatus();
}
function hpRotate(dir) {
  const hp = window.petLive2d.getHP();
  const next = { ...hp, rotDeg: Math.max(-45, Math.min(45, (hp.rotDeg || 0) + dir * 2)) };
  window.petLive2d.setHPOverride(next);
  hpPush();
  updateCalibStatus();
}
window.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Shift 按下时 Chromium 会把 deltaY 轴翻到 deltaX（横向滚动语义），取幅值大的为准
  const dir = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) < 0 ? 1 : -1;
  if (e.ctrlKey && eyes) {
    e.preventDefault();
    if (e.altKey) eyesRotate(dir);
    else if (e.shiftKey) eyesGap(dir);
    else eyesSize(dir);
    eyesPoke();
    return;
  }
  if (e.altKey && hpEnabled) hpZoom(dir);
  else if (e.shiftKey && hpEnabled) hpRotate(dir);
  else window.v2p.petScale(dir);
}, { passive: false });

// 耳机校准值：启动时读配置，主进程广播（含本窗发出后的回声）时应用
window.v2p.getConfig().then((cfg) => { if (cfg && cfg.petHeadphone) window.petLive2d.setHPOverride(cfg.petHeadphone); });
window.v2p.onHeadphoneChanged((hp) => window.petLive2d.setHPOverride(hp));

// click 模式下左键被录音占用，设置走右键；hold 模式右键无功能（避免误触）
stage.addEventListener('contextmenu', (e) => {
  if (triggerMode === 'click') { e.preventDefault(); window.v2p.openSettings(); }
});

// ---------------- 主进程事件 ----------------
window.v2p.onState(setState);
window.v2p.onLoudness((v) => { if (window.petLive2d) window.petLive2d.setLoudness(v); });
if (window.v2p.onProbe) window.v2p.onProbe((o) => { if (window.petLive2d) window.petLive2d.setProbe(o); });
window.v2p.onResult((r) => {
  setState('done');
  const note = r.copiedOnly ? '（已复制到剪贴板）' : '';
  say(r.polished.slice(0, 90) + (r.polished.length > 90 ? '…' : '') + note, 5000);
  setTimeout(() => setState('idle'), 3000);
});
window.v2p.onToast((text) => { say(text, 5000); setState('error'); setTimeout(() => setState('idle'), 3500); });
window.v2p.onHotkeyStart(startRecording);
window.v2p.onHotkeyStop(stopRecording);
window.v2p.onPetImageChanged((dataUrl) => { if (dataUrl) petImg.src = dataUrl; });

// 交互方式：初始读取配置，设置页改动后实时切换；待命提示语随模式变化
function applyTriggerMode(mode) {
  triggerMode = mode === 'click' ? 'click' : 'hold';
  STATUS_TEXT.idle = triggerMode === 'click' ? '点我开始听' : '按住我说话';
  if (stage.classList.contains('idle')) statusEl.textContent = STATUS_TEXT.idle;
}
window.v2p.getConfig().then((cfg) => applyTriggerMode(cfg && cfg.triggerMode));
window.v2p.onTriggerModeChanged(applyTriggerMode);

(async () => {
  // 优先 Live2D 皮肤；加载失败（无模型/无运行时）回退静态图
  let live2dOk = false;
  try {
    const { url } = await window.v2p.petModel();
    if (url && window.petLive2d) {
      const entry = url + 'cat.model3.json';
      live2dOk = await window.petLive2d.loadModel(entry);
    }
  } catch (e) { console.warn('[live2d] 启动加载失败，回退静态图', e); }
  if (!live2dOk) {
    const { dataUrl } = await window.v2p.petImage();
    if (dataUrl) petImg.src = dataUrl;
  }
})();

window.v2p.onPetModelChanged(async () => {
  // 设置页切换皮肤：重新加载，失败回退静态图
  const { url } = await window.v2p.petModel();
  const ok = url && window.petLive2d && await window.petLive2d.loadModel(url + 'cat.model3.json');
  if (!ok) { const { dataUrl } = await window.v2p.petImage(); if (dataUrl) petImg.src = dataUrl; }
});
