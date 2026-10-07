const assert = require('assert'); const fs = require('fs'); const vm = require('vm'); const path = require('path');
const config = { asrProviders: [{ id: 'asr' }], activeAsrId: 'asr', llmProviders: [{ id: 'llm' }], activeLlmId: 'llm', insertMode: 'paste', enableOptimize: false, enableStructure: false };
let inserted = 0, modelCalls = 0; const calls = []; const moduleObject = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'pipeline.js'), 'utf8'), {
  module: moduleObject, Buffer, Date, require: (name) => name === './config' ? { ...require('./text-prompts'), load: () => config, unmask: (x) => x, ensureRedline: (x) => x } :
    name === './models' ? { transcribeSmart: async () => ' initial ASR raw\n', chatCompletion: async (_, sys, input) => { modelCalls++; calls.push({ sys, input }); return '整理后的文本'; } } :
    name === './insert' ? { insertText: async () => { inserted++; return { inserted: true, copiedOnly: false }; } } :
    name === 'fs' ? { writeFileSync() {}, unlinkSync() {} } : require(name)
}, { filename: path.join(__dirname, 'pipeline.js') });
(async () => {
  const pipeline = moduleObject.exports;
  const raw = await pipeline.run(Buffer.from('fake audio'), 'audio/wav', () => {}, { deferDelivery: true });
  assert.equal(raw.raw, ' initial ASR raw\n'); assert.equal(raw.polished, raw.raw); assert.equal(inserted, 0); assert.equal(modelCalls, 0);
  const preview = await pipeline.run(Buffer.from('fake'), '', () => {}, { transcriptOnly: true, deferDelivery: true });
  assert.equal(preview.raw, raw.raw); assert.equal(preview.preview, true); assert.equal(inserted, 0);
  const transformed = await pipeline.run(Buffer.from('fake'), '', () => {}, { mode: 'structure', deferDelivery: true });
  assert.equal(transformed.raw, raw.raw); assert.equal(modelCalls, 1); assert.equal(inserted, 0);
  assert.equal(JSON.parse(calls[0].input).source, raw.raw);
  await pipeline.run(Buffer.from('fake'), '', () => {}, {}); assert.equal(inserted, 1, 'legacy pipeline callers retain delivery');
  console.log('PASS v5 deferred voice pipeline, raw-only/preview source, single model call and JSON input');
})().catch((e) => { console.error(e); process.exitCode = 1; });
