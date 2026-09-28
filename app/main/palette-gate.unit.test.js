// palette-gate.unit.test.js — T7 限源触发单元测试
const assert = require('assert');
const {
  isTerminalProcess,
  isEditableFocus,
  shouldShowPalette
} = require('./palette-gate.js');

function t(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    console.log('FAIL', name, e.message);
    process.exitCode = 1;
  }
}

t('terminal process blocked', () => {
  assert.equal(isTerminalProcess('WindowsTerminal'), true);
  assert.equal(isTerminalProcess('powershell.exe'), true);
  assert.equal(isTerminalProcess('notepad'), false);
});

t('edit control allowed', () => {
  assert.equal(isEditableFocus({ focusClass: 'Edit', fgClass: 'Notepad', hasFocus: true }), true);
  assert.equal(isEditableFocus({ focusClass: 'RichEditD2DPT', fgClass: 'X', hasFocus: true }), true);
  assert.equal(isEditableFocus({ focusClass: 'Scintilla', fgClass: 'X', hasFocus: true }), true);
});

t('desktop / explorer / menu denied', () => {
  assert.equal(isEditableFocus({ focusClass: 'Progman', fgClass: 'Progman', hasFocus: true }), false);
  assert.equal(isEditableFocus({ focusClass: 'WorkerW', fgClass: 'WorkerW', hasFocus: true }), false);
  assert.equal(isEditableFocus({ focusClass: '#32768', fgClass: 'CabinetWClass', hasFocus: true }), false);
});

t('readonly browser chrome denied', () => {
  assert.equal(
    isEditableFocus({ focusClass: 'Chrome_WidgetWin_1', fgClass: 'Chrome_WidgetWin_1', hasFocus: true }),
    false
  );
});

t('null / empty denied', () => {
  assert.equal(isEditableFocus(null), false);
  assert.equal(isEditableFocus({}), false);
});

t('shouldShowPalette combos', () => {
  const base = {
    processName: 'notepad',
    focus: { focusClass: 'Edit', fgClass: 'Notepad', hasFocus: true },
    enabled: true,
    recording: false,
    userCopyAt: 0,
    now: 10000
  };
  assert.equal(shouldShowPalette(base).ok, true);
  assert.equal(shouldShowPalette({ ...base, processName: 'cmd' }).ok, false);
  assert.equal(shouldShowPalette({ ...base, focus: { focusClass: 'Progman' } }).ok, false);
  assert.equal(shouldShowPalette({ ...base, userCopyAt: 9800 }).ok, false);
  assert.equal(shouldShowPalette({ ...base, enabled: false }).ok, false);
});

console.log(process.exitCode ? 'T7 UNIT FAIL' : 'T7 UNIT ALL PASS');
