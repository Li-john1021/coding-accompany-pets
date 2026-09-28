// Passive UI Automation probe for the automatic selection palette.
// It never sends input, changes focus/selection, or reads/writes the clipboard.
const { execFile } = require('child_process');
const { buildNativeEditPowerShell } = require('./win32-edit');

const PROBE_TIMEOUT_MS = 1800;

function numberArg(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 1000000) throw new Error('invalid screen point');
  return Math.round(n);
}

function buildProbeScript(start, end, options = {}) {
  const sx = numberArg(start.x), sy = numberArg(start.y);
  const ex = numberArg(end.x), ey = numberArg(end.y);
  const focusCheck = options.requireFocusedTarget ? `
  if ($a.provider -eq 'win32-edit') {
    if (-not [V2PNativeEdit]::IsFocusedTarget([IntPtr]$a.nativeHandle, [uint32]$a.processId)) { throw 'active native Edit changed' }
  } else {
    $focus = [System.Windows.Automation.AutomationElement]::FocusedElement
    $focusWalker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    for ($i = 0; $i -lt 12 -and $null -ne $focus; $i++) {
      if ($focus.Current.ControlType.Id -eq 50004) { break }
      $focus = $focusWalker.GetParent($focus)
    }
    if ($null -eq $focus -or $focus.Current.ControlType.Id -ne 50004) { throw 'focused Edit unavailable' }
    $focusRuntime = (@($focus.GetRuntimeId()) | ForEach-Object { [string]$_ }) -join '.'
    $focusId = ([string]$focus.Current.ProcessId + '|' + [string]$focus.Current.NativeWindowHandle + '|' + $focusRuntime)
    if ($focusId -ne $a.controlId) { throw 'active target changed' }
  }
` : '';
  return `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
${buildNativeEditPowerShell()}
function Probe-NativeEdit([int]$x, [int]$y) {
  $hwnd = [V2PNativeEdit]::WindowFromPoint([V2PNativeEdit+POINT]::new($x, $y))
  if ($hwnd -eq [IntPtr]::Zero) { return @{ isNative = $false; nativeHandle = 0; windowClass = '' } }
  $windowClass = [V2PNativeEdit]::ClassName($hwnd)
  if ($windowClass -cne 'Edit') { return @{ isNative = $false; nativeHandle = $hwnd.ToInt64(); windowClass = $windowClass } }
  if (-not [V2PNativeEdit]::IsWindowEnabled($hwnd) -or ([V2PNativeEdit]::Style($hwnd) -band 0x800) -ne 0) {
    throw 'native Edit is disabled or read-only'
  }
  $ownerPid = [V2PNativeEdit]::ProcessId($hwnd)
  if ($ownerPid -eq 0) { throw 'native Edit process identity unavailable' }
  $text = [V2PNativeEdit]::ReadSelectedText($hwnd)
  if ([string]::IsNullOrEmpty($text)) { throw 'native Edit selection is empty' }
  $handle = $hwnd.ToInt64()
  $proc = (Get-Process -Id $ownerPid -ErrorAction Stop).ProcessName
  return @{ isNative = $true; ok = $true; controlId = ([string]$ownerPid + '|' + [string]$handle + '|win32-edit'); nativeHandle = $handle; processId = $ownerPid; provider = 'win32-edit'; text = $text; processName = $proc }
}
try {
  $nativeA = Probe-NativeEdit ${sx} ${sy}
  $nativeB = Probe-NativeEdit ${ex} ${ey}
  if ($nativeA.isNative -or $nativeB.isNative) {
    if (-not $nativeA.isNative -or -not $nativeB.isNative -or
        $nativeA.controlId -ne $nativeB.controlId -or $nativeA.text -cne $nativeB.text) {
      @{ ok = $false; reason = 'endpoint-mismatch' } | ConvertTo-Json -Compress
      exit 0
    }
    if (${options.requireFocusedTarget ? '$true' : '$false'} -and -not [V2PNativeEdit]::IsFocusedTarget([IntPtr]$nativeA.nativeHandle, [uint32]$nativeA.processId)) {
      @{ ok = $false; reason = 'focus-mismatch' } | ConvertTo-Json -Compress
      exit 0
    }
    @{ ok = $true; controlId = $nativeA.controlId; nativeHandle = $nativeA.nativeHandle; processId = $nativeA.processId; provider = $nativeA.provider; text = $nativeA.text; processName = $nativeA.processName } | ConvertTo-Json -Compress
    exit 0
  }
} catch {
  @{ ok = $false; reason = 'probe-failed' } | ConvertTo-Json -Compress
  exit 0
}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase -ErrorAction Stop
function Probe-Point([int]$x, [int]$y) {
  $hit = [System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point($x, $y)))
  if ($null -eq $hit) { throw 'no element at point' }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $element = $hit
  for ($i = 0; $i -lt 12 -and $null -ne $element; $i++) {
    if ($element.Current.ControlType.Id -eq 50004) { break }
    $element = $walker.GetParent($element)
  }
    if ($null -eq $element -or $element.Current.ControlType.Id -ne 50004) {
      throw 'hit is not an Edit control'
    }
    if (-not $element.Current.IsEnabled -or $element.Current.IsOffscreen) { throw 'edit unavailable' }
    if ($element.Current.FrameworkId -eq 'WPF') { throw 'unsupported-provider: observed WPF TextPatternRange.GetText crash' }
  $value = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  if ($null -eq $value -or $value.Current.IsReadOnly) { throw 'edit is readonly or readonly status unknown' }
  $textPattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
  if ($null -eq $textPattern) { throw 'TextPattern unavailable' }
  $selected = @($textPattern.GetSelection())
  if ($null -eq $selected -or $selected.Length -eq 0) { throw 'empty selection' }
  $parts = @()
  foreach ($range in $selected) { $parts += $range.GetText(100000) }
  $text = [string]::Join('', $parts)
  if ([string]::IsNullOrEmpty($text)) { throw 'empty selection' }
  $runtimeId = (@($element.GetRuntimeId()) | ForEach-Object { [string]$_ }) -join '.'
  if ([string]::IsNullOrEmpty($runtimeId)) { throw 'runtime identity unavailable' }
  $proc = (Get-Process -Id $element.Current.ProcessId -ErrorAction Stop).ProcessName
  return @{ controlId = ([string]$element.Current.ProcessId + '|' + [string]$element.Current.NativeWindowHandle + '|' + $runtimeId); nativeHandle = [long]$element.Current.NativeWindowHandle; processId = [int]$element.Current.ProcessId; provider = 'uia-textpattern'; text = $text; processName = $proc }
}
try {
  $a = Probe-Point ${sx} ${sy}
  $b = Probe-Point ${ex} ${ey}
  if ($a.controlId -ne $b.controlId -or $a.text -cne $b.text) { throw 'endpoint evidence mismatch' }
${focusCheck}
  @{ ok = $true; controlId = $a.controlId; nativeHandle = $a.nativeHandle; processId = $a.processId; provider = $a.provider; text = $a.text; processName = $a.processName } | ConvertTo-Json -Compress
} catch {
  $reason = 'probe-failed'
  if ($_.Exception.Message -like 'unsupported-provider:*') { $reason = 'unsupported-provider' }
  @{ ok = $false; reason = $reason } | ConvertTo-Json -Compress
}
`;
}

