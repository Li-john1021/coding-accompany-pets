'use strict';

const assert = require('assert');
const { activeVisionProvider, visionProviderStatus } = require('./vision-target');

const cfg = {
  activeLlmId: 'text-a',
  llmProviders: [{ id: 'text-a', baseUrl: 'http://a/v1', model: 'text-a' }],
  activeVisionId: 'vision-b',
  visionProviders: [
    { id: 'vision-a', baseUrl: 'http://va/v1', model: 'vision-a' },
    { id: 'vision-b', baseUrl: 'http://vb/v1', model: 'vision-b' }
  ]
};

assert.equal(activeVisionProvider(cfg).id, 'vision-b', 'uses the selected vision provider');
assert.deepStrictEqual(visionProviderStatus(cfg), { baseUrl: 'http://vb/v1', model: 'vision-b' });

const stale = { ...cfg, activeVisionId: 'deleted' };
assert.equal(activeVisionProvider(stale).id, 'vision-a', 'falls back to the first vision provider');

const empty = { llmProviders: [{ id: 'text-a', baseUrl: 'http://a/v1', model: 'text-a' }], activeLlmId: 'text-a' };
assert.equal(activeVisionProvider(empty), null, 'text models are never used as vision implicitly');
assert.equal(visionProviderStatus(empty), null);
assert.equal(visionProviderStatus(null), null);
assert.equal(activeVisionProvider({ visionProviders: [{ id: 'x', baseUrl: '', model: '' }] }).id, 'x', 'an incomplete provider is returned so the gate can explain');
assert.equal(visionProviderStatus({ visionProviders: [{ id: 'x', baseUrl: '', model: '' }] }).baseUrl, '');

console.log('PASS vision target is independent from the text model and falls back safely');