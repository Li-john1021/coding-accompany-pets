// pet.js — 宠物悬浮窗：长按录音 / 拖拽移动 / 单击开设置 / 状态展示
const stage = document.getElementById('stage');
const petImg = document.getElementById('pet');
const statusEl = document.getElementById('status');
const bubble = document.getElementById('bubble');
const actionRow = document.getElementById('action-row');
const actionButtons = [...document.querySelectorAll('#action-row .pet-action')];
const imageHelp = document.getElementById('image-help');

// 进入监听时随机弹一句「在听」的表演反馈
const LISTEN_LINES = [
  '你说，我在听', '嗯嗯，在听呢', '洗耳恭听～', '麦克风就位，请开口',
  '耳朵竖起来了，慢慢说', '在听在听，都记下了', '准备完毕，开麦吧'
];

const STATUS_TEXT = {
  idle: '按住我说话',
  listening: '🎙️ 正在聆听…松开结束',
  transcribing: '👂 语音转文字…',
  structuring: '≡ 结构化中…',
  optimizing: '✨ 优化提示词中…',
  polishing: '✨ 整理优化中…',
  inserting: '📋 写入光标…',
  processing: '正在处理…',
  done: '✅ 完成',
  error: '❌ 出错了'
};

const STATUS_CLASS = {
  structuring: 'mode-structure',
  optimizing: 'mode-optimize',
  polishing: 'mode-optimize',
  error: 'mode-error'
};

let bubbleTimer = null;
let voiceUiEpoch = 0;
let uiStateEpoch = 0;
const VOICE_UI_STAGES = new Set(['listening', 'transcribing']);
function say(text, ms = 3500) {
  bubble.textContent = text;
  bubble.classList.add('show');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
}

function setState(s) {
  const prev = curStage;
  uiStateEpoch++;
  if (VOICE_UI_STAGES.has(s) && !VOICE_UI_STAGES.has(prev)) voiceUiEpoch++;
  curStage = s;
  stage.className = s + (window.petLive2d && window.petLive2d.active() ? ' live2d' : '');
  statusEl.className = STATUS_CLASS[s] || '';
  let text = STATUS_TEXT[s] || s;
  if (s === 'structuring' || s === 'optimizing' || s === 'polishing') {
    text = '<span class="pulse">' + text + '</span>';
    statusEl.innerHTML = text;
  } else {
    statusEl.textContent = text;
  }
  if (window.petLive2d) window.petLive2d.setState(s);
  updateActionButtons();
  if (s === 'listening' && prev !== 'listening') {
    say(LISTEN_LINES[(Math.random() * LISTEN_LINES.length) | 0], 2600);
  }
}

function scheduleIdle(delayMs) {
  const expectedVoiceEpoch = voiceUiEpoch;
  const expectedStateEpoch = uiStateEpoch;
  setTimeout(() => {
    if (voiceUiBusy() || voiceUiEpoch !== expectedVoiceEpoch || uiStateEpoch !== expectedStateEpoch) return;
    setState('idle');
  }, delayMs);
}

let activePetAction = null;
let imageState = null;
let imageUiEpoch = 0;
function updateActionButtons() {
  const voiceBusy = voiceUiBusy();
  const imageBusy = !!(imageState && imageState.busy);
  for (const button of actionButtons) {
    const mode = button.dataset.mode;
    if (mode === 'image_recognition') button.title = imageState?.reason || '识别剪贴板图片并复制文字';
    button.classList.toggle('active', mode === activePetAction);
    button.disabled = voiceBusy || imageBusy || (!!activePetAction && mode !== activePetAction) ||
      (mode === 'screenshot' && imageState && imageState.canScreenshot === false) ||
      (mode === 'image_recognition' && (!imageState || !imageState.eligible));
    if (mode === activePetAction) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
  }
  if (imageHelp) {
    const needsSetup = imageState?.hasImage && !imageState.busy && !voiceBusy && (!imageState.providerReady || !imageState.multimodal);
    imageHelp.style.display = needsSetup ? 'block' : 'none';
    imageHelp.textContent = needsSetup ? `${imageState.reason}（点此设置）` : '';
  }
}
if (imageHelp) imageHelp.addEventListener('click', (event) => { event.stopPropagation(); window.v2p.openSettings(); });

