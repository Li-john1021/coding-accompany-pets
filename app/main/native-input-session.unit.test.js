const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { EventEmitter, once } = require('events');
const { NativeInputSession } = require('./native-input-session');
const target = { hwnd: 1, pid: 1, threadId: 1, focusHwnd: 1, windowClass: 'X', focusClass: 'X', processName: 'X' };
const keys = [[17, 0], [90, 0], [90, 2], [17, 2]];
function fake() {
  let child; let spawned = 0; const commands = [];
  const session = new NativeInputSession({ spawnProcess: () => {
    spawned++; child = new EventEmitter(); child.stdout = new EventEmitter(); child.stdin = new EventEmitter(); child.kills = 0;
    child.stdin.write = (line) => commands.push(JSON.parse(line));
    child.kill = () => { child.kills++; setImmediate(() => child.emit('close')); };
    return child;
  } });
  const output = (value) => child.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n'));
  return { session, commands, output, get child() { return child; }, get spawned() { return spawned; } };
}
(async () => {
  const f = fake(); const pre = new AbortController(); pre.abort();
  assert.equal((await f.session.send(keys, target, { signal: pre.signal })).sent, false); assert.equal(f.spawned, 0);
  const starting = f.session.start(); f.output({ type: 'ready', generation: 7 }); assert.equal(await starting, true);
  const oldId = f.session.sessionId; const controller = new AbortController();
  const pending = f.session.send(keys, target, { signal: controller.signal, sessionId: oldId, expectedGeneration: 7 });
  assert.equal(f.commands[0].expectedGeneration, 7); controller.abort();
  assert.equal(f.session.running, false); assert.equal(f.session.sessionId, null); assert.equal(f.child.kills, 1, 'abort kills native pending work, not merely the JS response');
  assert.equal((await pending).sent, false); await new Promise(setImmediate);
  assert.equal((await f.session.send(keys, target, { sessionId: oldId, expectedGeneration: 7 })).sent, false); assert.equal(f.spawned, 1, 'old operation cannot restart a new session');
  const second = f.session.start(); f.output({ type: 'ready', generation: 0 }); await second;
  assert.notEqual(f.session.sessionId, oldId);
  assert.equal((await f.session.send(keys, target, { sessionId: oldId, expectedGeneration: 0 })).sent, false);
  const newOp = f.session.send(keys, target, { expectedGeneration: 0 }); const command = f.commands.at(-1);
  f.output({ id: command.id, sent: true, generation: 0 }); assert.equal((await newOp).sessionId, f.session.sessionId);
  f.session.stop(); await new Promise(setImmediate);
  const native = fs.readFileSync(path.join(__dirname, 'native-input-guard.cs'), 'utf8');
  assert.match(native, /input\.extra\.ToUInt64\(\)/); assert.match(native, /!IsOwn/);
  assert.match(native, /inputs\[i\]\.data\.key\.extra=/);
  assert.ok(native.indexOf('if(!PumpPendingInput())') < native.indexOf('long baseline=generation;'));
  assert.ok(native.indexOf('baseline!=expected') < native.indexOf('bool sent=SendInput'));
  assert.match(native, /IsWindowVisible\(toast\)/); assert.match(native, /GetAncestor\(WindowFromPoint/);
  // Compile and exercise the actual native protocol without sending any key.
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('v2p-palette-ps-')));
  const real = new NativeInputSession(); assert.equal(await real.start(), true);
  const rejected = await real.send(keys, target); assert.equal(rejected.sent, false); assert.equal(rejected.reason, 'target-changed');
  const child = real.child; const closed = once(child, 'close'); real.stop(); assert.equal(real.running, false); assert.equal(real.sessionId, null); await closed;
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('v2p-palette-ps-') && !before.has(name)), []);
  console.log('PASS native input session startup/protocol, abort kills pending dispatch, stale session refusal, marker/generation/pump contract and actual C# compilation/cleanup');
})().catch((error) => { console.error(error); process.exitCode = 1; });
