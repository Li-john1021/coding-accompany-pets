// palette-probe.runtime.test.js — Windows runtime checks using an isolated WPF fixture.
const assert = require('assert');
const { execFileSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildProbeScript, probeSelection } = require('./palette-probe');
const { buildNativeEditPowerShell } = require('./win32-edit');
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
const nativeFixtureSource = path.join(__dirname, 'fixtures', 'palette-probe-runtime-win32-edit.cs');
const nativeFixtureExe = path.join(tempDir, 'PaletteNativeEditFixture.exe');
const nativeReadyFile = path.join(tempDir, 'native-ready.json');
const nativeStopFile = path.join(tempDir, 'native-stop');
const nativeFocusRequestFile = path.join(tempDir, 'native-focus-request');
const nativeFocusAckFile = path.join(tempDir, 'native-focus-ack');
const nativeKeepFrontFile = path.join(tempDir, 'native-keep-front');
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const gacRoot = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'assembly');
const failures = [];
let fixture;
let currentStopFile = stopFile;
let testClipboardRestore = null;

function gacAssembly(bucket, name) {
  const assemblyDir = path.join(gacRoot, bucket, name);
  const versionDir = fs.readdirSync(assemblyDir).find((entry) => fs.existsSync(path.join(assemblyDir, entry, `${name}.dll`)));
  if (!versionDir) throw new Error(`Missing .NET Framework assembly ${name}`);
  return path.join(assemblyDir, versionDir, `${name}.dll`);
}

function parsePowerShell(script) {
  const sourcePath = path.join(tempDir, 'probe-parse-input.ps1');
  fs.writeFileSync(sourcePath, script, 'utf8');
  const command = '$tokens = $null; $errors = $null; ' +
    '[System.Management.Automation.Language.Parser]::ParseFile($args[0], [ref]$tokens, [ref]$errors) | Out-Null; ' +
    'if ($errors.Count -gt 0) { $errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }';
  const parserPath = path.join(tempDir, 'parse-generated-probe.ps1');
  fs.writeFileSync(parserPath, command, 'utf8');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', parserPath, sourcePath], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
}

function runGeneratedProbe(start, end, options = {}) {
  const scriptPath = path.join(tempDir, `generated-probe-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`);
  fs.writeFileSync(scriptPath, '\uFEFF' + buildProbeScript(start, end, options), 'utf16le');
  let result;
  try {
    result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', scriptPath], {
      encoding: 'utf8', timeout: 10000, windowsHide: true
    });
  } finally { try { fs.unlinkSync(scriptPath); } catch {} }
  return { status: result.status, signal: result.signal, stdout: String(result.stdout || ''), stderr: String(result.stderr || ''), error: result.error && result.error.message };
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

async function waitForReady(pathToPoll = readyFile) {
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(pathToPoll)) return JSON.parse(fs.readFileSync(pathToPoll, 'utf8'));
    if (fixture && fixture.exitCode !== null) throw new Error(`fixture exited early (${fixture.exitCode})`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('fixture did not create ready record within 10 seconds');
}

async function stopCurrentFixture() {
  if (!fixture) return;
  try { fs.writeFileSync(currentStopFile, 'stop'); } catch {}
  await Promise.race([
    new Promise((resolve) => fixture.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 1000))
  ]);
  if (fixture.exitCode === null) fixture.kill();
  fixture = null;
}

async function refocusNativeFixture(target = 'a') {
  try { fs.rmSync(nativeFocusAckFile, { force: true }); } catch {}
  fs.writeFileSync(nativeFocusRequestFile, target);
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(nativeFocusAckFile) && fs.readFileSync(nativeFocusAckFile, 'utf8') === target) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('native fixture did not acknowledge focus request');
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

