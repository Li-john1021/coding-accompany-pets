const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPetActionWorkflow } = require('./pet-action-workflow');
const { buildConditionalWriteScript, createWindowsConditionalClipboardWriter } = require('./pet-action-clipboard');

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
    writeClipboardIfSequence: async (sequence, text) => {
      if (options.beforeConditionalCheck) options.beforeConditionalCheck(state);
      if (options.writeError || state.clipboardSequence !== sequence) return false;
      state.writes.push(text);
      return true;
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
    assert.strictEqual((await h.workflow.run('structure')).capture.reason, 'voice-busy');
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
    const h = harness({ beforeConditionalCheck: (state) => { state.clipboardSequence++; } });
    const result = await h.workflow.run('structure');
    assert.strictEqual(result.preview, true);
    assert.deepStrictEqual(h.state.writes, []);
    assert.deepStrictEqual(h.state.previews, [['transformed output', 'structure']], 'a clipboard interleaving at the conditional write boundary is rejected');
  }
  {
    const h = harness();
    assert.strictEqual((await h.workflow.run('structure')).copied, true);
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
        writeClipboardIfSequence: async () => true, showResult() {}, cancelPendingClipboardWrites() {},
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

  {
    let resolveModel;
    const h = harness();
    h.workflow = createPetActionWorkflow({
      capture: { click: async (mode) => ({ kind: 'authorized', mode, token: 't', text: 'source', clipboardSequence: 7 }), cancel() {} },
      isVoiceBusy: () => h.state.voice,
      processText: () => new Promise((resolve) => { resolveModel = resolve; }),
      writeClipboardIfSequence: async (_sequence, text) => { h.state.writes.push(text); return true; },
      cancelPendingClipboardWrites: () => h.state.calls.push(['cancel-writer']),
      showResult: (text, mode) => h.state.previews.push([text, mode]),
      onCaptureResult: (result) => ({ ok: false, capture: result })
    });
    const run = h.workflow.run('optimize');
    while (!resolveModel) await new Promise((resolve) => setImmediate(resolve));
    h.state.voice = true;
    h.workflow.voiceStarted();
    resolveModel({ text: 'late output', mode: 'optimize', degraded: false });
    const result = await run;
    assert.strictEqual(result.voiceSuperseded, true);
    assert.deepStrictEqual(h.state.writes, []);
    assert.deepStrictEqual(h.state.previews, []);
  }

  {
    const script = buildConditionalWriteScript();
    assert.match(script, /OpenClipboard\(owner\)/);
    assert.match(script, /OpenClipboard\(owner\)[\s\S]*GetClipboardSequenceNumber\(\)[\s\S]*EmptyClipboard\(\)[\s\S]*SetClipboardData\(13, memory\)/);
    assert.match(script, /GlobalAlloc\(0x0002/);
    assert.match(script, /CloseClipboard\(\)/);
    assert.doesNotMatch(script, /OpenClipboard\(IntPtr\.Zero\)|clipboard\.writeText/);

    let scriptText, options, callback;
    const writer = createWindowsConditionalClipboardWriter({ platform: 'win32', runPowerShellFile: (source, opts, cb) => {
      scriptText = source; options = opts; callback = cb; return { kill() {} };
    } });
    const pending = writer.writeClipboardIfSequence(4, 'private result');
    assert.ok(Buffer.from(options.stdin.split('\n')[1], 'base64').toString('utf16le').includes('private result'));
    assert.doesNotMatch(scriptText, /private result/);
    callback(null, 'changed\n');
    assert.strictEqual(await pending, false);

    let canceledCallback, killed = false;
    const cancelable = createWindowsConditionalClipboardWriter({ platform: 'win32', runPowerShellFile: (_source, _opts, cb) => {
      canceledCallback = cb; return { kill() { killed = true; } };
    } });
    const canceledWrite = cancelable.writeClipboardIfSequence(4, 'private result');
    cancelable.cancelPendingWrites();
    assert.strictEqual(killed, true);
    canceledCallback(null, 'written\n');
    assert.strictEqual(await canceledWrite, false, 'voice cancellation invalidates an in-flight conditional writer');
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
