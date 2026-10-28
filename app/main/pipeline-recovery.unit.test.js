'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, 'pipeline.js'), 'utf8');

function createHarness(options = {}) {
  const calls = { save: 0, saveText: 0, clear: 0, insert: 0, transcribe: 0 };
  const settings = {
    asrProviders: [{ id: 'asr-1', baseUrl: 'https://mock.invalid', apiKey: 'b64:abc', model: 'mock' }],
    llmProviders: [],
    activeAsrId: 'asr-1',
    activeLlmId: '',
    enableOptimize: false,
    enableStructure: false,
    insertMode: 'paste',
    promptText: ''
  };
  const recovery = {
    save: () => { calls.save++; if (options.saveError) throw new Error(options.saveError); return { ok: true, id: 'recovery-1' }; },
    saveText: () => { calls.saveText++; if (options.saveTextError) throw new Error(options.saveTextError); return { ok: true }; },
    clear: () => { calls.clear++; if (options.clearError) throw new Error(options.clearError); return { ok: true }; }
  };
  const config = {
    load: () => settings,
    unmask: (value) => value,
    STRUCTURE_ONLY_PROMPT: 'STRUCTURE',
    DEFAULT_PROMPT: 'DEFAULT',
    ensureRedline: (value) => value
  };
  const models = {
    chatCompletion: async () => { throw new Error('chat must not run'); },
    transcribeSmart: async () => {
      calls.transcribe++;
      if (options.transcribeError) throw new Error(options.transcribeError);
      return options.transcript ?? 'hello';
    }
  };
  const insert = { insertText: async () => { calls.insert++; return { inserted: true, copiedOnly: false }; } };
  const moduleObject = { exports: {} };
  const dependencies = {
    './config': config,
    './text-prompts': { sourceMessage: (text) => JSON.stringify({ source: text }) },
    './models': models,
    './insert': insert,
    './audio-recovery': recovery
  };
  vm.runInNewContext(source, {
    module: moduleObject,
    exports: moduleObject.exports,
    Buffer,
    require: (name) => {
      assert(Object.prototype.hasOwnProperty.call(dependencies, name), `unexpected dependency: ${name}`);
      return dependencies[name];
    }
  }, { filename: path.join(__dirname, 'pipeline.js') });
  return { pipeline: moduleObject.exports, calls };
}

(async () => {
  {
    const { pipeline, calls } = createHarness({ saveError: 'disk full' });
    const result = await pipeline.run(Buffer.from('audio'), 'audio/wav', () => {}, { mode: 'none' });
    assert.equal(result.raw, 'hello');
    assert.equal(result.recoveryId, null);
    assert.equal(result.recoveryError, 'disk full');
    assert.equal(calls.transcribe, 1, 'transcription continues when recovery storage fails');
    assert.equal(calls.insert, 1);
    assert.equal(calls.clear, 0);
  }

  {
    const { pipeline, calls } = createHarness({ transcribeError: 'asr down' });
    await assert.rejects(pipeline.run(Buffer.from('audio'), 'audio/wav', () => {}, { mode: 'none' }), (error) => {
      assert.equal(error.message, 'asr down');
      assert.equal(error.recoveryId, 'recovery-1');
      assert.equal(error.recoveryError, undefined);
      return true;
    });
    assert.equal(calls.saveText, 0, 'raw text is not saved when transcription fails');
    assert.equal(calls.clear, 0, 'failed transcription retains recovery');
    assert.equal(calls.insert, 0);
  }

  {
    const { pipeline, calls } = createHarness({ clearError: 'locked' });
    const result = await pipeline.run(Buffer.from('audio'), 'audio/wav', () => {}, { mode: 'none' });
    assert.equal(result.recoveryId, 'recovery-1');
    assert.equal(result.inserted, true);
    assert.equal(calls.clear, 1, 'successful delivery attempts cleanup');
  }

  {
    const { pipeline, calls } = createHarness({ saveTextError: 'metadata locked' });
    const result = await pipeline.run(Buffer.from('audio'), 'audio/wav', () => {}, { mode: 'none' });
    assert.equal(result.recoveryError, 'metadata locked');
    assert.equal(calls.insert, 1, 'raw transcript delivery survives metadata save failure');
    assert.equal(calls.clear, 1);
  }

  {
    const { pipeline, calls } = createHarness();
    const result = await pipeline.run(Buffer.from('audio'), 'audio/wav', () => {}, { mode: 'none', deferDelivery: true });
    assert.equal(result.recoveryId, 'recovery-1');
    assert.equal(calls.clear, 0, 'deferred delivery keeps recovery until the caller confirms');
    assert.equal(calls.insert, 0);
  }

  console.log('PASS pipeline recovery failure, cleanup, and deferred-delivery semantics');
})().catch((error) => { console.error(error); process.exitCode = 1; });