const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

(async () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const start = main.indexOf("ipcMain.handle('v2p:validate-model'");
  const end = main.indexOf("ipcMain.handle('v2p:submit'", start);
  assert.ok(start >= 0 && end > start);
  let handler;
  const calls = [];
  vm.runInNewContext(main.slice(start, end), {
    ipcMain: { handle(name, fn) { assert.equal(name, 'v2p:validate-model'); handler = fn; } },
    models: Object.fromEntries(['validateAsr', 'validateLlm', 'validateImageVision'].map(name =>
      [name, async provider => { calls.push({ name, provider }); return { ok: true }; }]))
  });
  const provider = { model: 'fixture', baseUrl: 'http://local/v1' };
  await handler(null, { kind: 'llm', provider });
  assert.equal(calls.pop().name, 'validateLlm', 'text models always use the text ping');
  await handler(null, { kind: 'llm', provider: { ...provider, multimodal: true } });
  assert.equal(calls.pop().name, 'validateLlm', 'a legacy multimodal field no longer changes text validation');
  await handler(null, { kind: 'asr', provider });
  assert.equal(calls.pop().name, 'validateAsr', 'ASR validation remains independent');
  await handler(null, { kind: 'image-vision', provider });
  assert.equal(calls.pop().name, 'validateImageVision');
  console.log('PASS settings validation IPC routes the vision list to the image probe');
})().catch(error => { console.error(error); process.exitCode = 1; });
