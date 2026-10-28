const assert = require('assert');
const { EventEmitter } = require('events');
const { buildWorkerScript, createScreenshotCaptureWorker } = require('./screenshot-capture-worker');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdin = { writes: [], write(value) { this.writes.push(value); return true; } };
  child.exitCode = null;
  child.killed = false;
  child.kill = () => { child.killed = true; child.exitCode = 1; child.emit('close', 1); };
  return child;
}

function tick() { return new Promise((resolve) => setImmediate(resolve)); }

async function main() {
  const script = buildWorkerScript();
  assert.match(script, /SetProcessDpiAwarenessContext/);
  assert.match(script, /Screen\]::AllScreens/);
  assert.match(script, /CopyPixelOperation\.SourceCopy/);
  assert.match(script, /while \(\(\$line = \[Console\]::In.ReadLine\(\)\)/, 'worker remains resident for line-delimited commands');

  const children = [];
  const worker = createScreenshotCaptureWorker({ platform: 'win32', timeout: 40, spawn: () => {
    const child = fakeChild();
    children.push(child);
    return child;
  } });
  const warm = worker.warm();
  assert.equal(children.length, 1, 'warm starts one resident process');
  children[0].stdout.emit('data', Buffer.from('{"ready":true}\n'));
  assert.equal(await warm, true);

  const monitors = [
    { id: 'left', x: -1920, y: 0, width: 1920, height: 1080 },
    { id: 'right', x: 0, y: 120, width: 2560, height: 1440 }
  ];
  const pending = worker.capture(monitors);
  assert.equal(children.length, 1, 'warm capture reuses the same process');
  const request = JSON.parse(children[0].stdin.writes[0]);
  assert.deepStrictEqual(request.monitors, monitors, 'one command carries every physical monitor and its stable ID');
  children[0].stdout.emit('data', Buffer.from(JSON.stringify({ id: request.id, captures: monitors.map((monitor) => ({ ...monitor, png: 'cG5n' })) }) + '\n'));
  assert.equal((await pending).length, 2);

  const timeoutPending = worker.capture(monitors);
  await assert.rejects(timeoutPending, /timed out/);
  assert.equal(children[0].killed, true, 'a timed out worker is killed so the next trigger can restart it');
  const restarted = worker.capture(monitors);
  assert.equal(children.length, 2, 'next trigger starts a fresh worker after timeout');
  children[1].stdout.emit('data', Buffer.from('{"ready":true}\n'));
  await tick();
  const retryRequest = JSON.parse(children[1].stdin.writes[0]);
  children[1].stdout.emit('data', Buffer.from(JSON.stringify({ id: retryRequest.id, captures: [] }) + '\n'));
  assert.deepStrictEqual(await restarted, []);

  const abort = new AbortController();
  const cancelled = worker.capture(monitors, { signal: abort.signal });
  abort.abort();
  await assert.rejects(cancelled, /cancelled/);
  assert.equal(children[1].killed, true, 'cancellation kills the resident worker');
  const afterCancel = worker.capture(monitors);
  assert.equal(children.length, 3, 'next trigger restarts a cancelled worker');
  children[2].stdout.emit('data', Buffer.from('{"ready":true}\n'));
  await tick();
  const afterCancelRequest = JSON.parse(children[2].stdin.writes[0]);
  children[2].stdout.emit('data', Buffer.from(JSON.stringify({ id: afterCancelRequest.id, captures: [] }) + '\n'));
  await afterCancel;
  worker.dispose();
  assert.equal(children[2].killed, true, 'dispose terminates resident worker');

  const disposableChild = fakeChild();
  const disposable = createScreenshotCaptureWorker({ platform: 'win32', spawn: () => disposableChild });
  const inFlight = disposable.capture(monitors);
  disposable.dispose();
  await assert.rejects(inFlight, /disposed/);
  console.log('PASS persistent screenshot worker warm reuse, multi-monitor protocol, timeout restart and disposal');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
