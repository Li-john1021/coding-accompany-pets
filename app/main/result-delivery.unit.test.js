const assert = require('assert');
const { createResultDelivery, pasteChord } = require('./result-delivery');
const { keyEvents } = require('./target-keys');
const target = { hwnd: 1, pid: 2, threadId: 3, focusHwnd: 4, windowClass: 'Chrome_WidgetWin_1', focusClass: 'Edit', processName: 'chrome', readOnly: false };
function fixture() {
  const state = { now: 0, target, writes: [], chords: [], shows: [], timers: [], guard: true };
  const delivery = createResultDelivery({ platform: 'win32', now: () => state.now, snapshot: async () => ({ target: state.target }),
    writeClipboard: async (text) => state.writes.push(text), sendChord: async (chord) => { state.chords.push(chord); return true; },
    guardAvailable: () => state.guard, setTimer: (fn, ms) => { state.timers.push({ fn, ms }); return state.timers.length; }, clearTimer() {},
    onShow: (payload) => state.shows.push(payload) });
  const run = (options = {}) => delivery.deliver({ original: ' exact captured source \n', text: 'result', target, insertMode: 'paste', undoToastSeconds: 10, ...options });
  const token = () => state.shows.at(-1).token;
  return { state, delivery, run, token };
}
(async () => {
  {
    let token; let delivery;
    delivery = createResultDelivery({ platform: 'win32', snapshot: async () => ({ target }), guardAvailable: () => true,
      writeClipboard: async () => {}, onShow: (p) => { token = p.token; },
      sendChord: async (chord, _target, options) => {
        if (chord !== 'ctrl-v') {
          delivery.markDirty();
          assert.equal(options.signal.aborted, true, 'a prior JS grant never suppresses genuine dirty input');
          return false;
        }
        return true;
      } });
    await delivery.deliver({ original: 'initial', text: 'processed', kind: 'voice', target, insertMode: 'paste' });
    assert.equal((await delivery.undo(token)).restored, false);
  }
  {
    let token, entered, release; const chords = [];
    const started = new Promise((resolve) => { entered = resolve; });
    const waiting = new Promise((resolve) => { release = resolve; });
    const delivery = createResultDelivery({ platform: 'win32', snapshot: async () => ({ target }), guardAvailable: () => true,
      writeClipboard: async () => {}, onShow: (p) => { token = p.token; },
      sendChord: async (chord) => { chords.push(chord); entered(); await waiting; return { sent: true, generation: 4, sessionId: 'same-native-session' }; } });
    const pending = delivery.deliver({ original: 'source', text: 'processed', target, insertMode: 'paste' });
    await started; delivery.markDirty(); release(); await pending;
    assert.equal((await delivery.undo(token)).restored, false, 'post-injection input before paste promise settles remains dirty');
    assert.deepEqual(chords, ['ctrl-v']);
  }
  {
    let token;
    const delivery = createResultDelivery({ platform: 'win32', snapshot: async () => ({ target }), guardAvailable: () => true,
      writeClipboard: async () => {}, onShow: (p) => { token = p.token; },
      sendChord: async (chord, _target, options) => {
        if (chord !== 'ctrl-v') { assert.equal(options.expectedGeneration, 7); assert.equal(options.sessionId, 'session-one'); }
        return { sent: true, generation: 7, sessionId: 'session-one' };
      } });
    await delivery.deliver({ original: 'initial', text: 'processed', kind: 'voice', target, insertMode: 'paste' });
    assert.equal((await delivery.undo(token)).restored, true, 'own-origin filtering permits a clean native packet');
  }
  for (const kind of ['selection', 'voice']) {
    for (const cancel of ['dirty', 'clear']) {
      const f = fixture(); let entered; let release; const sent = [];
      const started = new Promise((resolve) => { entered = resolve; });
      const waiting = new Promise((resolve) => { release = resolve; });
      const delivery = createResultDelivery({ platform: 'win32', snapshot: async () => ({ target }), guardAvailable: () => true,
        writeClipboard: async () => {}, onShow: (p) => f.state.shows.push(p),
        sendChord: async (chord, _target, options) => {
          if (chord === 'ctrl-v') return true;
          entered(); await waiting;
          if (options.signal.aborted) return false;
          sent.push(chord); return true;
        } });
      await delivery.deliver({ original: 'source', text: 'result', kind, target, insertMode: 'paste' });
      const pending = delivery.undo(f.token()); await started;
      if (cancel === 'dirty') delivery.markDirty(); else delivery.clear();
      release(); assert.equal((await pending).restored, false); assert.deepEqual(sent, [], 'pending native startup must not send Undo after cancellation');
    }
  }
  for (const mode of ['paste', 'clipboard']) {
    const f = fixture(); await f.run({ insertMode: mode });
    assert.deepEqual(f.state.writes, ['result']);
    const ui = f.state.shows[0];
    assert.deepEqual(Object.keys(ui).sort(), ['inserted', 'note', 'seconds', 'token']);
    assert.equal((await f.delivery.undo(f.token())).restored, mode === 'paste');
    assert.equal(f.state.writes.at(-1), ' exact captured source \n');
    assert.deepEqual(f.state.chords, mode === 'paste' ? ['ctrl-v', 'ctrl-z'] : []);
    assert.equal((await f.delivery.undo(f.token())).ok, false);
  }
  for (const reason of ['changed', 'dirty', 'guard-unavailable']) {
    const f = fixture(); if (reason === 'guard-unavailable') f.state.guard = false;
    await f.run();
    if (reason === 'changed') f.state.target = { ...target, focusHwnd: 5 };
    if (reason === 'dirty') f.delivery.markDirty();
    const result = await f.delivery.undo(f.token());
    assert.equal(result.restored, false); assert.match(result.note, /目标未修改/);
    assert.deepEqual(f.state.chords, ['ctrl-v']);
  }
  {
    const f = fixture(); await f.run({ kind: 'voice', original: 'initial ASR', text: 'processed voice' });
    assert.equal((await f.delivery.undo(f.token())).restored, true);
    assert.deepEqual(f.state.chords, ['ctrl-v', 'voice-restore']); assert.equal(f.state.writes.at(-1), 'initial ASR');
    assert.deepEqual(keyEvents('voice-restore'), [[17,0],[90,0],[90,2],[17,2],[17,0],[86,0],[86,2],[17,2]]);
  }
  {
    const f = fixture(); f.state.target = { ...target, readOnly: undefined };
    await f.run(); await f.delivery.undo(f.token());
    assert.deepEqual(f.state.chords, ['ctrl-v'], 'unknown editability permits opt-in paste but never generic undo');
  }
  {
    const f = fixture(); let current = true;
    const result = await f.run({ isCurrent: () => { const value = current; current = false; return value; } });
    assert.equal(result.cancelled, true); assert.deepEqual(f.state.chords, []); assert.equal(f.state.shows.length, 0);
  }
  {
    const f = fixture(); f.state.target = { ...target, hwnd: 8 };
    await f.run(); assert.deepEqual(f.state.writes, ['result']); assert.deepEqual(f.state.chords, []);
  }
  for (const host of [{ processName: 'WindowsTerminal' }, { windowClass: 'ConsoleWindowClass' }, { focusClass: 'ConsoleControl' }]) {
    const terminal = { ...target, ...host }; const f = fixture(); f.state.target = terminal;
    await f.run({ target: terminal }); assert.equal(pasteChord(terminal, 'win32'), 'shift-insert');
    assert.match((await f.delivery.undo(f.token())).note, /终端内容未修改/);
    assert.deepEqual(f.state.chords, ['shift-insert'], 'terminal never undoes or appends source');
  }
  {
    const f = fixture(); await f.run(); const first = f.token(); await f.run({ original: 'new initial ASR', text: 'edited preview result' });
    assert.equal((await f.delivery.undo(first)).ok, false);
    assert.equal((await f.delivery.undo(f.token())).ok, true); assert.equal(f.state.writes.at(-1), 'new initial ASR');
  }
  {
    const f = fixture(); await f.run({ undoToastSeconds: 1 }); f.state.now = 1000;
    assert.equal((await f.delivery.undo(f.token())).ok, false); assert.deepEqual(f.state.writes, ['result']);
  }
  {
    const f = fixture(); await f.run(); f.state.timers[0].fn(); assert.equal((await f.delivery.undo(f.token())).ok, false);
    await f.run({ original: 'raw ASR', text: 'raw ASR', insertMode: 'clipboard' }); await f.delivery.undo(f.token());
    assert.equal(f.state.writes.at(-1), 'raw ASR');
  }
  for (const chord of ['ctrl-v', 'shift-insert', 'ctrl-z']) assert.ok(keyEvents(chord));
  for (const forbidden of ['enter', 'ctrl-u', 'escape', 'clear', 'cmd-z']) assert.equal(keyEvents(forbidden), null);
  console.log('PASS v5 delivery clipboard/paste, exact source, tokens, expiry, dirty/change, terminal no-undo/no-Enter, raw ASR and native identity guards');
})().catch((error) => { console.error(error); process.exitCode = 1; });
