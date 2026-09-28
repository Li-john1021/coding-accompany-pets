// palette-paste-guard.unit.test.js — validates the final native paste guard.
const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { buildPasteTargetGuard, REQUIRE_TARGET, RESTORE_SHIFT_IF_TARGET } = require('./palette-paste-guard');

const sample = { controlId: '123|456|7.8.9', text: 'selected text 漢字' };
const script = buildPasteTargetGuard(sample);
assert.ok(script.includes('$foregroundPid -eq 123'));
assert.ok(script.includes("$focusedId -eq '123|456|7.8.9'"));
assert.ok(script.includes('$selectedText -ceq $expectedText'));
assert.ok(script.includes(Buffer.from(sample.text, 'utf8').toString('base64')));
assert.ok(script.indexOf('Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes') <
  script.indexOf('function Test-V2PPasteTargetIdentity'), 'UIA types are loaded before guard definition');
const identityStart = script.indexOf('function Test-V2PPasteTargetIdentity');
const strictStart = script.indexOf('function Test-V2PPasteTarget {');
const identityBody = script.slice(identityStart, strictStart);
assert.ok(!identityBody.includes('GetSelection') && !identityBody.includes('$expectedText'),
  'post-paste identity predicate does not depend on consumed selection text');
const strictBody = script.slice(strictStart);
assert.ok(strictBody.includes('Test-V2PPasteTargetIdentity') && strictBody.includes('GetSelection') &&
  strictBody.includes('$selectedText -ceq $expectedText'), 'pre-paste predicate remains selection-strict');
assert.ok(!script.includes(sample.text), 'selection is base64 encoded before script construction');
assert.equal(buildPasteTargetGuard({ controlId: 'bad', text: 'text' }), null);
assert.equal(buildPasteTargetGuard({ controlId: '1|2|3', text: ' ' }), null);
assert.ok(REQUIRE_TARGET.includes('exit 20'));
assert.ok(RESTORE_SHIFT_IF_TARGET.includes('if (Test-V2PPasteTargetIdentity)'));

const insert = fs.readFileSync(path.join(__dirname, 'insert.js'), 'utf8');
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
const fullScript = body.replace('${targetGuard}', script)
  .replaceAll('${requireTarget}', REQUIRE_TARGET)
  .replace('${restoreShift}', RESTORE_SHIFT_IF_TARGET);

if (process.platform === 'win32') {
  const encoded = Buffer.from(fullScript, 'utf8').toString('base64');
  const parse = `$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')); ` +
    '$tokens = $null; $errors = $null; ' +
    '[System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null; ' +
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }';
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parse], { stdio: 'inherit' });
  console.log('PASS generated PowerShell guard parses');

  const runtimeSmoke = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
if ($null -eq ('System.Windows.Automation.AutomationElement' -as [type])) { throw 'UIA type missing' }
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class V2PPaste {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
${buildPasteTargetGuard({ controlId: '4294967295|0|1.2.3', text: 'runtime-smoke-selection' })}
if (Test-V2PPasteTargetIdentity) { throw 'identity guard unexpectedly accepted impossible process id' }
if (Test-V2PPasteTarget) { throw 'strict guard unexpectedly accepted impossible process id' }
Write-Output 'PASS_RUNTIME_UIA_TYPES'
Write-Output 'PASS_RUNTIME_GUARD_FAIL_CLOSED'
`;
  const runtimeEncoded = Buffer.from(runtimeSmoke, 'utf16le').toString('base64');
  const runtimeOutput = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', runtimeEncoded],
    { encoding: 'utf8', stdio: 'pipe' });
  assert.ok(runtimeOutput.includes('PASS_RUNTIME_UIA_TYPES'));
  assert.ok(runtimeOutput.includes('PASS_RUNTIME_GUARD_FAIL_CLOSED'));
  console.log('PASS new PowerShell process resolves UIA types and executes guard');
} else {
  console.log('SKIP PowerShell parser/runtime smoke (non-Windows host)');
}

console.log('PASS palette paste guard construction');