function voiceUiBusy() {
  return ['listening', 'transcribing'].includes(curStage) || starting || isRecording || stopping;
}

for (const button of actionButtons) {
  for (const eventName of ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'wheel']) {
    button.addEventListener(eventName, (event) => event.stopPropagation());
  }
  button.addEventListener('click', async () => {
    if (activePetAction || ['listening', 'transcribing'].includes(curStage) || isRecording || starting) return;
    const mode = button.dataset.mode;
    if (mode === 'screenshot' || mode === 'image_recognition') {
      const operation = ++imageUiEpoch;
      activePetAction = mode;
      updateActionButtons();
      if (mode === 'image_recognition') { setState('processing'); statusEl.textContent = '识图中…'; }
      try {
        const result = mode === 'screenshot' ? await window.v2p.screenshot() : await window.v2p.recognizeImage();
        if (operation !== imageUiEpoch || voiceUiBusy()) return;
        if (mode === 'screenshot') {
          if (result && result.ok) {
            imageState = await window.v2p.getImageState();
            say(imageState.eligible ? `截图已复制（${result.width}×${result.height}），可点击识图` : `截图已复制。${imageState.reason || ''}`, 6000);
          }
          else if (result && !['cancelled', 'zero-area'].includes(result.reason)) { say(result.error || '截图失败，请重试', 4500); setState('error'); scheduleIdle(4500); }
        } else if (result && result.ok) {
          say('识图完成，文字已复制', 4500); setState('done'); scheduleIdle(4000);
        } else {
          say((result && result.error) || '识图失败，请重试', 5000); setState('error'); scheduleIdle(5000);
        }
      } catch (error) {
        if (operation === imageUiEpoch) { say(error.message || '操作失败，请重试', 4500); setState('error'); scheduleIdle(4500); }
      } finally {
        if (operation === imageUiEpoch) { activePetAction = null; updateActionButtons(); }
      }
      return;
    }
    if (mode !== 'structure' && mode !== 'optimize') return;
    activePetAction = mode;
    setState(mode === 'structure' ? 'structuring' : 'optimizing');
    const actionVoiceEpoch = voiceUiEpoch;
    try {
      const settlement = await window.petActionSettlement.invoke(
        () => window.v2p.petAction(mode),
        () => voiceUiBusy() || actionVoiceEpoch !== voiceUiEpoch,
        () => {
          say('文本操作暂不可用', 3500);
          setState('idle');
        }
      );
      if (settlement.status !== 'resolved') return;
      const result = settlement.value;
      if (voiceUiBusy() || actionVoiceEpoch !== voiceUiEpoch || (result && result.voiceSuperseded)) return;
      if (result && result.capture && result.capture.kind === 'authorized') {
        if (!result.ok) {
          say(result.error || '文本处理失败', 5000);
          setState('error');
          scheduleIdle(5000);
        } else {
          say(result.note ? `处理完成，结果已复制 · ${result.note}` : '处理完成，结果已复制', 5000);
          setState('done');
          scheduleIdle(5000);
        }
      } else if (result && result.capture && result.capture.kind === 'cancelled') {
        say('捕获已取消，请重新操作', 3500);
        setState('idle');
      } else if (result && result.capture && result.capture.kind === 'rejected') {
        say((result && result.error) || '文本捕获未完成', 3500);
        setState('idle');
      } else
      if (!result || !result.ok) {
        say((result && result.error) || '文本操作暂不可用', 3500);
        setState('idle');
      } else {
        say('已完成', 3000);
        setState('done');
        scheduleIdle(3000);
      }
    } finally {
      activePetAction = null;
      updateActionButtons();
    }
  });
}
actionRow.addEventListener('wheel', (event) => event.stopPropagation());

// ---------------- 录音（AudioWorklet PCM + 前端编 WAV） ----------------
let mediaStream = null;
let audioCtx = null;
let captureNode = null;
let captureSource = null;
let captureGain = null;
let pcmBuffers = [];
let isRecording = false;
let starting = false;   // 堆塞 getUserMedia 挂起期间的双启动竞态
let stopping = false;   // 停止/flush/提交期间禁止新的录音复用全局采集引用
let cancelled = false;  // 拖拽取消录音时，不提交半截音频
let captureFailed = false;
let captureMode = 'worklet';
let captureSession = 0;
let captureFlush = null;

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

