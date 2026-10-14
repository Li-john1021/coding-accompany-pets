const assert = require('assert'); const fs = require('fs'); const vm = require('vm'); const path = require('path');
const source = fs.readFileSync(path.join(__dirname, 'target-keys.js'), 'utf8');
const target = { hwnd: 1, pid: 2, threadId: 3, focusHwnd: 4, windowClass: 'Host', focusClass: 'Edit', processName: 'fixture' };
let calls = 0; const moduleObject = { exports: {} };
vm.runInNewContext(source, { module: moduleObject, require: () => ({ nativeInputSession: { send: async (events, host, options) => {
  calls++; assert.equal(host, target); assert.equal(options.expectedGeneration, 9); assert.equal(options.sessionId, 'session');
  assert.ok(events.some(([key]) => key === 90)); assert.ok(events.some(([key]) => key === 86));
  return { sent: true, generation: 9, sessionId: 'session' };
} } }) });
(async () => {
  const pre = new AbortController(); pre.abort();
  assert.equal((await moduleObject.exports.sendTargetChord('ctrl-z', target, { signal: pre.signal })).sent, false); assert.equal(calls, 0);
  assert.equal((await moduleObject.exports.sendTargetChord('voice-restore', target, { expectedGeneration: 9, sessionId: 'session' })).sent, true); assert.equal(calls, 1);
  assert.equal((await moduleObject.exports.sendTargetChord('enter', target)).sent, false); assert.equal(calls, 1);
  console.log('PASS target chord forwards native session/generation/signal, pre-abort dispatches nothing, and voice restoration remains one packet with no Enter');
})().catch((error) => { console.error(error); process.exitCode = 1; });
