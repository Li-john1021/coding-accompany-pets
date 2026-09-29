// palette-probe.unit.test.js — parser and passive probe invariants
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildProbeScript, parseProbeOutput } = require('./palette-probe.js');
const { NATIVE_EDIT_HELPER } = require('./win32-edit.js');

let fail = 0;
function t(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (e) { fail++; console.log('FAIL', name, e.message); }
}

t('parses only positive non-empty confirmed evidence', () => {
  assert.equal(parseProbeOutput('{"ok":true,"controlId":"1|2|3","nativeHandle":2,"processId":1,"provider":"uia-textpattern","text":"identical selection text","processName":"notepad"}'), null,
    'duplicate-text UIA selections without stable range identity are denied');
  for (const output of ['', 'not json', '{"ok":false}', '{"ok":true,"controlId":"","text":"x"}',
    '{"ok":true,"controlId":"1","text":""}',
    '{"ok":true,"controlId":"1|2|native-edit","nativeHandle":3,"processId":1,"provider":"win32-edit","text":"x","processName":"fixture"}',
    '{"ok":true,"controlId":"1|2|3","provider":"unknown","text":"x","processName":"fixture"}']) assert.equal(parseProbeOutput(output), null);
  const native = parseProbeOutput('{"ok":true,"controlId":"1|2|win32-edit","nativeHandle":2,"processId":1,"nativeThreadId":3,"nativeParentHandle":4,"nativeControlId":5,"selectionStart":6,"selectionEnd":12,"provider":"win32-edit","text":"native","processName":"fixture"}');
  assert.equal(native.provider, 'win32-edit');
  assert.equal(native.selectionStart, 6);
  assert.equal(parseProbeOutput('{"ok":true,"controlId":"1|2|win32-edit","nativeHandle":2,"processId":1,"nativeThreadId":3,"nativeParentHandle":4,"nativeControlId":5,"selectionStart":6,"selectionEnd":12,"provider":"win32-edit","text":"different length","processName":"fixture"}'), null,
    'native evidence selection bounds must agree with selected text length');
});

t('probe accepts native evidence and fails closed for UIA ranges without identity', () => {
  const script = buildProbeScript({ x: 10, y: 20 }, { x: 30, y: 40 });
  assert.ok(script.includes('AutomationElement]::FromPoint'));
  assert.ok(!script.includes('TextPattern]::Pattern'));
  assert.ok(!script.includes('ValuePattern]::Pattern'));
  assert.ok(!script.includes('.GetText('));
  assert.ok(script.includes('unsupported-provider: UIA selection range identity is unavailable'));
  assert.ok(script.includes('[V2PNativeEdit]::WindowFromPoint'));
  assert.ok(script.includes('[V2PNativeEdit]::ReadSelection'));
  assert.ok(script.includes('SendMessageTimeoutW'));
  assert.ok(script.includes('unsupported-provider: observed WPF TextPatternRange.GetText crash'));
  assert.ok(script.includes('$nativeA.controlId -ne $nativeB.controlId'));
  assert.ok(script.includes('$nativeA.text -cne $nativeB.text'));
  assert.ok(script.includes('$nativeA.selectionStart -ne $nativeB.selectionStart'));
  assert.ok(script.includes('$nativeA.selectionEnd -ne $nativeB.selectionEnd'));
  assert.ok(!/SendInput|keyTap|clipboard|FocusedElement|SetFocus|Select\(/i.test(script));
  const actionScript = buildProbeScript({ x: 10, y: 20 }, { x: 30, y: 40 }, { requireFocusedTarget: true });
  assert.ok(actionScript.includes('IsFocusedTarget([IntPtr]$a.nativeHandle'));
  assert.ok(actionScript.includes('nativeThreadId') && actionScript.includes('nativeParentHandle') && actionScript.includes('nativeControlId'));
  assert.ok(actionScript.includes('IsFocusedTarget([IntPtr]$a.nativeHandle, [uint32]$a.processId, [uint32]$a.nativeThreadId'));
  assert.throws(() => buildProbeScript({ x: NaN, y: 0 }, { x: 1, y: 1 }));
});

t('native Edit reads are bounded and deny readonly/invalid selections', () => {
  assert.ok(NATIVE_EDIT_HELPER.includes('EntryPoint="SendMessageTimeoutW"'));
  assert.ok(NATIVE_EDIT_HELPER.includes('0x000E') && NATIVE_EDIT_HELPER.includes('0x000D') && NATIVE_EDIT_HELPER.includes('0x00B0'));
  assert.ok(NATIVE_EDIT_HELPER.includes('length > 100000'));
  assert.ok(NATIVE_EDIT_HELPER.includes('end <= start') && NATIVE_EDIT_HELPER.includes('end > text.Length'));
  assert.ok(NATIVE_EDIT_HELPER.includes('(Style(hwnd) & 0x0800) != 0'));
  assert.ok(NATIVE_EDIT_HELPER.includes('IsWindow(hwnd)'));
  assert.ok(NATIVE_EDIT_HELPER.includes('ProcessId(hwnd) != expectedPid'));
  assert.ok(NATIVE_EDIT_HELPER.includes('GetParent(hwnd) != expectedParent'));
  assert.ok(NATIVE_EDIT_HELPER.includes('ThreadId(hwnd) != expectedThreadId'));
  assert.ok(NATIVE_EDIT_HELPER.includes('info.hwndFocus == hwnd'));
  assert.ok(NATIVE_EDIT_HELPER.includes('selection.Start = start') && NATIVE_EDIT_HELPER.includes('selection.End = end'));
});

t('production probe has bounded timeout and errors fail closed', () => {
  const source = fs.readFileSync(path.join(__dirname, 'palette-probe.js'), 'utf8');
  assert.ok(source.includes('timeout: PROBE_TIMEOUT_MS'));
  assert.ok(source.includes('resolve(err ? null : parseProbeOutput(stdout))'));
});

if (fail) { console.log('PALETTE PROBE FAIL', fail); process.exitCode = 1; }
else console.log('PALETTE PROBE ALL PASS');