function disconnectCapture() {
  if (captureSource) { try { captureSource.disconnect(); } catch {} captureSource = null; }
  if (captureNode) { try { captureNode.disconnect(); } catch {} captureNode = null; }
  if (captureGain) { try { captureGain.disconnect(); } catch {} captureGain = null; }
}

async function releaseAudioResources() {
  disconnectCapture();
  captureFlush = null;
  if (audioCtx) { try { await audioCtx.close(); } catch {} audioCtx = null; }
  if (mediaStream) { try { mediaStream.getTracks().forEach((track) => track.stop()); } catch {} mediaStream = null; }
}

async function startRecording() {
  if (isRecording || starting || stopping) return;
  starting = true;
  const previousStage = curStage;
  setState('listening');
  updateActionButtons();
  let admitted = false;
  try {
    const admission = await window.v2p.setRecordingFlag(true);
    if (admission && admission.ok === false) {
      setState(previousStage);
      updateActionButtons();
      say(admission.error || '已有操作正在进行');
      return;
    }
    admitted = true;
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setState('error');
      say('无法访问麦克风：' + (e.message || e));
      scheduleIdle(3000);
      return;
    }
    const sessionId = ++captureSession;
    pcmBuffers = [];
    cancelled = false;
    captureFailed = false;
    try {
      audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(mediaStream);
      captureSource = source;
      try {
        await audioCtx.audioWorklet.addModule('audio-capture-worklet.js');
        captureNode = new AudioWorkletNode(audioCtx, 'v2p-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        captureMode = 'worklet';
        captureNode.addEventListener('processorerror', () => { captureFailed = true; if (isRecording) stopRecording(); });
        captureNode.port.onmessage = (event) => {
          const data = event.data;
          if (data?.type === 'pcm') pcmBuffers.push(data.samples);
          else if (data?.type === 'level') reportLoudness(Float32Array.of(data.rms));
          else if (data?.type === 'flushed' && captureFlush && data.sessionId === captureFlush.sessionId) {
            const finish = captureFlush.resolve;
            captureFlush = null;
            finish();
          }
        };
        captureSource.connect(captureNode);
        captureGain = audioCtx.createGain();
        captureGain.gain.value = 0;
        captureNode.connect(captureGain).connect(audioCtx.destination);
      } catch (error) {
        try { captureNode?.disconnect(); } catch {}
        captureNode = null;
        captureMode = 'script-processor-fallback';
        captureNode = audioCtx.createScriptProcessor(4096, 1, 1);
        captureNode.onaudioprocess = (event) => {
          const data = event.inputBuffer.getChannelData(0);
          pcmBuffers.push(downsample(data.slice(), audioCtx.sampleRate, TARGET_SAMPLE_RATE));
          reportLoudness(data);
        };
        captureSource.connect(captureNode);
        captureNode.connect(audioCtx.destination);
      }
      isRecording = true;
      for (const track of mediaStream.getAudioTracks()) track.addEventListener('ended', () => { if (isRecording) { captureFailed = true; stopRecording(); } }, { once: true });
      setState('listening');
      updateActionButtons();
    } catch (error) {
      await releaseAudioResources();
      setState('error');
      say('无法开始录音：' + (error.message || error));
      scheduleIdle(4000);
    }
  } catch (error) {
    setState('error');
    say('无法开始录音：' + (error.message || error));
    scheduleIdle(4000);
  } finally {
    starting = false;
    if (admitted && !isRecording) {
      try { await window.v2p.setRecordingFlag(false); } catch {}
    }
  }
}

