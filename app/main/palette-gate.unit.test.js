// palette-gate.unit.test.js — fail-closed passive palette eligibility
const assert = require('assert');
const { isTerminalProcess, shouldShowPalette, meetsMinimumCharacters } = require('./palette-gate.js');

let fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, e.message); }
}

const selection = { confirmed: true, controlId: 'pid|hwnd|runtime', text: 'selected text', processName: 'notepad' };

t('only confirmed non-empty selection with identity passes', () => {
  assert.equal(shouldShowPalette({ selection, enabled: true, now: 1000 }).ok, true);
  for (const bad of [null, {}, { ...selection, confirmed: false }, { ...selection, controlId: '' },
    { ...selection, text: '' }, { ...selection, processName: '' }]) {
    assert.equal(shouldShowPalette({ selection: bad, enabled: true, now: 1000 }).ok, false);
  }
  assert.equal(shouldShowPalette({ selection: { ...selection, text: '  ' }, enabled: true, now: 1000 }).ok, true);
});

t('disabled, recording, recent user copy, and terminal deny', () => {
  assert.equal(shouldShowPalette({ selection, enabled: false, now: 1000 }).reason, 'disabled');
  assert.equal(shouldShowPalette({ selection, recording: true, now: 1000 }).reason, 'recording');
  assert.equal(shouldShowPalette({ selection, userCopyAt: 800, now: 1000 }).reason, 'user-copy');
  for (const name of ['WindowsTerminal', 'pwsh.exe', 'cmd']) assert.equal(isTerminalProcess(name), true);
  assert.equal(shouldShowPalette({ selection: { ...selection, processName: 'WindowsTerminal' }, now: 1000 }).reason, 'terminal');
});

t('threshold is considered only for confirmed text', () => {
  assert.equal(meetsMinimumCharacters(null, 3), false);
  assert.equal(meetsMinimumCharacters({ ...selection, confirmed: false }, 3), false);
  assert.equal(meetsMinimumCharacters({ ...selection, text: '  ' }, 1), false);
  assert.equal(meetsMinimumCharacters({ ...selection, text: ' ab ' }, 3), false);
  assert.equal(meetsMinimumCharacters({ ...selection, text: ' abc ' }, 3), true);
});

if (fail) { console.log('PALETTE GATE FAIL', fail); process.exitCode = 1; }
else console.log('PALETTE GATE ALL PASS');