function readNativeEditSelection(point, expectedPid) {
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class V2PNativeEditRead {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; public POINT(int x, int y) { X=x; Y=y; } }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public int cbSize; public int flags; public IntPtr hwndActive; public IntPtr hwndFocus; public IntPtr hwndCapture;
    public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret; public RECT rcCaret;
  }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint threadId, ref GUITHREADINFO info);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] public static extern int GetWindowLong32(IntPtr hwnd, int index);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLong64(IntPtr hwnd, int index);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  public static int Style(IntPtr hwnd) { return IntPtr.Size == 8 ? GetWindowLong64(hwnd, -16).ToInt32() : GetWindowLong32(hwnd, -16); }
  public static int ReadTextLength(IntPtr hwnd) {
    IntPtr result; if (SendMessageTimeout(hwnd, 0x000E, IntPtr.Zero, IntPtr.Zero, 0x0002, 500, out result) == IntPtr.Zero) throw new Exception("WM_GETTEXTLENGTH timeout");
    return result.ToInt32();
  }
  public static string ReadText(IntPtr hwnd, int length) {
    IntPtr buffer = Marshal.AllocHGlobal((length + 1) * 2);
    try {
      IntPtr result; if (SendMessageTimeout(hwnd, 0x000D, (IntPtr)(length + 1), buffer, 0x0002, 500, out result) == IntPtr.Zero) throw new Exception("WM_GETTEXT timeout");
      return Marshal.PtrToStringUni(buffer) ?? "";
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  public static int[] ReadSelection(IntPtr hwnd) {
    IntPtr start = Marshal.AllocHGlobal(4), end = Marshal.AllocHGlobal(4), packed;
    try {
      Marshal.WriteInt32(start, 0); Marshal.WriteInt32(end, 0);
      if (SendMessageTimeout(hwnd, 0x00B0, start, end, 0x0002, 500, out packed) == IntPtr.Zero) throw new Exception("EM_GETSEL timeout");
      uint value = unchecked((uint)packed.ToInt64());
      return new int[] { Marshal.ReadInt32(start), Marshal.ReadInt32(end), (int)(value & 0xFFFF), (int)((value >> 16) & 0xFFFF) };
    } finally { Marshal.FreeHGlobal(start); Marshal.FreeHGlobal(end); }
  }
}
"@
$hwnd = [V2PNativeEditRead]::WindowFromPoint([V2PNativeEditRead+POINT]::new(${point.x}, ${point.y}))
$className = New-Object Text.StringBuilder 256
[void][V2PNativeEditRead]::GetClassNameW($hwnd, $className, 256)
$owner = [uint32]0
$thread = [V2PNativeEditRead]::GetWindowThreadProcessId($hwnd, [ref]$owner)
$foreground = [V2PNativeEditRead]::GetForegroundWindow()
$foregroundPid = [uint32]0
$foregroundThread = [V2PNativeEditRead]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
$info = New-Object V2PNativeEditRead+GUITHREADINFO
$info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
[void][V2PNativeEditRead]::GetGUIThreadInfo($foregroundThread, [ref]$info)
$style = [V2PNativeEditRead]::Style($hwnd)
$length = [V2PNativeEditRead]::ReadTextLength($hwnd)
$text = [V2PNativeEditRead]::ReadText($hwnd, $length)
$selection = [V2PNativeEditRead]::ReadSelection($hwnd)
$selected = ''
if ($selection[0] -ge 0 -and $selection[1] -ge $selection[0] -and $selection[1] -le $text.Length) {
  $selected = $text.Substring($selection[0], $selection[1] - $selection[0])
}
$hash = [Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::Unicode.GetBytes($selected)))
@{ hwnd = $hwnd.ToInt64(); className = $className.ToString(); ownerPid = $owner; expectedPid = ${expectedPid}; foregroundPid = $foregroundPid; focusedHwnd = $info.hwndFocus.ToInt64(); style = $style; readOnly = (($style -band 0x800) -ne 0); textLength = $length; selectionStart = $selection[0]; selectionEnd = $selection[1]; packedLow = $selection[2]; packedHigh = $selection[3]; selectedLength = $selected.Length; selectedHash = $hash; selectedUtf8 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($selected)) } | ConvertTo-Json -Compress
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  return JSON.parse(output.trim().split(/\r?\n/).pop());
}