async function stopRecording() {
  if (!isRecording || stopping) return;
  isRecording = false;
  stopping = true;
  if (window.petLive2d) window.petLive2d.setLoudness(0);
  try {
    if (captureMode === 'worklet' && captureNode) {
      const sessionId = captureSession;
      const flushed = new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (captureFlush?.sessionId === sessionId) captureFlush = null;
          captureFailed = true;
          resolve();
        }, 1500);
        captureFlush = { sessionId, resolve: () => { clearTimeout(timer); resolve(); } };
      });
      captureNode.port.postMessage({ type: 'flush', sessionId });
      await flushed;
    } else if (captureMode === 'script-processor-fallback' && audioCtx) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  } catch {
    captureFailed = true;
  }
  await releaseAudioResources();

  try {
    if (cancelled) {
      cancelled = false;
      pcmBuffers = [];
      setState('idle');
      say('已取消');
      return;
    }
    if (captureFailed) {
      let saved = null;
      let saveError = '';
      try {
        const total = pcmBuffers.reduce((n, block) => n + block.length, 0);
        const merged = new Float32Array(total);
        let offset = 0;
        for (const block of pcmBuffers) { merged.set(block, offset); offset += block.length; }
        if (merged.length) {
          saved = await window.v2p.audioRecoverySave(encodeWav(merged, TARGET_SAMPLE_RATE));
          if (!saved?.ok || typeof saved.id !== 'string') saveError = saved?.error || '恢复录音保存失败';
        } else {
          saveError = '没有采集到音频';
        }
      } catch (error) {
        saveError = String(error.message || error);
      }
      pcmBuffers = [];
      setState('error');
      if (saved?.ok && typeof saved.id === 'string') say('录音采集中断，已保存可恢复内容', 7000);
      else say(`录音采集中断；${saveError || '恢复录音保存失败'}`, 7000);
      try { await window.v2p.setRecordingFlag(false); } catch {}
      if (saved?.ok && typeof saved.id === 'string') showAudioRecovery(saved.id); else hideAudioRecovery();
      return;
    }
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
      try { await window.v2p.setRecordingFlag(false); } catch {}
      showAudioRecovery(res.recoveryId);
      scheduleIdle(4000);
    } else {
      hideAudioRecovery();
      if (res.recoveryError) say(`恢复录音未保存：${res.recoveryError}`, 6000);
    }
  } catch (e) {
    setState('error');
    say('提交失败：' + (e.message || e), 6000);
    try { await window.v2p.setRecordingFlag(false); } catch {}
    showAudioRecovery();
    scheduleIdle(4000);
  } finally {
    stopping = false;
    try { await window.v2p.setRecordingFlag(false); } catch {}
    updateActionButtons();
  }
}

const recoveryButton = document.getElementById('retry-recording');
const rawRecoveryButton = document.getElementById('copy-recording-text');
const recoveryPanel = document.getElementById('audio-recovery');
function showAudioRecovery(expectedId) {
  if (!recoveryPanel) return;
  window.v2p.audioRecoveryGet().then((saved) => {
    const has = !!(saved?.wav || saved?.raw);
    const matches = expectedId === undefined ? has : expectedId !== null && saved?.id === expectedId;
    const visible = has && matches;
    recoveryPanel.style.display = visible ? 'flex' : 'none';
    rawRecoveryButton.style.display = visible && saved?.raw ? 'block' : 'none';
  }).catch(() => {});
}
function hideAudioRecovery() { if (recoveryPanel) recoveryPanel.style.display = 'none'; }
if (recoveryButton && rawRecoveryButton) {
recoveryButton.type = 'button';
recoveryButton.textContent = '恢复上次录音';
recoveryButton.title = '重新识别上次失败的录音';
recoveryButton.style.cssText = 'display:none;margin:5px auto 0;padding:5px 10px;border:1px solid #fff;border-radius:6px;background:#fff;color:#263238;font:600 12px Segoe UI,Microsoft YaHei,sans-serif;cursor:pointer;';
rawRecoveryButton.type = 'button';
rawRecoveryButton.textContent = '复制已识别原文';
rawRecoveryButton.title = '复制上次失败处理的原始转写';
rawRecoveryButton.style.cssText = recoveryButton.style.cssText;
rawRecoveryButton.style.display = 'none';
recoveryButton.style.display = 'block';
for (const node of [recoveryButton, rawRecoveryButton]) {
  for (const eventName of ['pointerdown', 'mousedown', 'mouseup', 'dblclick', 'wheel']) node.addEventListener(eventName, (event) => event.stopPropagation());
}
recoveryButton.addEventListener('click', async () => {
  if (voiceUiBusy() || activePetAction || imageState?.busy) return;
  recoveryButton.disabled = true;
  try {
    const recovered = await window.v2p.audioRecoveryGet();
    if (!recovered?.ok || !recovered.wav) throw new Error(recovered?.error || '没有可恢复录音');
    setState('transcribing');
    say('正在重新识别录音…', 30000);
    const result = await window.v2p.submit(new Uint8Array(recovered.wav), 'audio/wav', { recoveryCopyOnly: true, mode: 'none' });
    if (!result?.ok) {
      showAudioRecovery(result?.recoveryId);
      throw new Error(result?.error || '重新识别失败');
    }
    hideAudioRecovery();
    say(result.recoveryError ? `恢复完成，但恢复录音未保存：${result.recoveryError}` : '恢复完成，结果已复制', 5000);
    setState('done');
    scheduleIdle(5000);
  } catch (error) {
    say(`恢复失败：${error.message || error}`, 6000);
    setState('error');
  } finally {
    recoveryButton.disabled = false;
  }
});
showAudioRecovery();
rawRecoveryButton.addEventListener('click', async () => {
  if (voiceUiBusy() || activePetAction || imageState?.busy) return;
  rawRecoveryButton.disabled = true;
  try {
    const recovered = await window.v2p.audioRecoveryGet();
    if (!recovered?.id || !recovered.raw) throw new Error('没有可复制的识别原文');
    const result = await window.v2p.audioRecoveryText(recovered.id);
    if (!result?.ok) throw new Error(result?.error || '复制原文失败');
    say('已复制识别原文', 4000);
  } catch (error) {
    say(`复制失败：${error.message || error}`, 5000);
  } finally {
    rawRecoveryButton.disabled = false;
  }
});
}
if (window.v2p.onAsrProgress) window.v2p.onAsrProgress((progress) => {
  if (curStage === 'transcribing' && progress.total > 1) statusEl.textContent = `👂 转录 ${Math.min(progress.completed + 1, progress.total)}/${progress.total} 段…`;
});

