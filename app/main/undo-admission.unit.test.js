const assert = require('assert'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
const { createResultDelivery } = require('./result-delivery');
const { createPetActionCapture } = require('./pet-action-capture');
const { createPetActionWorkflow } = require('./pet-action-workflow');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const handlerSource = main.slice(main.indexOf("ipcMain.handle('v2p:undo'"), main.indexOf("ipcMain.handle('v2p:undo-dismiss'"));
const target = { hwnd: 1, pid: 2, threadId: 3, focusHwnd: 4, windowClass: 'Host', focusClass: 'Edit', processName: 'fixture', readOnly: false };
function productionUndo(context) {
  let handler;
  vm.runInNewContext(handlerSource, { ...context, ipcMain: { handle: (_name, fn) => { handler = fn; } }, showUndoToast() {}, setTimeout: () => 0 });
  return (token) => handler(null, token);
}
(async () => {
  for (const phase of ['capture', 'model', 'recording', 'voice', 'preview']) {
    let token; const writes = [];
    const delivery = createResultDelivery({ platform: 'win32', writeClipboard: async (text) => writes.push(text), onShow: (p) => { token = p.token; } });
    await delivery.deliver({ original: 'old source', text: 'old result', insertMode: 'clipboard' });
    const flags = { petActionCapture: { busy: phase === 'capture' }, petActionWorkflow: { busy: phase === 'model' },
      recordingActive: phase === 'recording', voiceSubmissionActive: phase === 'voice', pendingPreview: phase === 'preview' ? {} : null, resultDelivery: delivery };
    assert.equal((await productionUndo(flags)(token)).ok, false);
    assert.deepEqual(writes, ['old result'], 'busy Undo must make zero clipboard writes');
    assert.equal((await delivery.undo(token)).ok, true, 'busy rejection must not consume the existing token');
  }
  {
    let token, release; let copied = false, clip = '', sequence = 1, ownerPid = 2, modelCalls = 0; const writes = [];
    const settle = new Promise((resolve) => { release = resolve; });
    const delivery = createResultDelivery({ platform: 'win32', snapshot: async () => ({ target }), guardAvailable: () => true,
      writeClipboard: async (text) => { writes.push(text); clip = text; sequence++; ownerPid = 99; },
      sendChord: async () => true, onShow: (p) => { token = p.token; } });
    await delivery.deliver({ original: 'FIRST ASR', text: 'VOICE RESULT', kind: 'voice', target, insertMode: 'paste' });
    delivery.markDirty(); // The physical pet click dirties the old result.
    const capture = createPetActionCapture({ platform: 'win32',
      snapshot: async (include) => ({ target, sequence, ownerPid, stable: true, ...(include ? { text: clip } : {}) }),
      sendCopy: () => { clip = 'NEW SELECTED TEXT'; sequence++; ownerPid = 2; copied = true; },
      sleep: () => settle, readClipboard: () => clip });
    const workflow = createPetActionWorkflow({ capture, isVoiceBusy: () => false,
      processText: async (text) => { modelCalls++; assert.equal(text, 'NEW SELECTED TEXT'); return { text: 'NEW RESULT' }; },
      deliver: (payload) => delivery.deliver({ ...payload, insertMode: 'clipboard' }), onCaptureResult: (capture) => ({ ok: false, capture }) });
    const undo = productionUndo({ resultDelivery: delivery, petActionCapture: capture, petActionWorkflow: workflow, recordingActive: false, voiceSubmissionActive: false, pendingPreview: null });
    const action = workflow.run('structure'); while (!copied) await Promise.resolve();
    const count = writes.length;
    assert.equal((await undo(token)).ok, false); assert.equal(writes.length, count); assert.equal(clip, 'NEW SELECTED TEXT');
    release(); assert.equal((await action).ok, true); assert.equal(modelCalls, 1); assert.equal(clip, 'NEW RESULT');
    delivery.clear();
  }
  console.log('PASS production Undo admission rejects capture/model/voice/preview/recording with zero writes or token consumption; pending fresh-copy capture survives old dirty Undo');
})().catch((error) => { console.error(error); process.exitCode = 1; });
