const assert = require('assert');
const { createImageWorkflow } = require('./image-workflow');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function main() {
  let provider = { baseUrl: 'http://local/v1', model: 'vision-a', multimodal: true, apiKey: '' };
  let image = Buffer.from('png-a');
  let clipboardText = 'untouched';
  let conflicting = false;
  let calls = [];
  const request = deferred();
  const workflow = createImageWorkflow({
    getProvider: () => ({ ...provider }), getProviderStatus: () => ({ ...provider }), hasImage: () => !!image,
    readImage: () => Buffer.from(image), capture: async () => ({ ok: true, width: 1, height: 1 }),
    transcribeImage: (p, png, opts) => { calls.push({ p, png: Buffer.from(png), signal: opts.signal }); return request.promise; },
    writeText: (text) => { clipboardText = text; }, isConflicting: () => conflicting
  });

  const run = workflow.recognize();
  assert.strictEqual(workflow.busy, true, 'recognition owns the shared workflow lock');
  assert.strictEqual(workflow.state().eligible, false, 'busy recognition disables the action');
  assert.strictEqual(calls.length, 1, 'one model call starts');
  provider = { baseUrl: 'http://changed', model: 'vision-b', multimodal: true, apiKey: 'changed' };
  image = Buffer.from('png-b');
  assert.strictEqual((await workflow.runScreenshot()).reason, 'busy', 'screenshot cannot start during recognition');
  request.resolve('  code:\n  keep-indent  ');
  const result = await run;
  assert.strictEqual(result.ok, true);
  assert.strictEqual(clipboardText, '  code:\n  keep-indent  ', 'writes final body without trimming meaningful whitespace');
  assert.strictEqual(calls[0].p.model, 'vision-a');
  assert.deepStrictEqual(calls[0].png, Buffer.from('png-a'));

  const capture = deferred();
  const second = createImageWorkflow({ ...{
    getProvider: () => provider, getProviderStatus: () => provider, hasImage: () => !!image, readImage: () => image,
    capture: () => capture.promise, transcribeImage: async () => 'ok', writeText: () => {},
    isConflicting: () => conflicting
  } });
  const shot = second.runScreenshot();
  assert.strictEqual(second.busy, true);
  assert.strictEqual((await second.recognize()).ok, false, 'recognition cannot start during screenshot');
  capture.resolve({ ok: true });
  assert.strictEqual((await shot).ok, true);

  let writes = 0;
  const empty = createImageWorkflow({ getProvider: () => provider, getProviderStatus: () => provider, hasImage: () => true, readImage: () => Buffer.from('png'),
    capture: async () => ({ ok: true }), transcribeImage: async () => ' \n ', writeText: () => writes++, isConflicting: () => false });
  assert.strictEqual((await empty.recognize()).ok, false, 'blank final output fails');
  assert.strictEqual(writes, 0, 'blank result never overwrites clipboard');

  const failure = createImageWorkflow({ getProvider: () => provider, getProviderStatus: () => provider, hasImage: () => true, readImage: () => Buffer.from('png'),
    capture: async () => ({ ok: true }), transcribeImage: async () => { throw new Error('service unavailable'); },
    writeText: () => writes++, isConflicting: () => false });
  assert.strictEqual((await failure.recognize()).ok, false, 'provider failures surface as failed recognition');
  assert.strictEqual(failure.state().error, 'service unavailable');
  assert.strictEqual(writes, 0, 'provider failure never overwrites clipboard');

  const late = deferred();
  const disposed = createImageWorkflow({ getProvider: () => provider, getProviderStatus: () => provider, hasImage: () => true, readImage: () => Buffer.from('png'),
    capture: async () => ({ ok: true }), transcribeImage: (_p, _b, opts) => { late.signal = opts.signal; return late.promise; },
    writeText: () => writes++, isConflicting: () => false });
  const lateRun = disposed.recognize();
  disposed.dispose();
  assert.strictEqual(late.signal.aborted, true, 'shutdown aborts the in-flight request');
  late.resolve('late result');
  await lateRun;
  assert.strictEqual(writes, 0, 'late completion after disposal cannot write clipboard');
  assert.strictEqual(disposed.state().eligible, false);
  console.log('PASS image workflow snapshots, mutual exclusion, empty output, and disposal');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