// ---------------- 鼠标交互：拖动=移动；录音触发方式由设置切换 ----------------
// hold（默认）：长按=录音，松开结束，拖动取消；单击=打开设置
// click：单击=开始监听，再次单击=结束并转录；右键=打开设置；拖动=移动/取消
let triggerMode = 'hold';

let down = false, dragging = false, holdTimer = null;
let lastX = 0, lastY = 0, startX = 0, startY = 0;
let downTime = 0;   // click 模式防误触：过长的按住不算「单击」
let curStage = 'idle';

function cancelHold() { clearTimeout(holdTimer); holdTimer = null; }

// click 模式：一次完整的点击（未拖动）切换监听状态
function clickToggle() {
  if (isRecording) stopRecording();
  else if (!starting) startRecording();
}

stage.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  down = true; dragging = false;
  downTime = performance.now();
  startX = lastX = e.screenX;
  startY = lastY = e.screenY;
  if (triggerMode === 'hold') holdTimer = setTimeout(() => { if (down && !dragging) startRecording(); }, 260);
});

window.addEventListener('mousemove', (e) => {
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
  const releaseAction = window.resolvePetMouseUp({
    button: e.button,
    bodyGestureActive: down,
    targetInActionRow: !!(e.target.closest && e.target.closest('#action-row')),
    triggerMode,
    recording: isRecording,
    dragging,
    elapsedMs: performance.now() - downTime
  });
  if (releaseAction === 'ignore') return;
  down = false;
  cancelHold();
  if (releaseAction === 'stop-recording') {
    stopRecording();
    dragging = false;
    return;
  }
  if (releaseAction === 'discard') {
    dragging = false;
    return;
  }
  if (releaseAction === 'open-settings') {
    window.v2p.openSettings();
  } else if (releaseAction === 'toggle-recording') {
    // 防误触：按住超过 500ms 才松手（明显不是干脆的单击）不触发
    clickToggle();
  }
  dragging = false;
});

  // ---------------- 滚轮缩放 ----------------
