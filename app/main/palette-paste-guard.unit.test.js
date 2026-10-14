// palette-paste-guard.unit.test.js — validates the final native paste guard.
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  buildPasteTargetGuard,
  REQUIRE_NATIVE_TARGET,
  RESTORE_SHIFT_IF_NATIVE_TARGET
} = require('./palette-paste-guard');

const sample = { provider: 'uia-textpattern', controlId: '123|456|7.8.9', text: 'identical selection text' };
assert.equal(buildPasteTargetGuard(sample), null, 'UIA-only text identity has no guarded write-back path');
assert.equal(buildPasteTargetGuard({ controlId: 'bad', text: 'text' }), null);
assert.equal(buildPasteTargetGuard({ controlId: '1|2|3', text: ' ' }), null);
const nativeSample = {
  provider: 'win32-edit', controlId: '123|456|win32-edit', nativeHandle: 456, processId: 123,
  nativeThreadId: 789, nativeParentHandle: 321, nativeControlId: 9, selectionStart: 5, selectionEnd: 21,
  text: 'selected text 漢字'
};
const nativeScript = buildPasteTargetGuard(nativeSample);
assert.ok(nativeScript.includes('function Test-V2PNativePasteTargetIdentity'));
assert.ok(nativeScript.includes('function Test-V2PNativePasteTarget'));
assert.ok(nativeScript.includes('[V2PNativeEdit]::ReadSelection'));
assert.ok(nativeScript.includes('[V2PNativeEdit]::IsFocusedTarget([IntPtr]456, [uint32]123, [uint32]789, [IntPtr]321, [int]9)'));
assert.ok(nativeScript.includes('$selection.Start -eq 5 -and $selection.End -eq 21'),
  'strict native paste guard binds selected UTF-16 offsets as well as text');
assert.ok(REQUIRE_NATIVE_TARGET.includes('Test-V2PNativePasteTarget') && REQUIRE_NATIVE_TARGET.includes('exit 20'));
assert.ok(RESTORE_SHIFT_IF_NATIVE_TARGET.includes('if (Test-V2PNativePasteTargetIdentity)'));
assert.ok(!RESTORE_SHIFT_IF_NATIVE_TARGET.includes('Test-V2PNativePasteTarget)'));
assert.equal(buildPasteTargetGuard({ ...nativeSample, nativeHandle: 457 }), null, 'native identity fields must agree');
assert.equal(buildPasteTargetGuard({ ...nativeSample, selectionStart: 6 }), null, 'native range length must match selected text');
assert.ok(!nativeScript.includes(nativeSample.text) &&
  !nativeScript.includes(Buffer.from(nativeSample.text, 'utf8').toString('base64')),
  'selection data is passed over stdin and absent from temporary scripts');
assert.ok(nativeScript.includes('[Console]::In.ReadLine()'), 'native guard reads selection identity from stdin');

const insert = fs.readFileSync(path.join(__dirname, 'insert.js'), 'utf8');
assert.ok(insert.indexOf('buildPasteTargetGuard(options.target)') < insert.indexOf('clipboard.writeText(text)'),
  'unsupported target providers cancel before transient clipboard mutation');
const bodyStart = insert.indexOf('const script = `');
const bodyEnd = insert.indexOf('\n`;', bodyStart);
assert.ok(bodyStart >= 0 && bodyEnd > bodyStart, 'paste script template exists');
const templateStart = bodyStart + 'const script = `'.length;
const body = insert.slice(templateStart, bodyEnd);
const checks = [...body.matchAll(/\$\{requireTarget\}/g)].map((m) => m.index);
const imeQuery = body.indexOf('$ime = [V2PPaste]::ImeOpen()');
const shift = body.indexOf('[V2PPaste]::TapShift()');
const paste = body.indexOf('[V2PPaste]::Paste()');
const restore = body.indexOf('${restoreShift}');
assert.equal(checks.length, 3, 'guard runs after initial delay, before IME Shift, and before paste');
assert.ok(checks[0] < imeQuery && imeQuery < checks[1] && checks[1] < shift && shift < checks[2] &&
  checks[2] < paste && paste < restore, 'all synthetic key sends are ordered after target checks');
const fullScript = body.replace('${targetGuard}', nativeScript)
  .replaceAll('${requireTarget}', REQUIRE_NATIVE_TARGET)
  .replace('${restoreShift}', RESTORE_SHIFT_IF_NATIVE_TARGET);

if (process.platform === 'win32') {
  const encoded = Buffer.from(fullScript, 'utf8').toString('base64');
  const parse = `$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); ` +
    '$tokens = $null; $errors = $null; ' +
    '[System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null; ' +
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }';
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parse], { stdio: 'inherit' });
  console.log('PASS generated PowerShell guard parses');

  const runtimeSmoke = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class V2PPaste {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
${buildPasteTargetGuard({ provider: 'win32-edit', controlId: '4294967295|1|win32-edit', nativeHandle: 1, processId: 4294967295,
  nativeThreadId: 1, nativeParentHandle: 2, nativeControlId: 3, selectionStart: 0, selectionEnd: 23, text: 'runtime-smoke-selection' })}
if (Test-V2PNativePasteTargetIdentity) { throw 'identity guard unexpectedly accepted impossible process id' }
if (Test-V2PNativePasteTarget) { throw 'strict guard unexpectedly accepted impossible process id' }
Write-Output 'PASS_RUNTIME_NATIVE_TYPES'
Write-Output 'PASS_RUNTIME_GUARD_FAIL_CLOSED'
`;
  const runtimeEncoded = Buffer.from(runtimeSmoke, 'utf16le').toString('base64');
  const runtimeOutput = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', runtimeEncoded],
    { encoding: 'utf8', stdio: 'pipe', input: Buffer.from(Buffer.from(sample.text, 'utf8').toString('base64') + '\n', 'utf8') });
  assert.ok(runtimeOutput.includes('PASS_RUNTIME_NATIVE_TYPES'));
  assert.ok(runtimeOutput.includes('PASS_RUNTIME_GUARD_FAIL_CLOSED'));
  console.log('PASS new PowerShell process resolves UIA types and executes guard');

  const nativeRuntime = `
${nativeScript}
if (Test-V2PNativePasteTargetIdentity) { throw 'native identity guard unexpectedly accepted invalid target' }
if (Test-V2PNativePasteTarget) { throw 'native selection guard unexpectedly accepted invalid target' }
Write-Output 'PASS_RUNTIME_NATIVE_GUARD_FAIL_CLOSED'
`;
  const nativeEncoded = Buffer.from(nativeRuntime, 'utf16le').toString('base64');
  const nativeRuntimeOutput = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', nativeEncoded],
    { encoding: 'utf8', stdio: 'pipe', input: Buffer.from(Buffer.from(nativeSample.text, 'utf8').toString('base64') + '\n', 'utf8') });
  assert.ok(nativeRuntimeOutput.includes('PASS_RUNTIME_NATIVE_GUARD_FAIL_CLOSED'));
  console.log('PASS native paste target guard runtime smoke');
} else {
  console.log('SKIP PowerShell parser/runtime smoke (non-Windows host)');
}

console.log('PASS palette paste guard construction');