function readNativeEditValuePattern(hwnd) {
  const script = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
$edit = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([long]${hwnd}))
$valuePattern = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$value = $valuePattern.Current.Value
$hash = [Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::Unicode.GetBytes($value)))
@{ controlType = $edit.Current.ControlType.Id; className = $edit.Current.ClassName; framework = $edit.Current.FrameworkId; hwnd = $edit.Current.NativeWindowHandle; readOnly = $valuePattern.Current.IsReadOnly; valueLength = $value.Length; valueHash = $hash } | ConvertTo-Json -Compress
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  return JSON.parse(output.trim().split(/\r?\n/).pop());
}

function readProductionNativeEditSelection(point, expectedPid) {
  const script = `
${buildNativeEditPowerShell()}
$hwnd = [V2PNativeEdit]::WindowFromPoint([V2PNativeEdit+POINT]::new(${point.x}, ${point.y}))
$text = [V2PNativeEdit]::ReadSelectedText($hwnd)
$owner = [V2PNativeEdit]::ProcessId($hwnd)
$threadId = [V2PNativeEdit]::ThreadId($hwnd)
$parentHandle = [V2PNativeEdit]::GetParent($hwnd).ToInt64()
$controlId = [V2PNativeEdit]::GetDlgCtrlID($hwnd)
$selection = [V2PNativeEdit]::ReadSelection($hwnd)
$className = [V2PNativeEdit]::ClassName($hwnd)
$style = [V2PNativeEdit]::Style($hwnd)
$foreground = [V2PNativeEdit]::GetForegroundWindow()
$foregroundPid = [uint32]0
$foregroundThreadId = [V2PNativeEdit]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
$guiInfo = New-Object V2PNativeEdit+GUITHREADINFO
$guiInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][V2PNativeEdit+GUITHREADINFO])
$guiInfoOk = [V2PNativeEdit]::GetGUIThreadInfo($foregroundThreadId, [ref]$guiInfo)
$isTarget = [V2PNativeEdit]::IsTarget($hwnd, [uint32]${expectedPid}, [uint32]$threadId, [IntPtr]$parentHandle, [int]$controlId)
$isFocused = [V2PNativeEdit]::IsFocusedTarget($hwnd, [uint32]${expectedPid}, [uint32]$threadId, [IntPtr]$parentHandle, [int]$controlId)
$wrongOwnerDenied = -not [V2PNativeEdit]::IsTarget($hwnd, [uint32](${expectedPid} + 1), [uint32]$threadId, [IntPtr]$parentHandle, [int]$controlId)
$hash = [Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::Unicode.GetBytes($text)))
@{ hwnd = $hwnd.ToInt64(); className = $className; ownerPid = $owner; expectedPid = ${expectedPid}; nativeThreadId = $threadId; nativeParentHandle = $parentHandle; nativeControlId = $controlId; foreground = $foreground.ToInt64(); foregroundPid = $foregroundPid; foregroundThreadId = $foregroundThreadId; focusedHwnd = $guiInfo.hwndFocus.ToInt64(); guiInfoOk = $guiInfoOk; isTarget = $isTarget; isFocused = $isFocused; wrongOwnerDenied = $wrongOwnerDenied; selectionStart = $selection.Start; selectionEnd = $selection.End; style = $style; readOnly = (($style -band 0x800) -ne 0); selectedLength = $text.Length; selectedHash = $hash } | ConvertTo-Json -Compress
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  return JSON.parse(output.trim().split(/\r?\n/).pop());
}

function readNativeHitClass(point) {
  const script = `
${buildNativeEditPowerShell()}
$hwnd = [V2PNativeEdit]::WindowFromPoint([V2PNativeEdit+POINT]::new(${point.x}, ${point.y}))
@{ hwnd = $hwnd.ToInt64(); className = [V2PNativeEdit]::ClassName($hwnd); ownerPid = [V2PNativeEdit]::ProcessId($hwnd) } | ConvertTo-Json -Compress
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  return JSON.parse(output.trim().split(/\r?\n/).pop());
}

