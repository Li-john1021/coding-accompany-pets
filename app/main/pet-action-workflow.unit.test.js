const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPetActionWorkflow } = require('./pet-action-workflow');

function harness(options = {}) {
  const state = { voice: false, calls: [], writes: [], previews: [], clipboardSequence: 7, captureCalls: 0 };
  const deps = {
    capture: {
      cancel: (reason) => state.calls.push(['cancel', reason]),
      click: async (mode) => {
        state.captureCalls++;
        state.calls.push(['capture', mode]);
        return options.capture ? options.capture(mode, state) : {
          kind: 'authorized', mode, token: 'one-time-token', text: 'captured input', clipboardSequence: 7
        };
      }
    },
    isVoiceBusy: () => state.voice,
    processText: async (text, mode) => {
      state.calls.push(['process', text, mode]);
      return options.result || { text: 'transformed output', mode, degraded: false };
    },
    getClipboardSnapshot: async () => ({ sequence: state.clipboardSequence }),
    writeClipboardText: (text) => {
      if (options.writeError) throw new Error('clipboard denied');
      state.writes.push(text);
    },
    showResult: (text, mode) => state.previews.push([text, mode]),
    onCaptureResult: (result) => result.kind === 'preview' ? { ok: true, capture: result } : { ok: false, capture: result }
  };
  return { state, workflow: createPetActionWorkflow(deps) };
}

(async () => {
  for (const mode of ['structure', 'optimize']) {
    const h = harness();
    const result = await h.workflow.run(mode);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(h.state.calls[1], ['process', 'captured input', mode]);
    assert.deepStrictEqual(h.state.writes, ['transformed output']);
    assert.deepStrictEqual(h.state.previews, []);
  }

  {
    const h = harness({ capture: async () => ({ kind: 'preview', text: 'unverified' }) });
    const result = await h.workflow.run('structure');
    assert.strictEqual(result.capture.kind, 'preview');
    assert.strictEqual(h.state.calls.some((call) => call[0] === 'process'), false);
  }
  {
    const h = harness();
    h.state.voice = true;
    assert.strictEqual((await h.workflow.run('structure')).capture.reason, 'voice-busy');
    assert.strictEqual(h.state.captureCalls, 0);
  }
  {
    const h = harness();
    assert.strictEqual((await h.workflow.run('image_recognition')).ok, false);
    assert.strictEqual(h.state.captureCalls, 0);
  }
  {
    const h = harness({ capture: async (mode) => ({ kind: 'authorized', mode, token: '', text: 'stale', clipboardSequence: 7 }) });
    assert.strictEqual((await h.workflow.run('structure')).capture.reason, 'authorization-invalid');
    assert.strictEqual(h.state.calls.some((call) => call[0] === 'process'), false);
  }
  {
    const h = harness({ capture: async (mode, state) => {
      state.voice = true;
      return { kind: 'authorized', mode, token: 'one-time-token', text: 'captured input', clipboardSequence: 7 };
    } });
    assert.strictEqual((await h.workflow.run('structure')).capture.reason, 'authorization-invalid');
    assert.strictEqual(h.state.calls.some((call) => call[0] === 'process'), false);
  }
  {
    const h = harness({ result: { text: 'source', mode: 'none', degraded: true, note: '降级为原文' } });
    assert.strictEqual((await h.workflow.run('optimize')).ok, false);
    assert.deepStrictEqual(h.state.writes, []);
    assert.deepStrictEqual(h.state.previews, []);
  }
  {
    const h = harness({ result: { text: '  ', mode: 'structure', degraded: false } });
    assert.strictEqual((await h.workflow.run('structure')).ok, false);
    assert.deepStrictEqual(h.state.writes, []);
  }
  {
    const h = harness();
    h.state.clipboardSequence = 8;
    const result = await h.workflow.run('structure');
    assert.strictEqual(result.preview, true);
    assert.deepStrictEqual(h.state.writes, []);
    assert.deepStrictEqual(h.state.previews, [['transformed output', 'structure']]);
  }
  {
    const h = harness({ writeError: true });
    const result = await h.workflow.run('optimize');
    assert.strictEqual(result.preview, true);
    assert.deepStrictEqual(h.state.writes, []);
    assert.deepStrictEqual(h.state.previews, [['transformed output', 'optimize']]);
  }
  {
    let finish;
    const h = harness();
    h.workflow = createPetActionWorkflow({
      ...{
        capture: { click: () => new Promise((resolve) => { finish = resolve; }), cancel() {} },
        isVoiceBusy: () => false,
        processText: async (_text, mode) => ({ text: 'ok', mode, degraded: false }),
        getClipboardSnapshot: async () => ({ sequence: 1 }), writeClipboardText() {}, showResult() {},
        onCaptureResult: () => ({ ok: false })
      }
    });
    const first = h.workflow.run('structure');
    const second = await h.workflow.run('optimize');
    assert.strictEqual(second.ok, false);
    finish({ kind: 'rejected', reason: 'test' });
    await first;
    assert.strictEqual(h.workflow.busy, false);
  }

  const preview = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'preview.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert.match(preview, /p\.resultOnly[\s\S]*?\$\('#btn-insert'\)\.hidden = true/);
  assert.match(preview, /\$\('#btn-copy'\)\.addEventListener\('click', \(\) => finish\(true\)\)/);
  assert.match(main, /showPreviewWindow\(text, \{ resultOnly: true, mode \}\)/);
  assert.match(main, /const mode = copyOnly \? 'clipboard'/);
  assert.doesNotMatch(main.slice(main.indexOf('function showPetActionResult'), main.indexOf("ipcMain.handle('v2p:preview-insert'")), /insertText|processText|keyTap/);

  console.log('PASS pet action model authorization, mode routing, clipboard ownership, and explicit result-copy path');
})().catch((error) => { console.error(error); process.exitCode = 1; });
