const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  HOSTS, buildSnapshotScript, parseSnapshot, classifyHost, createPetActionCapture
} = require('./pet-action-capture');

const target = (overrides = {}) => ({ hwnd: 10, pid: 20, threadId: 30, windowClass: 'EditWindow',
  focusHwnd: 11, focusClass: 'Edit', processName: 'notepad', ...overrides });

function harness(options = {}) {
  const state = { now: 100, sequence: 7, text: 'old clipboard', target: target(), copies: 0, reads: 0, snapshots: 0 };
  const adapters = {
    platform: 'win32',
    now: () => state.now,
    sleep: async (ms) => {
      state.now += ms;
      if (options.onSleep) options.onSleep(state, ms);
    },
    snapshot: async () => { state.snapshots++; return { target: { ...state.target }, sequence: state.sequence }; },
    probeSelection: async () => options.proof || null,
    readClipboard: () => { state.reads++; return { text: state.text, formats: state.text ? ['text/plain'] : [] }; },
    sendOrdinaryCopy: () => {
      state.copies++;
      if (options.copyEffect) options.copyEffect(state);
    }
  };
  return { state, capture: createPetActionCapture(adapters, { captureWindowMs: options.captureWindowMs || 250,
    manualWindowMs: options.manualWindowMs || 400, previewTtlMs: options.previewTtlMs || 300, pollMs: 50, monitorPending: false }) };
}

