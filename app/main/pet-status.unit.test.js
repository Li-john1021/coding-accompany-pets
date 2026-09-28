// pet-status.unit.test.js — T10 底部文字条分状态
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const petHtml = fs.readFileSync(path.join(__dirname, '../renderer/pet.html'), 'utf8');
const petJs = fs.readFileSync(path.join(__dirname, '../renderer/pet.js'), 'utf8');
const pipeline = fs.readFileSync(path.join(__dirname, 'pipeline.js'), 'utf8');

let fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, e.message); }
}

t('bottom bar larger font + mode colors', () => {
  assert.ok(/font-size:\s*15px/.test(petHtml), 'font 15px');
  assert.ok(petHtml.includes('mode-structure') && petHtml.includes('mode-optimize'));
  assert.ok(petHtml.includes('mode-done-structure') && petHtml.includes('mode-done-optimize'));
});

t('distinct running labels', () => {
  assert.ok(petJs.includes('结构化中') && petJs.includes('优化提示词中'));
  assert.ok(petJs.includes('结构化完成') && petJs.includes('优化完成'));
});

t('pipeline emits structuring/optimizing stages', () => {
  assert.ok(pipeline.includes("'structuring'") && pipeline.includes("'optimizing'"));
});


t('palette/preview broadcast v2p:result', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const pal = main.split('v2p:palette-run')[1] || '';
  assert.ok(pal.includes("petBroadcast('v2p:result'"), 'palette-run result');
  const pv = main.split('v2p:preview-close')[1] || '';
  assert.ok(pv.includes('degraded') && pv.includes('mode'), 'preview result meta');
});

t('degraded uses warning style', () => {
  assert.ok(petJs.includes('mode-error') && petJs.includes('degraded'));
});

if (fail) { console.log('T10 UNIT FAIL'); process.exitCode = 1; }
else console.log('T10 UNIT ALL PASS');
