const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { HOSTS, buildSnapshotScript, parseSnapshot, classifyHost, copyStrategy, sendWindowsCopy, createPetActionCapture } = require('./pet-action-capture');

const target = (overrides = {}) => ({ hwnd: 10, pid: 20, threadId: 30, windowClass: 'AppWindow',
  focusHwnd: 11, focusClass: 'Edit', processName: 'unknown-app', ...overrides });

function harness(options = {}) {
  const state = { now: 100, sequence: 7, text: 'old clipboard', target: target(), copies: [], reads: 0, snapshots: 0 };
  const capture = createPetActionCapture({
    platform: 'win32', now: () => state.now,
    sleep: async (ms) => { state.now += ms; if (options.onSleep) options.onSleep(state, ms); },
    snapshot: async (includeText = false) => {
      state.snapshots++;
      return { target: { ...state.target }, sequence: state.sequence,
        ...(includeText ? { stable: options.stable !== false, text: state.text, ownerHwnd: 99,
          ownerPid: state.ownerPid === undefined ? state.target.pid : state.ownerPid } : {}) };
    },
    readClipboard: () => { state.reads++; return state.text; },
    sendCopy: (strategy) => { state.copies.push(strategy); if (options.copyEffect) options.copyEffect(state); }
  });
  return { state, capture };
}

