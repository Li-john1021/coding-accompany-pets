// palette-probe.runtime.test.js — Windows runtime checks using an isolated WPF fixture.
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
const gacRoot = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'assembly');
const failures = [];
let fixture;

function gacAssembly(bucket, name) {
  const assemblyDir = path.join(gacRoot, bucket, name);
  const versionDir = fs.readdirSync(assemblyDir).find((entry) => fs.existsSync(path.join(assemblyDir, entry, `${name}.dll`)));
  if (!versionDir) throw new Error(`Missing .NET Framework assembly ${name}`);
  return path.join(assemblyDir, versionDir, `${name}.dll`);
}

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
  const probeScript = buildProbeScript({ x: 20, y: 20 }, { x: 40, y: 40 });
  const assemblyLoad = probeScript.match(/^Add-Type -AssemblyName [^\r\n]+/m);
  const pointCall = probeScript.match(/^\s*\$hit = .*AutomationElement\]::FromPoint\(.*System\.Windows\.Point\(\$x, \$y\).*$/m);
  if (!assemblyLoad || !pointCall) {
    failures.push('could not locate runtime assembly load and point call in generated production probe');
    console.error('FAIL production UIA Point runtime setup');
    return false;
  }
  const runtimePointCall = pointCall[0].replace(/\$x\b/g, '20').replace(/\$y\b/g, '20');
  const script = `
$ErrorActionPreference = 'Stop'
try {
  ${assemblyLoad[0]}
  ${runtimePointCall}
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

function inspectAndFocusFixture(pid, hwnd) {
  const script = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class V2PWindowDiagnostic {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetThreadDesktop(uint threadId);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll")] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool GetUserObjectInformation(IntPtr handle, int index, IntPtr info, uint length, out uint needed);
  public static string DesktopName(IntPtr handle) {
    if (handle == IntPtr.Zero) return "";
    uint needed;
    GetUserObjectInformation(handle, 2, IntPtr.Zero, 0, out needed);
    if (needed == 0) return "";
    IntPtr buffer = Marshal.AllocHGlobal((int)needed);
    try {
      if (!GetUserObjectInformation(handle, 2, buffer, needed, out needed)) return "";
      return Marshal.PtrToStringUni(buffer) ?? "";
    } finally { Marshal.FreeHGlobal(buffer); }
  }
}
"@
$windowHandle = [IntPtr]([long]${hwnd})
$ownerPid = [uint32]0
$windowThread = [V2PWindowDiagnostic]::GetWindowThreadProcessId($windowHandle, [ref]$ownerPid)
$process = [Diagnostics.Process]::GetProcessById(${pid})
$currentSession = [Diagnostics.Process]::GetCurrentProcess().SessionId
$windowDesktop = [V2PWindowDiagnostic]::DesktopName([V2PWindowDiagnostic]::GetThreadDesktop($windowThread))
$currentDesktop = [V2PWindowDiagnostic]::DesktopName([V2PWindowDiagnostic]::GetThreadDesktop([V2PWindowDiagnostic]::GetCurrentThreadId()))
$inputDesktopHandle = [V2PWindowDiagnostic]::OpenInputDesktop(0, $false, 1)
$inputDesktop = [V2PWindowDiagnostic]::DesktopName($inputDesktopHandle)
if ($inputDesktopHandle -ne [IntPtr]::Zero) { [void][V2PWindowDiagnostic]::CloseDesktop($inputDesktopHandle) }
$condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${pid})
$elements = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
$edit = $null
foreach ($candidate in $elements) {
  if ($candidate.Current.ControlType.Id -eq 50004) { $edit = $candidate; break }
}
if ($null -ne $edit) { $edit.SetFocus() }
$uiaTypes = @($elements | ForEach-Object { $_.Current.ControlType.Id } | Sort-Object -Unique)
$uiaClasses = @($elements | ForEach-Object { $_.Current.ClassName } | Sort-Object -Unique)
@{
  fixturePid = ${pid};
  windowHandle = $windowHandle.ToInt64();
  windowOwnerPid = $ownerPid;
  visible = [V2PWindowDiagnostic]::IsWindowVisible($windowHandle);
  fixtureSession = $process.SessionId;
  currentSession = $currentSession;
  sessionMatches = ($process.SessionId -eq $currentSession);
  windowDesktop = $windowDesktop;
  currentDesktop = $currentDesktop;
  inputDesktop = $inputDesktop;
  windowDesktopMatchesCurrent = ($windowDesktop -and $windowDesktop -eq $currentDesktop);
  windowDesktopMatchesInput = ($windowDesktop -and $windowDesktop -eq $inputDesktop);
  uiaElementsForPid = $elements.Count;
  uiaEditsForPid = @($elements | Where-Object { $_.Current.ControlType.Id -eq 50004 }).Count;
  uiaControlTypes = $uiaTypes;
  uiaClassNames = $uiaClasses;
  focusedEdit = ($null -ne $edit)
} | ConvertTo-Json -Compress | Write-Output
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  return JSON.parse(output.trim().split(/\r?\n/).pop());
}

function focusAt(point) {
  const script = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase -ErrorAction Stop
$element = [System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point(${point.x}, ${point.y})))
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
for ($i = 0; $i -lt 12 -and $null -ne $element; $i++) {
  if ($element.Current.ControlType.Id -eq 50004) { break }
  $element = $walker.GetParent($element)
}
if ($null -eq $element -or $element.Current.ControlType.Id -ne 50004) { throw 'fixture Edit not found at test point' }
$element.SetFocus()
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
}

function readFocusedTextPattern() {
  const script = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
$element = [System.Windows.Automation.AutomationElement]::FocusedElement
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
for ($i = 0; $i -lt 12 -and $null -ne $element; $i++) {
  if ($element.Current.ControlType.Id -eq 50004) { break }
  $element = $walker.GetParent($element)
}
if ($null -eq $element -or $element.Current.ControlType.Id -ne 50004) { exit 5 }
$pattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
$ranges = @($pattern.GetSelection())
if ($ranges.Length -eq 0) { exit 6 }
$selectedText = [string]$ranges[0].GetText(100000)
[Console]::Out.WriteLine('TEXT_PATTERN_READ_OK:' + $selectedText.Length)
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
}

function focusedValueReadOnly() {
  const script = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
$element = [System.Windows.Automation.AutomationElement]::FocusedElement
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
for ($i = 0; $i -lt 12 -and $null -ne $element; $i++) {
  if ($element.Current.ControlType.Id -eq 50004) { break }
  $element = $walker.GetParent($element)
}
if ($null -eq $element -or $element.Current.ControlType.Id -ne 50004) { exit 5 }
$pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
if ($null -eq $pattern) { exit 6 }
[Console]::Out.WriteLine('VALUE_READONLY:' + $pattern.Current.IsReadOnly.ToString())
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  const match = String(result.stdout || '').match(/VALUE_READONLY:(True|False)/);
  return result.status === 0 && match ? match[1].toLowerCase() === 'true' : null;
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
if ($null -ne $focus) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  for ($i = 0; $i -lt 12 -and $null -ne $focus; $i++) {
    if ($focus.Current.ControlType.Id -eq 50004) { break }
    $focus = $walker.GetParent($focus)
  }
  if ($null -ne $focus -and $focus.Current.ControlType.Id -eq 50004) {
    $runtimeId = (@($focus.GetRuntimeId()) | ForEach-Object { [string]$_ }) -join '.'
    $id = ([string]$focus.Current.ProcessId + '|' + [string]$focus.Current.NativeWindowHandle + '|' + $runtimeId)
  }
}
$clipboard = [Windows.Forms.Clipboard]::GetText()
$clipboardHash = [Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($clipboard)))
@{ foreground = [V2PSnapshot]::GetForegroundWindow().ToInt64(); focusId = $id; clipboardHash = $clipboardHash } | ConvertTo-Json -Compress
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

  const references = [
    gacAssembly('GAC_64', 'PresentationCore'),
    gacAssembly('GAC_MSIL', 'PresentationFramework'),
    gacAssembly('GAC_MSIL', 'WindowsBase'),
    gacAssembly('GAC_MSIL', 'System.Xaml')
  ];
  execFileSync(csc, ['/nologo', '/target:winexe', ...references.map((file) => `/r:${file}`), `/out:${fixtureExe}`, fixtureSource], {
    encoding: 'utf8', timeout: 20000, windowsHide: true
  });
  fixture = spawn(fixtureExe, [readyFile, stopFile], { windowsHide: false, stdio: 'ignore' });
  const points = await waitForReady();
  await new Promise((resolve) => setTimeout(resolve, 500));

  const fixtureState = inspectAndFocusFixture(points.pid, points.hwnd);
  console.log('FIXTURE_UIA_DIAGNOSTIC ' + JSON.stringify({
    ...fixtureState,
    readyVisible: points.visible,
    readySession: points.session
  }));
  if (!fixtureState.focusedEdit) {
    console.log('BLOCKED live UIA scenarios: UIA RootElement did not expose an Edit for the fixture PID');
    return;
  }

  const before = runtimeSnapshot();
  assert.ok(before.focusId.startsWith(`${points.pid}|`), 'fixture editable control owns keyboard focus');
  assert.equal(focusedValueReadOnly(), false, 'editable WPF TextBox exposes writable ValuePattern');
  const textPatternRead = readFocusedTextPattern();
  if (textPatternRead.status !== 0 || !String(textPatternRead.stdout || '').includes('TEXT_PATTERN_READ_OK:')) {
    console.error('FAIL WPF TextPattern.GetText runtime (PowerShell exit ' + textPatternRead.status + ', signal ' + textPatternRead.signal + ')');
    failures.push('WPF TextPatternRange.GetText did not return selected text in the Windows PowerShell child');
  }
  const eligible = await probeSelection(points.a1, points.a2, { requireFocusedTarget: true });
  if (!eligible) {
    console.error('FAIL positive WPF TextPattern selection probe returned no confirmed selection');
    failures.push('positive WPF TextPattern selection probe returned no confirmed selection');
  } else {
    assert.equal(eligible.processName, 'PaletteUiaFixture');
    assert.equal(shouldShowPalette({ selection: eligible, enabled: true, now: Date.now() }).ok, true);
    assert.equal(meetsMinimumCharacters(eligible, 20), true);
    assert.equal(meetsMinimumCharacters(eligible, eligible.text.trim().length + 1), false);
  }
  assert.deepEqual(runtimeSnapshot(), before, 'probe preserves foreground, focus identity, and clipboard hash');

  focusAt(points.readonly);
  assert.equal(focusedValueReadOnly(), true, 'read-only WPF TextBox reports IsReadOnly through ValuePattern');
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