(async () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'pet.js'), 'utf8');
  assert.match(renderer, /capture\.kind === 'preview'[\s\S]*?say\(`选区未验证/);
  assert.match(renderer, /textContent = text/);
  assert.match(renderer, /replace\(\/\\s\+\/g, ' '\)/, 'preview content is whitespace-normalized before safe textContent rendering');

  const script = buildSnapshotScript();
  assert.match(script, /GetForegroundWindow/);
  assert.match(script, /GetClipboardSequenceNumber/);
  assert.match(script, /GetGUIThreadInfo/);
  assert.doesNotMatch(script, /SendInput|keyTap|SetFocus/i);

  const parsed = parseSnapshot('{"ok":true,"hwnd":10,"pid":20,"threadId":30,"windowClass":"EditWindow","focusHwnd":11,"focusClass":"Edit","processName":"notepad","sequence":7}');
  assert.strictEqual(parsed.sequence, 7);
  assert.strictEqual(parseSnapshot('{"ok":true,"hwnd":0,"pid":20,"threadId":30,"windowClass":"x","focusHwnd":11,"focusClass":"Edit","processName":"x","sequence":7}'), null);
  assert.strictEqual(classifyHost(target({ processName: 'WindowsTerminal', windowClass: 'CASCADIA_HOSTING_WINDOW_CLASS' })), HOSTS.WINDOWS_TERMINAL);
  assert.strictEqual(classifyHost(target({ processName: 'conhost', windowClass: 'ConsoleWindowClass' })), HOSTS.CONHOST);
  assert.strictEqual(classifyHost(target({ processName: 'Code', windowClass: 'Chrome_WidgetWin_1' })), HOSTS.VSCODE);
  assert.strictEqual(classifyHost(target({ processName: 'powershell' })), HOSTS.UNKNOWN, 'shell process name is never a copy policy');
  assert.strictEqual(classifyHost(target({ processName: 'chrome', windowClass: 'Chrome_WidgetWin_1' })), HOSTS.UNKNOWN,
    'browser content, including embedded terminals, stays manual without a reliable control capability');

  {
    const h = harness({ captureWindowMs: 100 });
    h.state.text = 'old clipboard';
    const result = await h.capture.click('structure', false);
    assert.strictEqual(result.kind, 'rejected');
    assert.strictEqual(result.reason, 'no-fresh-clipboard');
    assert.strictEqual(h.state.copies, 1);
  }

  {
    const h = harness({ copyEffect: (s) => { s.sequence++; } });
    const result = await h.capture.click('optimize', false);
    assert.strictEqual(result.kind, 'preview', 'equal text with a new sequence is fresh but unverified');
    assert.strictEqual(result.evidence.type, 'fresh-clipboard-unverified');
    assert.strictEqual(h.capture.pending.text, 'old clipboard');
    const confirmed = await h.capture.click('optimize', false);
    assert.strictEqual(confirmed.kind, 'authorized');
    assert.strictEqual(confirmed.text, 'old clipboard');
    assert.notStrictEqual(confirmed.token, undefined);
    assert.strictEqual(h.capture.pending, null, 'confirmation token can be consumed only once');
  }

  {
    const h = harness({ copyEffect: (s) => { s.sequence++; s.text = ''; } });
    const result = await h.capture.click('structure', false);
    assert.strictEqual(result.kind, 'rejected');
    assert.strictEqual(result.reason, 'empty-or-non-text-clipboard');
  }

  {
    const h = harness({ onSleep: (s) => {
      if (!s.manualCopyObserved) { s.manualCopyObserved = true; s.sequence++; s.text = 'fallback current line'; }
    } });
    h.state.target = target({ processName: 'Code', windowClass: 'Chrome_WidgetWin_1' });
    const result = await h.capture.click('structure', false);
    assert.strictEqual(result.kind, 'preview', 'VS Code fallback text is never direct authorization');
    assert.strictEqual(result.evidence.type, 'fresh-clipboard-unverified');
    assert.strictEqual(h.state.copies, 0, 'VS Code uses manual copy path');
  }

  {
    const h = harness({ captureWindowMs: 100 });
    h.state.target = target({ processName: 'WindowsTerminal', windowClass: 'CASCADIA_HOSTING_WINDOW_CLASS' });
    const result = await h.capture.click('structure', false);
    assert.strictEqual(result.kind, 'rejected');
    assert.strictEqual(h.state.copies, 0, 'Windows Terminal without proven selection receives no key');
  }

  {
    const h = harness({ captureWindowMs: 100 });
    h.state.target = target({ processName: 'conhost', windowClass: 'ConsoleWindowClass' });
    const result = await h.capture.click('structure', false);
    assert.strictEqual(result.kind, 'rejected');
    assert.strictEqual(h.state.copies, 0, 'conhost without proven selection receives no key');
  }

  {
    const h = harness({ proof: { text: 'selected', control: { hwnd: 11, start: 0, end: 8 } } });
    const result = await h.capture.click('structure', false);
    assert.strictEqual(result.kind, 'authorized');
    assert.strictEqual(result.evidence.type, 'proven-win32-edit-selection');
    assert.strictEqual(h.state.copies, 0, 'proven selection is read without synthetic copy');
  }

  {
    const h = harness({ copyEffect: (s) => { s.sequence++; s.text = 'fresh'; } });
    assert.strictEqual((await h.capture.click('structure', false)).kind, 'preview');
    h.state.sequence++;
    assert.strictEqual((await h.capture.click('structure', false)).reason, 'clipboard-changed');
  }

  {
    const h = harness({ copyEffect: (s) => { s.sequence++; s.text = 'fresh'; } });
    assert.strictEqual((await h.capture.click('structure', false)).kind, 'preview');
    h.state.target = target({ hwnd: 12 });
    assert.strictEqual((await h.capture.click('structure', false)).reason, 'target-changed');
  }

  {
    const h = harness({ copyEffect: (s) => { s.sequence++; s.text = 'fresh'; } });
    assert.strictEqual((await h.capture.click('structure', false)).kind, 'preview');
    assert.strictEqual((await h.capture.click('optimize', false)).reason, 'mode-changed');
  }

  {
    const h = harness({ copyEffect: (s) => { s.sequence++; s.text = 'fresh'; } });
    assert.strictEqual((await h.capture.click('structure', false)).kind, 'preview');
    assert.strictEqual((await h.capture.click('structure', true)).reason, 'voice-busy');
    assert.strictEqual(h.capture.pending, null);
  }

  {
    const h = harness({ copyEffect: (s) => { s.sequence++; s.text = 'fresh'; }, previewTtlMs: 60 });
    h.capture = createPetActionCapture({
      platform: 'win32', now: () => h.state.now, sleep: async (ms) => { h.state.now += ms; },
      snapshot: async () => ({ target: { ...h.state.target }, sequence: h.state.sequence }),
      probeSelection: async () => null, readClipboard: () => ({ text: 'fresh' }),
      sendOrdinaryCopy: () => { h.state.sequence++; h.state.text = 'fresh'; }
    }, { captureWindowMs: 50, previewTtlMs: 60, pollMs: 25 });
    assert.strictEqual((await h.capture.click('structure', false)).kind, 'preview');
    h.state.now += 61;
    assert.strictEqual((await h.capture.click('structure', false)).reason, 'expired');
  }

  {
    const h = harness();
    assert.strictEqual(h.state.copies, 0, 'no button action means zero copy requests');
  }

  {
    const h = harness({ captureWindowMs: 100 });
    const first = h.capture.click('structure', false);
    const second = await h.capture.click('structure', false);
    assert.strictEqual(second.reason, 'capture-in-progress', 'concurrent clicks cannot create parallel captures');
    await first;
    assert.strictEqual(h.state.copies, 1);
  }

  {
    let resolveSnapshot;
    let copyCount = 0;
    const gate = createPetActionCapture({
      platform: 'win32', now: () => 1, sleep: async () => {},
      snapshot: () => new Promise((resolve) => { resolveSnapshot = resolve; }),
      probeSelection: async () => null, readClipboard: () => ({ text: '' }), sendOrdinaryCopy: () => { copyCount++; }
    }, { monitorPending: false });
    const run = gate.click('structure', false);
    gate.cancel('voice-busy');
    resolveSnapshot({ target: target(), sequence: 1 });
    const result = await run;
    assert.strictEqual(result.kind, 'cancelled');
    assert.strictEqual(copyCount, 0, 'voice cancellation during target capture prevents any key injection');
  }

  {
    const state = { now: Date.now(), sequence: 1, target: target(), text: 'old' };
    let canceled;
    const observedCancellation = new Promise((resolve) => { canceled = resolve; });
    const service = createPetActionCapture({
      platform: 'win32', now: () => state.now, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      snapshot: async () => ({ target: { ...state.target }, sequence: state.sequence }),
      probeSelection: async () => null, readClipboard: () => ({ text: state.text }),
      sendOrdinaryCopy: () => { state.sequence++; state.text = 'fresh'; }
    }, { captureWindowMs: 30, previewTtlMs: 500, pollMs: 5, onCancel: canceled });
    assert.strictEqual((await service.click('structure', false)).kind, 'preview');
    state.sequence++;
    assert.strictEqual(await Promise.race([observedCancellation, new Promise((resolve) => setTimeout(() => resolve('timeout'), 200))]), 'clipboard-changed');
    assert.strictEqual(service.pending, null, 'bounded post-click monitoring cancels stale preview');
  }

  {
    const state = { now: 100, sequence: 1, target: target(), text: 'old', snapshots: 0 };
    let resolveConfirmation;
    const service = createPetActionCapture({
      platform: 'win32', now: () => state.now, sleep: async (ms) => { state.now += ms; },
      snapshot: () => {
        state.snapshots++;
        if (state.snapshots === 5) return new Promise((resolve) => { resolveConfirmation = resolve; });
        return Promise.resolve({ target: { ...state.target }, sequence: state.sequence });
      },
      probeSelection: async () => null, readClipboard: () => ({ text: state.text }),
      sendOrdinaryCopy: () => { state.sequence++; state.text = 'fresh'; }
    }, { captureWindowMs: 50, previewTtlMs: 500, pollMs: 25, monitorPending: false });
    assert.strictEqual((await service.click('structure', false)).kind, 'preview');
    const confirmation = service.click('structure', false);
    service.cancel('voice-busy');
    resolveConfirmation({ target: { ...state.target }, sequence: state.sequence });
    assert.strictEqual((await confirmation).reason, 'cancelled', 'voice cancellation during confirmation never authorizes stale text');
  }

  {
    const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    const action = main.slice(main.indexOf("ipcMain.handle('v2p:pet-action'"), main.indexOf("// 宠物窗移动", main.indexOf("ipcMain.handle('v2p:pet-action'")));
    assert.doesNotMatch(action, /pipeline|models\.|clipboard\.writeText|insertText/);
    assert.match(main, /v2p:recording-flag'[\s\S]*?petActionCapture\.cancel\('voice-busy'\)/);
  }

  console.log('PASS pet action capture freshness, target, host policy, confirmation, and cancellation gates');
})().catch((error) => { console.error(error); process.exitCode = 1; });