function readUiaPointIdentity(point) {
  const script = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase -ErrorAction Stop
$hit = [System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point(${point.x}, ${point.y})))
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$element = $hit
for ($i = 0; $i -lt 12 -and $null -ne $element; $i++) { if ($element.Current.ControlType.Id -eq 50004) { break }; $element = $walker.GetParent($element) }
@{ hitFramework = $hit.Current.FrameworkId; hitClass = $hit.Current.ClassName; editFramework = $element.Current.FrameworkId; editClass = $element.Current.ClassName; editPid = $element.Current.ProcessId } | ConvertTo-Json -Compress
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  return JSON.parse(output.trim().split(/\r?\n/).pop());
}

function readNativeEditContents(hwnd) {
  const script = `
${buildNativeEditPowerShell()}
$text = [V2PNativeEdit]::ReadText([IntPtr]([long]${hwnd}))
[Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  return Buffer.from(output.trim().split(/\r?\n/).pop(), 'base64').toString('utf8');
}

function readNativeEditTextPattern(hwnd) {
  const script = `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
$edit = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]([long]${hwnd}))
$pattern = $edit.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
$ranges = @($pattern.GetSelection())
if ($ranges.Length -eq 0) { exit 6 }
$text = [string]$ranges[0].GetText(4096)
[Console]::Out.WriteLine('NATIVE_TEXT_PATTERN_LENGTH:' + $text.Length)
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
}

