const assert = require('assert'); const fs = require('fs'); const vm = require('vm'); const path = require('path');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
function fixture() {
  const handlers = {}; const deliveries = []; const states = [];
  const cfg = { insertMode: 'clipboard', previewEnabled: false, previewSkipChars: 12 };
  const context = {
    Buffer, Object, String, Number, recordingActive: false, voiceSubmissionActive: false, voiceDeliveryEpoch: 0,
    voiceTargetPromise: null, pendingPreview: null, previewWin: null,
    config: { load: () => cfg }, resultDelivery: { busy: false },
    petActionCapture: { cancel() {} }, petActionWorkflow: { busy: false, run: async () => ({ ok: true }) },
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    setState: (stage) => states.push(stage), petBroadcast() {},
    noteVoiceStart: () => { context.voiceDeliveryEpoch++; context.voiceTargetPromise = Promise.resolve({ target: { hwnd: 1 } }); context.pendingPreview = null; },
    pipeline: {
      run: async (_, __, ___, options) => { assert.equal(options.deferDelivery, true); return { raw: ' initial raw ASR\n', polished: 'processed voice', preview: !!options.transcriptOnly }; },
      processText: async (text, mode) => ({ text: 'processed ' + text, mode })
    },
    deliverResult: async (payload) => { deliveries.push(payload); return { inserted: false, copiedOnly: true }; },
    showPreviewWindow: (raw, options) => {
      context.pendingPreview = { raw, target: options.target };
      Object.defineProperty(context.pendingPreview, 'initialRaw', { value: options.initialRaw, enumerable: true });
    }
  };
  vm.createContext(context);
  const voiceStart = main.indexOf("ipcMain.handle('v2p:submit'"); const voiceEnd = main.indexOf('// 宠物窗移动', voiceStart);
  vm.runInContext(main.slice(voiceStart, voiceEnd), context);
  const previewStart = main.indexOf("ipcMain.handle('v2p:preview-insert'"); const previewEnd = main.indexOf('// ---------------- 鼠标侧键', previewStart);
  vm.runInContext(main.slice(previewStart, previewEnd), context);
  const call = (name, payload) => handlers['v2p:' + name](null, payload);
  return { context, cfg, deliveries, states, call };
}
(async () => {
  {
    const f = fixture(); const result = await f.call('submit', { audio: [1], options: { mode: 'none' } });
    assert.equal(result.ok, true); assert.equal(f.deliveries.length, 1); assert.equal(f.deliveries[0].original, ' initial raw ASR\n');
    assert.equal(f.deliveries[0].text, 'processed voice'); assert.equal(f.context.voiceSubmissionActive, false);
  }
  {
    const f = fixture(); f.cfg.previewEnabled = true; f.cfg.previewSkipChars = 120;
    await f.call('submit', { audio: [1], options: {} });
    assert.equal(f.deliveries.length, 1); assert.equal(f.deliveries[0].original, ' initial raw ASR\n');
    assert.equal(f.deliveries[0].text, 'processed  initial raw ASR\n');
  }
  {
    const f = fixture(); f.cfg.previewEnabled = true; f.cfg.previewSkipChars = 1;
    await f.call('submit', { audio: [1], options: {} }); assert.equal(f.deliveries.length, 0);
    await f.call('process-text', { text: 'edited buffer', mode: 'structure' });
    await f.call('process-text', { text: 'second buffer', mode: 'optimize' });
    assert.equal(f.context.pendingPreview.initialRaw, ' initial raw ASR\n');
    const result = await f.call('preview-insert', { text: 'final edit', copyOnly: true });
    assert.equal(result.ok, true); assert.equal(f.deliveries[0].original, ' initial raw ASR\n');
    assert.equal(f.deliveries[0].insertMode, 'clipboard');
    assert.equal((await f.call('preview-insert', { text: 'duplicate' })).ok, false);
  }
  {
    const f = fixture(); let release;
    f.context.pipeline.run = () => new Promise((resolve) => { release = resolve; });
    const first = f.call('submit', { audio: [1], options: {} });
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await f.call('submit', { audio: [2], options: {} })).ok, false);
    assert.equal((await f.call('process-text', { text: 'concurrent', mode: 'structure' })).ok, false);
    f.context.voiceDeliveryEpoch++; release({ raw: 'older', polished: 'older result' });
    assert.equal((await first).voiceSuperseded, true); assert.equal(f.deliveries.length, 0);
    assert.equal((await f.call('preview-close', { ok: true })).ok, false); assert.equal(f.states.includes('idle'), false);
  }
  {
    const f = fixture(); f.context.petActionWorkflow.busy = true;
    assert.equal((await f.call('submit', { audio: [1], options: {} })).ok, false); assert.equal(f.deliveries.length, 0);
  }
  console.log('PASS v5 production voice IPC: deferred one delivery, immutable preview ASR, short/raw routes, duplicate and concurrency/epoch guards');
})().catch((error) => { console.error(error); process.exitCode = 1; });
