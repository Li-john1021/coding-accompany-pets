// palette-probe.runtime.test.js — Windows runtime checks using an isolated WinForms fixture.
const assert = require('assert');
const { execFileSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildProbeScript, probeSelection } = require('./palette-probe');
const { shouldShowPalette, meetsMinimumCharacters } = require('./palette-gate');

if (process.platform !== 'win32') {
  console.log('SKIP Windows runtime checks');
  process.exit(0);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-palette-uia-'));
const fixtureSource = path.join(__dirname, 'fixtures', 'palette-probe-runtime-window.cs');
const fixtureExe = path.join(tempDir, 'PaletteUiaFixture.exe');
const readyFile = path.join(tempDir, 'ready.json');
const stopFile = path.join(tempDir, 'stop');
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const failures = [];
let fixture;

function parsePowerShell(script) {
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
  const command = `$source = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedScript}')); ` +
    '$tokens = $null; $errors = $null; ' +
    '[System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors) | Out-Null; ' +
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }';
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
}

function checkPointRuntimeDependency() {
  const script = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
  $point = New-Object System.Windows.Point(0, 0)
  $hit = [System.Windows.Automation.AutomationElement]::FromPoint($point)
  if ($null -eq $hit) { throw 'FromPoint returned no element' }
  [Console]::Out.WriteLine('PASS_PROBE_POINT_RUNTIME')
} catch {
  [Console]::Out.WriteLine('FAIL_PROBE_POINT_RUNTIME')
  exit 3
}
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  const output = String(result.stdout || '');
  if (result.status !== 0 || !output.includes('PASS_PROBE_POINT_RUNTIME')) {
    failures.push('System.Windows.Point construction fails with the production probe assembly loads');
    console.error('FAIL production UIA Point runtime (PowerShell exit ' + result.status + ')');
    return false;
  }
  console.log('PASS production UIA Point runtime');
  return true;
}

async function waitForReady() {
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(readyFile)) return JSON.parse(fs.readFileSync(readyFile, 'utf8'));
    if (fixture && fixture.exitCode !== null) throw new Error(`fixture exited early (${fixture.exitCode})`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('fixture did not create ready record within 10 seconds');
}

function focusFixtureEdit(pid) {
  const script = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${pid})
$elements = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
$edit = $null
foreach ($candidate in $elements) {
  if ($candidate.Current.ControlType.Id -eq 50004) { $edit = $candidate; break }
}
if ($null -eq $edit) { [Console]::Out.WriteLine('NO_FIXTURE_EDIT'); exit 0 }
$edit.SetFocus()
[Console]::Out.WriteLine('FIXTURE_EDIT_FOCUSED')
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  return output.includes('FIXTURE_EDIT_FOCUSED');
}

function foregroundWindow() {
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class V2PForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
[Console]::Out.WriteLine([V2PForeground]::GetForegroundWindow().ToInt64())
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  return Number(output.trim().split(/\r?\n/).pop());
}

function restoreForegroundWindow(hwnd) {
  if (!hwnd) return true;
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class V2PRestoreForeground {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
}
"@
if ([V2PRestoreForeground]::SetForegroundWindow([IntPtr]([long]${hwnd}))) { 'RESTORED' } else { 'RESTORE_FAILED' }
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  return output.includes('RESTORED');
}