function readFocusedTextPattern(maxCharacters = 4096) {
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
$selectedText = [string]$ranges[0].GetText(${maxCharacters})
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
$clipboardFormats = @([Windows.Forms.Clipboard]::GetDataObject().GetFormats())
$clipboardText = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($clipboard))
@{ foreground = [V2PSnapshot]::GetForegroundWindow().ToInt64(); focusId = $id; clipboardHash = $clipboardHash; clipboardText = $clipboardText; clipboardFormats = $clipboardFormats } | ConvertTo-Json -Compress
`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  }).trim().split(/\r?\n/).pop());
}

function textHash(text) {
  return require('crypto').createHash('sha256').update(Buffer.from(text, 'utf8')).digest('base64');
}

function writeSystemClipboardText(text, expectedHash) {
  const encodedText = Buffer.from(text, 'utf8').toString('base64');
  const script = `
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
$current = [Windows.Forms.Clipboard]::GetText()
$currentHash = [Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($current)))
if ($currentHash -cne '${expectedHash}') { throw 'clipboard changed during guarded paste test; refusing to overwrite' }
$next = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedText}'))
if ($next.Length -eq 0) { [Windows.Forms.Clipboard]::Clear() }
else { [Windows.Forms.Clipboard]::SetText($next, [Windows.Forms.TextDataFormat]::UnicodeText) }
$updated = [Windows.Forms.Clipboard]::GetText()
[Console]::Out.WriteLine([Convert]::ToBase64String([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($updated))))
`;
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encodedScript], {
    encoding: 'utf8', timeout: 10000, windowsHide: true
  });
  return output.trim().split(/\r?\n/).pop();
}

function loadInsertModuleWithClipboard(clipboard) {
  const Module = require('module');
  const modulePath = require.resolve('./insert');
  delete require.cache[modulePath];
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'electron') return { clipboard };
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require('./insert'); }
  finally { Module._load = originalLoad; }
}

function createTestClipboardState(snapshot) {
  const originalText = Buffer.from(snapshot.clipboardText, 'base64').toString('utf8');
  let currentText = originalText;
  let currentHash = snapshot.clipboardHash;
  const clipboard = {
    readText: () => currentText,
    writeText: (nextText) => {
      const next = String(nextText);
      currentHash = writeSystemClipboardText(next, currentHash);
      currentText = next;
    }
  };
  return {
    clipboard,
    originalText,
    originalHash: snapshot.clipboardHash,
    get currentText() { return currentText; },
    get currentHash() { return currentHash; }
  };
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
  console.log('WPF_NATIVE_HIT_DIAGNOSTIC ' + JSON.stringify({
    a1: readNativeHitClass(points.a1), a2: readNativeHitClass(points.a2),
    uia: readUiaPointIdentity(points.a1), fixturePid: points.pid
  }));
  assert.equal(focusedValueReadOnly(), false, 'editable WPF TextBox exposes writable ValuePattern');
  const textPatternRead = readFocusedTextPattern();
  if (textPatternRead.status !== 0 || !String(textPatternRead.stdout || '').includes('TEXT_PATTERN_READ_OK:')) {
    console.log('WPF TextPatternRange.GetText unsupported/crashed (PowerShell exit ' + textPatternRead.status + ', signal ' + textPatternRead.signal + ')');
  }
  const wpfProbe = runGeneratedProbe(points.a1, points.a1, { requireFocusedTarget: true });
  console.log('WPF_PRODUCTION_PROBE_DIAGNOSTIC ' + JSON.stringify({ status: wpfProbe.status, signal: wpfProbe.signal,
    output: wpfProbe.stdout.trim().split(/\r?\n/).pop(), error: wpfProbe.error || wpfProbe.stderr.slice(0, 500) }));
  assert.equal(wpfProbe.status, 0, 'production probe denies WPF without crashing its PowerShell child');
  const wpfResult = JSON.parse(wpfProbe.stdout.trim().split(/\r?\n/).pop());
  assert.equal(wpfResult.ok, false, 'unsupported WPF provider denies selection');
  assert.equal(wpfResult.reason, 'unsupported-provider');
  assert.equal(await probeSelection(points.a1, points.a1, { requireFocusedTarget: true }), null);
  console.log('PASS WPF TextPattern crash provider fails closed without probe child crash');
  assert.deepEqual(runtimeSnapshot(), before, 'probe preserves foreground, focus identity, and clipboard hash');

  focusAt(points.readonly);
  assert.equal(focusedValueReadOnly(), true, 'read-only WPF TextBox reports IsReadOnly through ValuePattern');
  assert.equal(await probeSelection(points.readonly, points.readonly, { requireFocusedTarget: true }), null, 'read-only Edit denies');
  assert.equal(await probeSelection(points.object, points.object, { requireFocusedTarget: true }), null, 'object hit denies');
  assert.equal(await probeSelection(points.window, points.window, { requireFocusedTarget: true }), null, 'window background denies');

  await stopCurrentFixture();
  execFileSync(csc, ['/nologo', '/target:winexe', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
    `/out:${nativeFixtureExe}`, nativeFixtureSource], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  currentStopFile = nativeStopFile;
  fixture = spawn(nativeFixtureExe, [nativeReadyFile, nativeStopFile, nativeFocusRequestFile, nativeFocusAckFile, nativeKeepFrontFile], { windowsHide: false, stdio: 'ignore' });
  const nativePoints = await waitForReady(nativeReadyFile);
  await new Promise((resolve) => setTimeout(resolve, 300));
  fs.writeFileSync(nativeKeepFrontFile, 'keep-front');
  console.log('NATIVE_EDIT_WINDOW_HIT ' + JSON.stringify({
    editHwnd: nativePoints.hwnd,
    a1Hit: nativePoints.a1Hit,
    a2Hit: nativePoints.a2Hit,
    a1HitsEdit: nativePoints.a1Hit === nativePoints.hwnd,
    a2HitsEdit: nativePoints.a2Hit === nativePoints.hwnd
  }));
  await refocusNativeFixture();
  const nativeRead = readProductionNativeEditSelection(nativePoints.a1, nativePoints.pid);
  console.log('NATIVE_EDIT_PRODUCTION_READ ' + JSON.stringify({
    hwnd: nativeRead.hwnd, className: nativeRead.className, ownerPid: nativeRead.ownerPid,
    foregroundPid: nativeRead.expectedPid, isFocused: nativeRead.isFocused, wrongOwnerDenied: nativeRead.wrongOwnerDenied,
    nativeThreadId: nativeRead.nativeThreadId, nativeParentHandle: nativeRead.nativeParentHandle,
    nativeControlId: nativeRead.nativeControlId, selectionStart: nativeRead.selectionStart, selectionEnd: nativeRead.selectionEnd,
    readOnly: nativeRead.readOnly,
    selectedLength: nativeRead.selectedLength, selectedHash: nativeRead.selectedHash
  }));
  await refocusNativeFixture();
  const nativeScriptProbe = runGeneratedProbe(nativePoints.a1, nativePoints.a2, { requireFocusedTarget: true });
  const generatedNativeResult = JSON.parse(nativeScriptProbe.stdout.trim().split(/\r?\n/).pop());
  console.log('NATIVE_PRODUCTION_PROBE_DIAGNOSTIC ' + JSON.stringify({
    status: nativeScriptProbe.status, signal: nativeScriptProbe.signal,
    ok: generatedNativeResult.ok, reason: generatedNativeResult.reason, provider: generatedNativeResult.provider,
    selectedLength: generatedNativeResult.text && generatedNativeResult.text.length
  }));
  const nativeEligible = await probeSelection(nativePoints.a1, nativePoints.a2, { requireFocusedTarget: true });
  console.log('NATIVE_EDIT_PROBE_RESULT ' + JSON.stringify({
    confirmed: !!nativeEligible,
    processName: nativeEligible && nativeEligible.processName,
    selectedLength: nativeEligible && nativeEligible.text.length
  }));
  assert.ok(nativeEligible, 'production probe confirms selected text in the Win32 Edit fixture');
  assert.equal(nativeEligible.provider, 'win32-edit');
  assert.equal(nativeEligible.controlId, `${nativePoints.pid}|${nativePoints.hwnd}|win32-edit`);
  const expectedNativeSelection = 'Native Edit fixture has enough selected text for the palette threshold. \u4E2D\u6587'.substring(8, 74);
  const expectedNativeHash = require('crypto').createHash('sha256').update(Buffer.from(expectedNativeSelection, 'utf16le')).digest('base64');
  assert.equal(nativeRead.hwnd, nativePoints.hwnd, 'both native endpoint coordinates hit the fixture Edit HWND');
  assert.equal(nativeRead.className, 'Edit');
  assert.equal(nativeRead.ownerPid, nativePoints.pid);
  assert.equal(nativeRead.wrongOwnerDenied, true, 'native identity denies an HWND when the encoded PID is wrong');
  assert.equal(nativeEligible.nativeThreadId, nativeRead.nativeThreadId);
  assert.equal(nativeEligible.nativeParentHandle, nativeRead.nativeParentHandle);
  assert.equal(nativeEligible.nativeControlId, nativeRead.nativeControlId);
  assert.equal(nativeEligible.selectionStart, 8);
  assert.equal(nativeEligible.selectionEnd, 74);
  assert.equal(nativeRead.isFocused, true, 'fixture Edit is the focused foreground target');
  assert.equal(nativeRead.readOnly, false);
  assert.equal(nativeRead.selectedLength, 66);
  assert.equal(nativeRead.selectedHash, expectedNativeHash);
  console.log('PASS native Edit EM_GETSEL + WM_GETTEXT selected-text read');
  await refocusNativeFixture('empty');
  const emptyRead = readNativeEditSelection(nativePoints.a1, nativePoints.pid);
  assert.equal(emptyRead.selectionStart, emptyRead.selectionEnd, 'fixture has focus but no selected range');
  assert.equal(emptyRead.selectedLength, 0);
  assert.equal(await probeSelection(nativePoints.a1, nativePoints.a2, { requireFocusedTarget: true }), null,
    'a focused Edit with a collapsed selection is denied');
  await refocusNativeFixture();
  console.log('PASS focused native Edit with empty selection is denied');
  const nativeState = inspectAndFocusFixture(nativePoints.pid, nativePoints.hwnd);
  console.log('NATIVE_EDIT_UIA_DIAGNOSTIC ' + JSON.stringify(nativeState));
  if (!nativeState.focusedEdit) console.log('NATIVE_EDIT_UIA_NOTE: Edit HWND is real; UIA tree does not expose ControlType.Edit');
  const nativeBefore = runtimeSnapshot();
  assert.equal(nativeEligible.text, expectedNativeSelection);
  assert.equal(shouldShowPalette({ selection: nativeEligible, enabled: true, now: Date.now() }).ok, true);
  assert.equal(meetsMinimumCharacters(nativeEligible, 20), true);
  assert.equal(meetsMinimumCharacters(nativeEligible, nativeEligible.text.trim().length + 1), false);
  assert.equal(await probeSelection(nativePoints.a1, nativePoints.b, { requireFocusedTarget: true }), null,
    'native drag across two writable Edit HWNDs denies');
  assert.equal(await probeSelection(nativePoints.a1, nativePoints.readonly, { requireFocusedTarget: true }), null,
    'native cross-control/read-only endpoint denies');
  assert.equal(await probeSelection(nativePoints.readonly, nativePoints.readonly, { requireFocusedTarget: true }), null,
    'native ES_READONLY control denies');
  assert.equal(await probeSelection(nativePoints.object, nativePoints.object, { requireFocusedTarget: true }), null,
    'native fixture object denies');
  assert.equal(await probeSelection(nativePoints.window, nativePoints.window, { requireFocusedTarget: true }), null,
    'native fixture window background denies');
  const nativeAfterProbe = readProductionNativeEditSelection(nativePoints.a1, nativePoints.pid);
  assert.deepEqual({ hwnd: nativeAfterProbe.hwnd, isFocused: nativeAfterProbe.isFocused,
    selectionStart: nativeAfterProbe.selectedLength, selectedHash: nativeAfterProbe.selectedHash },
  { hwnd: nativeRead.hwnd, isFocused: nativeRead.isFocused,
    selectionStart: nativeRead.selectedLength, selectedHash: nativeRead.selectedHash },
  'native probe preserves focus and selected text');
  assert.deepEqual(runtimeSnapshot(), nativeBefore, 'native Edit probe preserves foreground, focus identity, and clipboard hash');

  const clipboardSnapshot = runtimeSnapshot();
  const originalClipboardText = Buffer.from(clipboardSnapshot.clipboardText, 'base64').toString('utf8');
  const safeTextFormats = new Set(['System.String', 'UnicodeText', 'Text', 'Locale', 'OEMText']);
  const unexpectedFormats = (clipboardSnapshot.clipboardFormats || []).filter((format) => !safeTextFormats.has(format));
  if (!originalClipboardText || originalClipboardText.length > 1000 || /[\r\n\0]/.test(originalClipboardText) || unexpectedFormats.length) {
    console.log('BLOCKED guarded insertText runtime: clipboard is empty, multiline, too large, or has non-text formats');
    return;
  }

  const testClipboard = createTestClipboardState(clipboardSnapshot);
  testClipboardRestore = testClipboard;
  const { insertText } = loadInsertModuleWithClipboard(testClipboard.clipboard);
  const originalEditText = readNativeEditContents(nativePoints.hwnd);
  const replacementText = 'V2P guarded native Edit replacement';
  const expectedEditText = originalEditText.substring(0, 8) + replacementText + originalEditText.substring(74);
  await refocusNativeFixture('a');
  const writebackTarget = await probeSelection(nativePoints.a1, nativePoints.a2, { requireFocusedTarget: true });
  assert.ok(writebackTarget && writebackTarget.provider === 'win32-edit');
  const inserted = await insertText(replacementText, 'paste', { target: writebackTarget });
  assert.equal(inserted.inserted, true, 'guarded insertText pastes into the matching native Edit');
  assert.equal(inserted.cancelled, undefined);
  assert.equal(readNativeEditContents(nativePoints.hwnd), expectedEditText, 'paste replaces only the selected range');
  assert.equal(testClipboard.currentText, replacementText);
  console.log('PASS guarded insertText replaces native Edit selection without model processing');

  await refocusNativeFixture('b');
  const secondControlBefore = readNativeEditContents(nativePoints.hwndB);
  const cancelled = await insertText('V2P stale target must not paste', 'paste', { target: writebackTarget });
  assert.equal(cancelled.cancelled, true, 'target change cancels guarded insertText');
  assert.equal(readNativeEditContents(nativePoints.hwndB), secondControlBefore, 'target-switch attempt sends no paste to the newly focused Edit');
  assert.equal(testClipboard.currentText, replacementText, 'cancel restores the clipboard value present before the attempt');
  console.log('PASS guarded insertText cancels a focused-target change and restores clipboard text');

  await refocusNativeFixture('same-a');
  const firstRepeatedRange = await probeSelection(nativePoints.a1, nativePoints.a2, { requireFocusedTarget: true });
  assert.ok(firstRepeatedRange && firstRepeatedRange.text === 'identical selection text');
  await refocusNativeFixture('same-b');
  const secondRepeatedRange = await probeSelection(nativePoints.a1, nativePoints.a2, { requireFocusedTarget: true });
  assert.ok(secondRepeatedRange && secondRepeatedRange.text === firstRepeatedRange.text,
    'fixture moves between equal-text ranges in the same Edit');
  assert.notEqual(secondRepeatedRange.selectionStart, firstRepeatedRange.selectionStart);
  assert.notEqual(secondRepeatedRange.selectionEnd, firstRepeatedRange.selectionEnd);
  const sameTextDocument = readNativeEditContents(nativePoints.hwnd);
  const staleEqualText = await insertText('must not replace moved selection', 'paste', { target: firstRepeatedRange });
  assert.equal(staleEqualText.cancelled, true, 'equal selected text at different offsets cancels guarded write-back');
  assert.equal(readNativeEditContents(nativePoints.hwnd), sameTextDocument,
    'stale equal-text selection sends no input and does not alter the second occurrence');
  assert.equal(testClipboard.currentText, replacementText,
    'stale equal-text cancellation restores the clipboard value before the attempt');
  console.log('PASS guarded insertText rejects same text moved to a different native selection range');

  testClipboard.clipboard.writeText(originalClipboardText);
  assert.equal(testClipboard.currentHash, clipboardSnapshot.clipboardHash, 'runtime paste test restores the original clipboard text');
  const restoredClipboard = runtimeSnapshot();
  assert.equal(restoredClipboard.clipboardHash, clipboardSnapshot.clipboardHash);
  const sortFormats = (formats) => [...formats].sort();
  assert.deepEqual(sortFormats(restoredClipboard.clipboardFormats), sortFormats(clipboardSnapshot.clipboardFormats),
    'runtime paste test restores supported text clipboard formats');
  testClipboardRestore = null;
  console.log('PASS runtime paste test restored original clipboard text and formats');
}

run().catch((error) => {
  console.error('FAIL live Windows UIA fixture:', error && error.stack || error);
  failures.push('fixture scenario failed before completion');
}).finally(async () => {
  if (testClipboardRestore && testClipboardRestore.currentHash !== testClipboardRestore.originalHash) {
    try {
      const current = runtimeSnapshot();
      if (current.clipboardHash !== testClipboardRestore.currentHash) {
        throw new Error('clipboard changed outside the runtime test; leaving it untouched');
      }
      writeSystemClipboardText(testClipboardRestore.originalText, testClipboardRestore.currentHash);
      const restored = runtimeSnapshot();
      if (restored.clipboardHash !== testClipboardRestore.originalHash) throw new Error('clipboard text hash did not restore');
      console.log('PASS original clipboard text restored in cleanup');
    } catch (error) {
      console.error('FAIL clipboard cleanup:', error && error.message || error);
      failures.push('clipboard state could not be safely restored');
    }
  }
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
