// palette-busy.unit.test.js — T9 setBusy 行为（最小 DOM mock）
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl(id) {
  return {
    id,
    innerHTML: 'X:' + id,
    dataset: {},
    disabled: false,
    addEventListener: () => {},
    style: {}
  };
}

const els = {
  'btn-optimize': makeEl('btn-optimize'),
  'btn-structure': makeEl('btn-structure'),
  'btn-close': makeEl('btn-close'),
  'btn-more': makeEl('btn-more'),
  hint: { style: {}, textContent: '' },
  status: { style: {}, textContent: '' },
  'more-menu': { style: {} },
  'btn-copy-raw': makeEl('btn-copy-raw'),
  'btn-open-app': makeEl('btn-open-app'),
  'btn-feedback': makeEl('btn-feedback')
};

const documentMock = {
  querySelector: (sel) => els[String(sel).replace(/^#/, '')] || null
};

const windowMock = {
  v2p: {
    paletteRun: async () => ({ ok: true, note: 'ok' }),
    paletteDismiss: () => {},
    paletteCopyRaw: async () => {},
    onPaletteShow: () => {},
    openSettings: () => {}
  },
  addEventListener: () => {}
};

const code = fs.readFileSync(path.join(__dirname, '../renderer/palette.js'), 'utf8')
  + '\n;globalThis.__setBusy = setBusy;';

const sandbox = {
  document: documentMock,
  window: windowMock,
  console,
  setTimeout: (fn) => { fn(); return 0; }
};
vm.runInNewContext(code, sandbox);

let fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, e.message); }
}

t('setBusy spinner + disable + restore', () => {
  sandbox.__setBusy(true, '结构化处理中…', 'btn-structure');
  assert.equal(els['btn-structure'].disabled, true);
  assert.ok(String(els['btn-structure'].innerHTML).includes('spinner'));
  assert.ok(String(els['btn-structure'].innerHTML).includes('结构化中'));
  assert.equal(els['btn-optimize'].disabled, true);
  sandbox.__setBusy(false, '');
  assert.equal(els['btn-structure'].disabled, false);
  assert.ok(String(els['btn-structure'].innerHTML).startsWith('X:'));
});

t('optimize uses optimize label', () => {
  sandbox.__setBusy(true, '优化中', 'btn-optimize');
  assert.ok(String(els['btn-optimize'].innerHTML).includes('优化中'));
  assert.ok(String(els['btn-optimize'].innerHTML).includes('spinner'));
  sandbox.__setBusy(false, '');
});

if (fail) { console.log('T9 BUSY FAIL'); process.exitCode = 1; }
else console.log('T9 BUSY ALL PASS');