function runtimeSnapshot() {
  const script = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase -ErrorAction Stop
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class V2PSnapshot {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$focus = [System.Windows.Automation.AutomationElement]::FocusedElement
$id = ''
$text = ''
if ($null -ne $focus) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  for ($i = 0; $i -lt 12 -and $null -ne $focus; $i++) {
    if ($focus.Current.ControlType.Id -eq 50004) { break }
    $focus = $walker.GetParent($focus)
  }
  if ($null -ne $focus -and $focus.Current.ControlType.Id -eq 50004) {
    $runtimeId = (@($focus.GetRuntimeId()) | ForEach-Object { [string]$_ }) -join '.'
    $id = ([string]$focus.Current.ProcessId + '|' + [string]$focus.Current.NativeWindowHandle + '|' + $runtimeId)
    $pattern = $focus.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
    if ($null -ne $pattern) {
      $ranges = @($pattern.GetSelection())
      $parts = @()
      foreach ($range in $ranges) { $parts += $range.GetText(100000) }
      $text = [string]::Join('', $parts)
    }
  }
}
$clipboard = [Windows.Forms.Clipboard]::GetText()
$clipboardHash = [Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($clipboard)))
@{ foreground = [V2PSnapshot]::GetForegroundWindow().ToInt64(); focusId = $id; selection = $text; clipboardHash = $clipboardHash } | ConvertTo-Json -Compress
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  }).trim().split(/\r?\n/).pop());
}

async function run() {
  parsePowerShell(buildProbeScript({ x: 20, y: 20 }, { x: 40, y: 40 }, { requireFocusedTarget: true }));
  console.log('PASS generated UIA probe PowerShell parses');
  checkPointRuntimeDependency();
  run.originalForeground = foregroundWindow();

  execFileSync(csc, ['/nologo', '/target:winexe', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', `/out:${fixtureExe}`, fixtureSource], {
    encoding: 'utf8', timeout: 20000, windowsHide: true
  });
  fixture = spawn(fixtureExe, [readyFile, stopFile], { windowsHide: false, stdio: 'ignore' });
  const points = await waitForReady();
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (!focusFixtureEdit(points.pid)) {
    console.log('BLOCKED live UIA scenarios: tool session UIA desktop tree cannot focus the isolated fixture Edit');
    return;
  }

  const before = runtimeSnapshot();
  assert.ok(before.focusId.startsWith(`${points.pid}|`), 'fixture editable control owns keyboard focus');
  assert.ok(before.selection.length > 0, 'fixture exposes a non-empty TextPattern selection');
  const eligible = await probeSelection(points.a1, points.a2, { requireFocusedTarget: true });
  assert.ok(eligible, 'production probe confirms selection in the same native Edit');
  assert.equal(eligible.processName, 'PaletteUiaFixture');
  assert.equal(eligible.text, before.selection);
  assert.equal(shouldShowPalette({ selection: eligible, enabled: true, now: Date.now() }).ok, true);
  assert.equal(meetsMinimumCharacters(eligible, 20), true);
  assert.equal(meetsMinimumCharacters(eligible, eligible.text.trim().length + 1), false);
  assert.deepEqual(runtimeSnapshot(), before, 'probe preserves foreground, focused control, selection, and clipboard hash');

  assert.equal(await probeSelection(points.a1, points.b, { requireFocusedTarget: true }), null, 'cross-control drag denies');
  assert.equal(await probeSelection(points.readonly, points.readonly, { requireFocusedTarget: true }), null, 'read-only Edit denies');
  assert.equal(await probeSelection(points.object, points.object, { requireFocusedTarget: true }), null, 'object hit denies');
  assert.equal(await probeSelection(points.window, points.window, { requireFocusedTarget: true }), null, 'window background denies');
}

run().catch((error) => {
  console.error('FAIL live Windows UIA fixture:', error && error.stack || error);
  failures.push('fixture scenario failed before completion');
}).finally(async () => {
  try { fs.writeFileSync(stopFile, 'stop'); } catch {}
  if (fixture && fixture.exitCode === null) {
    await Promise.race([new Promise((resolve) => fixture.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 1000))]);
    if (fixture.exitCode === null) fixture.kill();
  }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  try {
    if (!restoreForegroundWindow(run.originalForeground)) console.log('FOREGROUND_RESTORE_BLOCKED');
  } catch { console.log('FOREGROUND_RESTORE_BLOCKED'); }
  if (failures.length) process.exitCode = 1;
});
