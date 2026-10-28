const assert = require('assert');
const { spawn } = require('child_process');
const { app, screen } = require('electron');
const { createScreenshotCaptureWorker } = require('./screenshot-capture-worker');

const ARG = '--screenshot-capture-benchmark-fixture';
const PREFIX = 'CAPTURE_BENCHMARK:';

async function fixture() {
  const worker = createScreenshotCaptureWorker();
  try {
    await app.whenReady();
    const displays = screen.getAllDisplays().map((display) => ({
      id: String(display.id), ...screen.dipToScreenRect(null, display.bounds)
    }));
    const coldStart = performance.now();
    const warm = await worker.warm();
    const workerReadyMs = performance.now() - coldStart;
    assert.equal(warm, true, 'resident worker reports initialization ready');

    const firstTrigger = performance.now();
    const first = await worker.capture(displays);
    const coldTriggerToCaptureMs = performance.now() - firstTrigger;
    const nextTrigger = performance.now();
    const second = await worker.capture(displays);
    const warmTriggerToCaptureMs = performance.now() - nextTrigger;
    assert.equal(first.length, displays.length);
    assert.equal(second.length, displays.length);
    assert.ok(first.every((entry) => /^[A-Za-z0-9+/]+={0,2}$/.test(entry.png)));
    console.log(PREFIX + JSON.stringify({ ok: true, workerReadyMs, coldTriggerToCaptureMs, warmTriggerToCaptureMs,
      monitorCount: displays.length, capturedPngCount: second.length, savedImageBytes: 0, keyboardOrClipboardUsed: false }));
  } catch (error) {
    console.log(PREFIX + JSON.stringify({ ok: false, error: String(error.stack || error) }));
    process.exitCode = 1;
  } finally {
    worker.dispose();
    app.quit();
  }
}

function run() {
  const child = spawn(require('electron'), [__filename, ARG], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const timeout = setTimeout(() => child.kill(), 60000);
  child.on('error', (error) => { clearTimeout(timeout); throw error; });
  child.on('close', (code) => {
    clearTimeout(timeout);
    try {
      const line = output.split(/\r?\n/).find((entry) => entry.startsWith(PREFIX));
      assert.ok(line, output.slice(-4000));
      const result = JSON.parse(line.slice(PREFIX.length));
      assert.equal(result.ok, true, result.error);
      assert.equal(code, 0);
      console.log('PASS native resident screenshot capture timing benchmark');
      console.log('EVIDENCE ' + JSON.stringify(result));
    } catch (error) { console.error(error); process.exitCode = 1; }
  });
}

if (process.argv.includes(ARG)) fixture();
else run();