window.addEventListener('wheel', (e) => {
  e.preventDefault();
  window.v2p.petScale((Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) < 0 ? 1 : -1);
}, { passive: false });


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
  // 底部文字条：分色完成态；降级用警示色并写明级别
  const note = r.copiedOnly ? '（已复制）' : '';
  const body = (r.polished || r.raw || '').slice(0, 60);
  if (r.degraded) {
    statusEl.className = 'mode-error';
    statusEl.textContent = '⚠ ' + (r.note || '已降级') + note + ' · ' + body;
  } else {
    const modeTag = r.mode === 'structure' ? '≡ 结构化完成' : r.mode === 'optimize' ? '✨ 优化完成' : '✅ 完成';
    statusEl.className = r.mode === 'structure' ? 'mode-done-structure' : r.mode === 'optimize' ? 'mode-done-optimize' : '';
    statusEl.textContent = modeTag + note + (r.note ? ' · ' + r.note : '') + ' · ' + body;
  }
  say((r.polished || '').slice(0, 90) + ((r.polished || '').length > 90 ? '…' : '') + note, 5000);
  scheduleIdle(3000);
});
window.v2p.onToast((payload) => {
  const text = typeof payload === 'string' ? payload : payload?.text;
  if (!text) return;
  say(text, 5000);
  const level = typeof payload === 'string' ? 'error' : (payload.level || 'error');
  if (level === 'error') { setState('error'); scheduleIdle(3500); }
});
window.v2p.onHotkeyStart(startRecording);
window.v2p.onHotkeyStop(stopRecording);
window.v2p.onPetImageChanged((dataUrl) => { if (dataUrl) petImg.src = dataUrl; });
window.v2p.onImageState((state) => {
  imageState = state;
  const recognize = actionButtons.find((button) => button.dataset.mode === 'image_recognition');
  if (recognize) recognize.title = state.error || (state.eligible ? '识图' : state.busy ? '识图中' : '需要剪贴板图片和已启用多模态模型');
  if (state.busy && !voiceUiBusy()) {
    if (curStage !== 'processing') setState('processing');
    statusEl.textContent = state.stage === 'capturing' ? '截图中…' : '识图中…';
  } else if (!state.busy && curStage === 'processing') {
    setState('idle');
  }
  updateActionButtons();
});
window.v2p.getImageState().then((state) => { imageState = state; updateActionButtons(); }).catch(() => {});

// 交互方式：初始读取配置，设置页改动后实时切换；待命提示语随模式变化
function applyTriggerMode(mode) {
  triggerMode = mode === 'click' ? 'click' : 'hold';
  STATUS_TEXT.idle = triggerMode === 'click' ? '点我开始听' : '按住我说话';
  if (stage.classList.contains('idle')) statusEl.textContent = STATUS_TEXT.idle;
}
window.v2p.getConfig().then((cfg) => applyTriggerMode(cfg && cfg.triggerMode));
window.v2p.onTriggerModeChanged(applyTriggerMode);

(async () => {
  let live2dOk = false;
  try {
    const { url } = await window.v2p.petModel();
    console.log('[pet] model url=' + (url || '(none)'));
    if (url && window.petLive2d) {
      const entry = url + 'cat.model3.json';
      live2dOk = await window.petLive2d.loadModel(entry);
      console.log('[pet] live2d load=' + live2dOk);
      if (live2dOk) {
        await new Promise((r) => setTimeout(r, 400));
        const visible = !window.petLive2d.hasVisiblePixels || window.petLive2d.hasVisiblePixels();
        console.log('[pet] live2d pixels=' + visible);
        if (!visible) {
          live2dOk = false;
          try { if (window.petLive2d.unload) window.petLive2d.unload(); } catch (e) {}
          stage.classList.remove('live2d');
        }
      }
    }
  } catch (e) { console.warn('[pet] live2d fail', e); live2dOk = false; }

  if (!live2dOk) {
    stage.classList.remove('live2d');
    const { dataUrl } = await window.v2p.petImage();
    if (dataUrl) {
      petImg.src = dataUrl;
      console.log('[pet] fallback image ok');
    } else {
      try {
        const c = document.createElement('canvas');
        c.width = 240; c.height = 240;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#f2c94c';
        ctx.beginPath(); ctx.arc(120, 120, 100, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2c3e50';
        ctx.font = 'bold 120px serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('CAT', 120, 130);
        petImg.src = c.toDataURL('image/png');
        console.log('[pet] fallback placeholder ok');
      } catch (e) { console.warn('[pet] fallback fail', e); }
    }
  }
})();

window.v2p.onPetModelChanged(async () => {
  // 设置页切换皮肤：重新加载，失败回退静态图
  const { url } = await window.v2p.petModel();
  const ok = url && window.petLive2d && await window.petLive2d.loadModel(url + 'cat.model3.json');
  if (!ok) { const { dataUrl } = await window.v2p.petImage(); if (dataUrl) petImg.src = dataUrl; }
});
