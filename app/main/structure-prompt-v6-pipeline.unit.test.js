const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const prompts = require('./text-prompts');
const syntheticCases = require('./structure-prompt-v6.synthetic');

const calls = [];
const config = {
  STRUCTURE_ONLY_PROMPT: prompts.STRUCTURE_ONLY_PROMPT,
  DEFAULT_PROMPT: prompts.DEFAULT_PROMPT,
  ensureRedline: (prompt) => prompt,
  load: () => ({ llmProviders: [{ id: 'mock-llm' }], activeLlmId: 'mock-llm' }),
  unmask: (value) => value
};
const moduleObject = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'pipeline.js'), 'utf8'), {
  module: moduleObject,
  Buffer,
  require: (name) => name === './config' ? config :
    name === './models' ? {
      chatCompletion: async (provider, system, user) => {
        calls.push({ provider, system, user });
        return 'stub output';
      },
      transcribeSmart: async () => { throw new Error('ASR must not run'); }
    } :
    name === './insert' ? { insertText: async () => { throw new Error('delivery must not run'); } } : require(name)
}, { filename: path.join(__dirname, 'pipeline.js') });

(async () => {
  const pipeline = moduleObject.exports;
  for (const item of syntheticCases) {
    const before = calls.length;
    const result = await pipeline.processText(item.input, 'structure');
    assert.equal(result.mode, 'structure', `${item.id}: structure route`);
    assert.equal(result.text, 'stub output', `${item.id}: mocked transform result`);
    assert.equal(calls.length - before, 1, `${item.id}: one normal-path model call`);
    const call = calls[calls.length - 1];
    assert.equal(call.provider.id, 'mock-llm');
    assert.equal(call.system, prompts.STRUCTURE_ONLY_PROMPT);
    assert.deepEqual(JSON.parse(call.user), { source: item.input });
  }
  assert.equal(calls.length, syntheticCases.length, 'no additional normal-path calls');
  console.log(`PASS structure pipeline routes ${syntheticCases.length} synthetic inputs once each with the structure prompt and JSON source (mock transport only)`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