(async () => {
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'pet.js'), 'utf8');
  assert.doesNotMatch(renderer, /capture\.kind === 'preview'|再点同一按钮确认|显式复制/);
  assert.match(renderer, /result\.note/);

  const script = buildSnapshotScript();
  assert.match(script, /GetForegroundWindow/);
  assert.match(script, /GetClipboardSequenceNumber/);
  assert.match(script, /GetGUIThreadInfo/);
  assert.doesNotMatch(script, /SendInput|SetFocus/i);
  const textSnapshotScript = buildSnapshotScript(true);
  assert.match(textSnapshotScript, /Clipboard\]::GetText\(\)/);
  assert.match(textSnapshotScript, /sequenceBefore -eq \$sequenceAfter/);
  assert.match(textSnapshotScript, /GetClipboardOwner/);
  assert.match(textSnapshotScript, /ownerPidBefore -eq \$ownerPidAfter/);
  const parsed = parseSnapshot('{"ok":true,"hwnd":10,"pid":20,"threadId":30,"windowClass":"AppWindow","focusHwnd":11,"focusClass":"Edit","processName":"unknown-app","sequence":7}');
  assert.strictEqual(parsed.sequence, 7);
  assert.strictEqual(parseSnapshot('{"ok":true,"hwnd":0,"pid":20,"threadId":30,"windowClass":"x","focusHwnd":11,"focusClass":"Edit","processName":"x","sequence":7}'), null);

  for (const processName of ['chrome', 'Code', 'Qoder', 'unknown-app']) {
    const h = harness({ copyEffect: (s) => { s.sequence++; s.text = 'selected text'; } });
    h.state.target = target({ processName });
    const result = await h.capture.click('structure', false);
    assert.strictEqual(result.kind, 'authorized', `${processName} first click authorizes fresh text`);
    assert.strictEqual(h.state.copies.length, 1);
    assert.strictEqual(h.state.copies[0].key, 'copy');
  }

  assert.deepStrictEqual(copyStrategy(target({ processName: 'WindowsTerminal', windowClass: 'CASCADIA_HOSTING_WINDOW_CLASS' })),
    { host: HOSTS.WINDOWS_TERMINAL, key: 'insert' });
  assert.deepStrictEqual(copyStrategy(target({ processName: 'conhost', windowClass: 'ConsoleWindowClass' })),
    { host: HOSTS.CONHOST, key: 'insert' });
  assert.deepStrictEqual(copyStrategy(target({ focusClass: 'TerminalControl' })),
    { host: HOSTS.CONSOLE_FOCUS, key: 'insert' });
  for (const processName of ['mintty', 'wezterm-gui', 'alacritty']) {
    assert.strictEqual(copyStrategy(target({ processName })).key, 'terminal-copy');
  }
  {
    const calls = [];
    const keys = { C: 1, Insert: 2, Ctrl: 3, Shift: 4 };
    const keyTap = (key, modifiers) => calls.push([key, modifiers]);
    sendWindowsCopy({ key: 'insert' }, keyTap, keys);
    sendWindowsCopy({ key: 'terminal-copy' }, keyTap, keys);
    sendWindowsCopy({ key: 'copy' }, keyTap, keys);
    assert.deepStrictEqual(calls, [[2, [3]], [1, [3, 4]], [1, [3]]]);
    assert.notDeepStrictEqual(calls[0], [keys.C, [keys.Ctrl]], 'conhost never receives Ctrl+C');
  }

  {
    const h = harness({ captureWindowMs: 100 });
    const result = await h.capture.click('structure', false);
    assert.strictEqual(result.reason, 'no-fresh-clipboard');
    assert.strictEqual(h.state.reads, 0, 'old clipboard is never read when the sequence is unchanged');
  }
  {
    const h = harness({ copyEffect: (s) => { s.sequence++; } });
    const result = await h.capture.click('optimize', false);
    assert.strictEqual(result.kind, 'authorized', 'a new sequence can authorize equal text');
    assert.strictEqual(result.text, 'old clipboard');
    assert.strictEqual(result.evidence.ownerMatched, true);
  }
  {
    const h = harness({ copyEffect: (s) => { s.sequence++; s.text = 'other app clipboard'; s.ownerPid = 999; } });
    const result = await h.capture.click('structure', false);
    assert.strictEqual(result.kind, 'rejected');
    assert.strictEqual(result.reason, 'clipboard-owner-mismatch');
  }
  {
    const h = harness({ stable: false, copyEffect: (s) => { s.sequence++; s.text = 'raced clipboard'; } });
    assert.strictEqual((await h.capture.click('structure', false)).reason, 'clipboard-changed');
  }
  {
    const h = harness({ copyEffect: (s) => { s.sequence++; s.text = 'owner unknown'; s.ownerPid = 0; } });
    const result = await h.capture.click('structure', false);
    assert.strictEqual(result.kind, 'authorized', 'unknown clipboard ownership remains compatible');
    assert.strictEqual(result.evidence.ownerMatched, false);
  }
  {
    const h = harness({ copyEffect: (s) => { s.sequence++; s.text = '  '; } });
    assert.strictEqual((await h.capture.click('structure', false)).reason, 'empty-or-invalid-text');
  }
  {
    const h = harness({ copyEffect: (s) => { s.sequence++; s.text = 'selected'; }, onSleep: (s) => { s.target = target({ hwnd: 12 }); } });
    assert.strictEqual((await h.capture.click('structure', false)).reason, 'target-changed');
  }
  {
    const h = harness({ copyEffect: (s) => { s.sequence++; s.text = 'selected'; } });
    const first = h.capture.click('structure', false);
    assert.strictEqual((await h.capture.click('optimize', false)).reason, 'capture-in-progress');
    assert.strictEqual((await first).kind, 'authorized');
    assert.strictEqual(h.state.copies.length, 1, 'the first action click sends one copy request');
  }
  {
    const h = harness();
    const running = h.capture.click('structure', false);
    h.capture.cancel('voice-busy');
    assert.strictEqual((await running).reason, 'voice-busy');
    assert.strictEqual(h.state.copies.length, 0, 'voice transition before copy keeps voice workflow isolated');
  }
  {
    const h = harness();
    assert.strictEqual((await h.capture.click('image_recognition', false)).reason, 'unsupported-mode');
    assert.strictEqual(h.state.copies.length, 0);
  }

  console.log('PASS pet action capture: one-click host copy, fresh sequence, non-empty text, target and voice guards');
})().catch((error) => { console.error(error); process.exitCode = 1; });