function parseProbeOutput(stdout) {
  try {
    const parsed = JSON.parse(String(stdout || '').trim().split(/\r?\n/).pop());
    if (!parsed || parsed.ok !== true || typeof parsed.controlId !== 'string' || !parsed.controlId ||
        typeof parsed.text !== 'string' || parsed.text.length === 0 ||
        typeof parsed.processName !== 'string' || !parsed.processName ||
        !['win32-edit', 'uia-textpattern'].includes(parsed.provider)) return null;
    if (parsed.provider === 'win32-edit') {
      const nativeHandle = Number(parsed.nativeHandle), processId = Number(parsed.processId);
      if (!Number.isSafeInteger(nativeHandle) || nativeHandle <= 0 || !Number.isInteger(processId) || processId <= 0 ||
          parsed.controlId !== `${processId}|${nativeHandle}|win32-edit`) return null;
    }
    return {
      confirmed: true,
      controlId: parsed.controlId,
      nativeHandle: Number(parsed.nativeHandle) || 0,
      processId: Number(parsed.processId) || 0,
      provider: parsed.provider,
      text: parsed.text,
      processName: parsed.processName
    };
  } catch {
    return null;
  }
}

function probeSelection(start, end, options = {}) {
  let script;
  try { script = buildProbeScript(start, end, options); } catch { return Promise.resolve(null); }
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 256 * 1024 },
      (err, stdout) => resolve(err ? null : parseProbeOutput(stdout)));
  });
}

module.exports = { PROBE_TIMEOUT_MS, buildProbeScript, parseProbeOutput, probeSelection };
