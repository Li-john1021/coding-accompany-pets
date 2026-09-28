// models-thinking.unit.test.js — T8 思考模式分模式开关
const assert = require('assert');
// stub electron not needed; models.js has no electron require
const { shouldDisableThinking } = require('./models.js');

let fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, e.message); }
}

t('structure mode default disables thinking', () => {
  const cfg = { structureDisableThinking: true, optimizeDisableThinking: true };
  assert.equal(shouldDisableThinking({ baseUrl: 'https://api.example.com' }, 'structure', cfg), true);
  assert.equal(shouldDisableThinking({ baseUrl: 'https://api.example.com' }, 'optimize', cfg), true);
});

t('mode checkbox off + provider auto non-mimo keeps thinking', () => {
  const cfg = { structureDisableThinking: false, optimizeDisableThinking: false };
  assert.equal(shouldDisableThinking({ baseUrl: 'https://api.example.com' }, 'structure', cfg), false);
  assert.equal(shouldDisableThinking({ baseUrl: 'https://api.example.com' }, 'optimize', cfg), false);
});

t('mimo auto disable still works', () => {
  const cfg = { structureDisableThinking: false, optimizeDisableThinking: false };
  assert.equal(shouldDisableThinking({ baseUrl: 'https://api.xiaomimimo.com' }, 'structure', cfg), true);
});

t('provider noThinking true forces disable', () => {
  const cfg = { structureDisableThinking: false, optimizeDisableThinking: false };
  assert.equal(shouldDisableThinking({ baseUrl: 'https://x.com', noThinking: true }, 'optimize', cfg), true);
});

t('provider noThinking false beats auto but not mode force', () => {
  assert.equal(shouldDisableThinking({ baseUrl: 'https://api.xiaomimimo.com', noThinking: false }, undefined, undefined), false);
  assert.equal(shouldDisableThinking({ baseUrl: 'https://api.xiaomimimo.com', noThinking: false }, 'structure', { structureDisableThinking: true }), true);
});

if (fail) { console.log('T8 UNIT FAIL', fail); process.exitCode = 1; }
else console.log('T8 UNIT ALL PASS');
