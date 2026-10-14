const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createPetActionWorkflow } = require('./pet-action-workflow');
const { createPetActionCapture } = require('./pet-action-capture');

function harness(options = {}) {
  const state = { voice: false, calls: [], writes: [], captureCalls: 0 };
  const workflow = createPetActionWorkflow({
    capture: {
      cancel: (reason) => state.calls.push(['cancel', reason]),
      click: async (mode) => {
        state.captureCalls++;
        state.calls.push(['capture', mode]);
        return options.capture ? options.capture(mode, state) : {
          kind: 'authorized', mode, token: 'token', text: 'captured input', clipboardSequence: 7
        };
      }
    },
    isVoiceBusy: () => state.voice,
    processText: async (text, mode) => {
      state.calls.push(['process', text, mode]);
      if (options.processText) return options.processText(text, mode, state);
      return options.result || { text: 'transformed output', mode, degraded: false };
    },
    writeClipboard: async (text) => {
      state.calls.push(['write', text]);
      if (options.beforeWrite) options.beforeWrite(state);
      if (options.writeError) throw new Error('clipboard denied');
      state.writes.push(text);
    },
    onCaptureResult: (result) => ({ ok: false, capture: result })
  });
  return { state, workflow };
}

(async () => {
  for (const mode of ['structure', 'optimize']) {
    const h = harness();
    const result = await h.workflow.run(mode);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(h.state.calls[1], ['process', 'captured input', mode]);
    assert.deepStrictEqual(h.state.writes, ['transformed output']);
  }
  {
    const h = harness({ capture: async () => ({ kind: 'rejected', reason: 'no-fresh-clipboard' }) });
    const result = await h.workflow.run('structure');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(h.state.calls.some((call) => call[0] === 'process'), false, 'capture failure makes zero model calls');
  }
  {
    let sequence = 1;
    const target = { hwnd: 10, pid: 20, threadId: 30, windowClass: 'Browser', focusHwnd: 11,
      focusClass: 'Edit', processName: 'chrome' };
    const capture = createPetActionCapture({
      platform: 'win32',
      snapshot: async (includeText) => ({ target, sequence,
        ...(includeText ? { text: 'written by another app', stable: true, ownerPid: 999 } : {}) }),
      sendCopy: () => { sequence++; },
      sleep: async () => {}
    });
    let modelCalls = 0;
    const workflow = createPetActionWorkflow({
      capture, isVoiceBusy: () => false, processText: async () => { modelCalls++; return { text: 'bad' }; },
      writeClipboard: async () => {}, onCaptureResult: (result) => ({ ok: false, capture: result })
    });
    const result = await workflow.run('structure');
    assert.strictEqual(result.capture.reason, 'clipboard-owner-mismatch');
    assert.strictEqual(modelCalls, 0, 'a concurrent other-app clipboard write never reaches the model');
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
    const h = harness({ result: { text: 'raw/degraded text', mode: 'fallback', degraded: true, note: '降级原文' } });
    const result = await h.workflow.run('optimize');
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(h.state.writes, ['raw/degraded text']);
    assert.strictEqual(result.note, '降级原文');
  }
  {
    const h = harness({ result: { text: 'fallback text', mode: 'different-fallback-mode', degraded: false } });
    assert.strictEqual((await h.workflow.run('structure')).ok, true);
    assert.deepStrictEqual(h.state.writes, ['fallback text']);
  }
  {
    const h = harness({ result: { text: '  ', mode: 'structure' } });
    assert.strictEqual((await h.workflow.run('structure')).ok, false);
    assert.deepStrictEqual(h.state.writes, []);
  }
  {
    const h = harness({ writeError: true });
    const result = await h.workflow.run('optimize');
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, '结果未能写入剪贴板');
  }
  {
    const h = harness({ beforeWrite: (state) => { state.calls.push(['user-copied-during-model']); } });
    assert.strictEqual((await h.workflow.run('structure')).ok, true);
    assert.deepStrictEqual(h.state.writes, ['transformed output'], 'a later user copy does not veto result publication');
  }
  {
    let resolveModel;
    const h = harness({ processText: () => new Promise((resolve) => { resolveModel = resolve; }) });
    const run = h.workflow.run('optimize');
    while (!resolveModel) await new Promise((resolve) => setImmediate(resolve));
    h.state.voice = true;
    h.workflow.voiceStarted();
    resolveModel({ text: 'late output', mode: 'optimize' });
    const result = await run;
    assert.strictEqual(result.voiceSuperseded, true);
    assert.deepStrictEqual(h.state.writes, [], 'voice transition cancels a pending text result before clipboard write');
  }
  {
    const h = harness();
    const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'pet.js'), 'utf8');
    const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    assert.match(renderer, /result\.note/);
    assert.doesNotMatch(renderer, /再点同一按钮确认|显式复制/);
    assert.match(main, /clipboard\.writeText\(text\)/);
    assert.doesNotMatch(main.slice(main.indexOf("ipcMain.handle('v2p:pet-action'"), main.indexOf('// 宠物窗移动')), /writeClipboardIfSequence|showPetActionResult/);
    assert.strictEqual(h.workflow.busy, false);
  }

  console.log('PASS pet action workflow: one click, direct publication, degraded/raw results, interleaving, errors and voice isolation');
})().catch((error) => { console.error(error); process.exitCode = 1; });
