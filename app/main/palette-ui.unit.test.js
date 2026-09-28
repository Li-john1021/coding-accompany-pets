// palette-ui.unit.test.js — T9 浮条竖排/顺序/动画类 单元冒烟
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '../renderer/palette.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '../renderer/palette.js'), 'utf8');

let fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, e.message); }
}

t('structure button before optimize (primary first)', () => {
  const iS = html.indexOf('id="btn-structure"');
  const iO = html.indexOf('id="btn-optimize"');
  assert.ok(iS > 0 && iO > 0, 'buttons exist');
  assert.ok(iS < iO, 'structure must be first');
});

t('column layout + white bg', () => {
  assert.ok(/flex-direction:\s*column/.test(html), 'column');
  assert.ok(/background:\s*#fff/.test(html), 'white bg');
});

t('loading spinner + per-mode labels', () => {
  assert.ok(html.includes('class="spinner"') || js.includes('spinner'), 'spinner');
  assert.ok(js.includes('结构化中') && js.includes('优化中'), 'distinct labels');
  assert.ok(js.includes('runMode'), 'run on click only');
});

t('never auto model on show', () => {
  const show = js.slice(js.indexOf('onPaletteShow'));
  assert.ok(!/paletteRun/.test(show.split('onPaletteShow')[1] || show.slice(0, 400)), 'no run on show');
});

if (fail) { console.log('T9 UNIT FAIL', fail); process.exitCode = 1; }
else console.log('T9 UNIT ALL PASS');
