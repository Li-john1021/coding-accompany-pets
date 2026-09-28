// palette-gate.unit.test.js — T7 限源触发单元测试
const assert = require('assert');
const {
  isTerminalProcess,
  isEditableFocus,
  isEditableClassName,
  shouldShowPalette
} = require('./palette-gate.js');

let fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    fail++;
    console.log('FAIL', name, e.message);
  }
}

t('terminal process blocked (case / .exe)', () => {
  assert.equal(isTerminalProcess('WindowsTerminal'), true);
  assert.equal(isTerminalProcess('powershell.exe'), true);
  assert.equal(isTerminalProcess('cmd'), true);
  assert.equal(isTerminalProcess('notepad'), false);
  assert.equal(isTerminalProcess('Code'), false); // VS Code 不是终端
  assert.equal(isTerminalProcess('cursor'), false);
});

t('edit / richedit / scintilla / winforms allowed', () => {
  assert.equal(isEditableFocus({ focusClass: 'Edit', readOnly: false }), true);
  assert.equal(isEditableFocus({ focusClass: 'RichEditD2DPT', readOnly: false }), true);
  assert.equal(isEditableFocus({ focusClass: 'Scintilla', readOnly: false }), true);
  assert.equal(
    isEditableFocus({ focusClass: 'WindowsForms10.EDIT.app.0.141b42a_r8_ad1', readOnly: false }),
    true
  );
});

t('readonly edit blocked', () => {
  assert.equal(isEditableFocus({ focusClass: 'Edit', readOnly: true }), false);
  assert.equal(isEditableFocus({ focusClass: 'Scintilla', uiaReadOnly: true }), false);
});

t('desktop / explorer / menu denied', () => {
  assert.equal(isEditableFocus({ focusClass: 'Progman' }), false);
  assert.equal(isEditableFocus({ fgClass: 'WorkerW' }), false);
  assert.equal(isEditableFocus({ focusClass: '#32768', fgClass: 'CabinetWClass' }), false);
});

t('browser chrome without UIA type denied', () => {
  assert.equal(isEditableFocus({ focusClass: 'Chrome_WidgetWin_1', hasFocus: true }), false);
});

t('UIA edit type allowed / Document not sufficient / readonly denied', () => {
  assert.equal(isEditableFocus({ uiaType: 50004, uiaReadOnly: false, focusClass: 'x' }), true);
  assert.equal(isEditableFocus({ uiaType: 50030, uiaReadOnly: false }), false); // Document 过宽
  assert.equal(isEditableFocus({ uiaType: 50027 }), false); // Text 过宽
  assert.equal(isEditableFocus({ uiaType: 50004, uiaReadOnly: true }), false);
  assert.equal(isEditableFocus({ uiaType: 50004, readOnly: true }), false);
  assert.equal(isEditableFocus({ focusClass: 'TEdit', readOnly: false }), true);
});

t('null / empty denied', () => {
  assert.equal(isEditableFocus(null), false);
  assert.equal(isEditableFocus({}), false);
  assert.equal(isEditableClassName(''), false);
  assert.equal(isEditableClassName('Editor'), false); // 无词边界 Editor 不中
});

t('shouldShowPalette combos', () => {
  const base = {
    processName: 'notepad',
    focus: { focusClass: 'Edit', readOnly: false },
    enabled: true,
    recording: false,
    userCopyAt: 0,
    now: 10000
  };
  assert.equal(shouldShowPalette(base).ok, true);
  assert.equal(shouldShowPalette({ ...base, processName: 'cmd' }).ok, false);
  assert.equal(shouldShowPalette({ ...base, focus: { focusClass: 'Progman' } }).ok, false);
  assert.equal(shouldShowPalette({ ...base, userCopyAt: 9800 }).reason, 'user-copy');
  assert.equal(shouldShowPalette({ ...base, enabled: false }).ok, false);
  assert.equal(shouldShowPalette({ ...base, recording: true }).reason, 'recording');
  assert.equal(shouldShowPalette({ ...base, enabled: undefined }).ok, true); // undefined=开
  assert.equal(shouldShowPalette({ ...base, focus: { focusClass: 'Edit', readOnly: true } }).ok, false);
  assert.equal(shouldShowPalette({ ...base, processName: '' }).ok, true); // proc 失败时仍看焦点
});

if (fail) {
  console.log('T7 UNIT FAIL', fail);
  process.exitCode = 1;
} else {
  console.log('T7 UNIT ALL PASS');
}
