const assert = require('assert'); const fs = require('fs'); const vm = require('vm'); const path = require('path');
const { EventEmitter } = require('events');
const source = fs.readFileSync(path.join(__dirname, 'target-keys.js'), 'utf8');
const target = { hwnd: 1, pid: 2, threadId: 3, focusHwnd: 4, windowClass: 'Host', focusClass: 'Edit', processName: 'fixture' };
function fixture(runner) {
  const module = { exports: {} };
  vm.runInNewContext(source, { module, Buffer, process: { platform: 'win32' }, require: () => ({ runPowerShellFile: runner }) });
  return module.exports;
}
(async () => {
  let spawned = 0, killed = 0, completed = 0, callback;
  let child;
  const api = fixture((_script, _options, cb) => { spawned++; callback = cb; child = { stdout: new EventEmitter(), stdin: { end() {} }, kill() { killed++; setImmediate(() => { completed++; cb(new Error('terminated'), ''); }); } }; return child; });
  const pre = new AbortController(); pre.abort(); assert.equal(await api.sendTargetChord('ctrl-z', target, { signal: pre.signal }), false); assert.equal(spawned, 0);
  const controller = new AbortController();
  const pending = api.sendTargetChord('voice-restore', target, { signal: controller.signal }); controller.abort();
  assert.equal(await pending, false); assert.equal(spawned, 1); assert.equal(killed, 1); assert.equal(completed, 1, 'completion callback is consumed after child termination/cleanup');
  callback(null, 'V2P_SENT'); assert.equal(completed, 1, 'late callback cannot change cancelled result');
  const clean = new AbortController();
  let committed = 0;
  const success = api.sendTargetChord('ctrl-z', target, { signal: clean.signal, onCommit: () => { committed++; } });
  child.stdout.emit('data', Buffer.from('V2P_READY\n')); assert.equal(committed, 1);
  clean.abort(); assert.equal(killed, 1, 'own injected events after commit do not kill an already committed packet');
  callback(null, 'V2P_READY\nV2P_SENT'); assert.equal(await success, true);
  clean.abort(); assert.equal(killed, 1, 'abort listener is removed once native process completes');
  // Real runner cancellation: no native keys, and temporary files are cleaned before resolution.
  const os = require('os'); const real = require('./powershell-file');
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('v2p-palette-ps-')));
  const childApi = fixture((_script, options, cb) => real.runPowerShellFile("Start-Sleep -Seconds 5; 'V2P_SENT'", options, cb));
  const actual = new AbortController(); const result = childApi.sendTargetChord('ctrl-z', target, { signal: actual.signal });
  setTimeout(() => actual.abort(), 100); assert.equal(await result, false);
  const after = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('v2p-palette-ps-') && !before.has(name));
  assert.deepEqual(after, [], 'real cancelled child cleans its temporary script');
  console.log('PASS native chord pre-abort zero spawn, pending abort, callback consumption, listener removal and real child cleanup');
})().catch((error) => { console.error(error); process.exitCode = 1; });
