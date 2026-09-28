// Passive UI Automation probe for the automatic selection palette.
// It never sends input, changes focus/selection, or reads/writes the clipboard.
const { execFile } = require('child_process');

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
  $focus = [System.Windows.Automation.AutomationElement]::FocusedElement
  for ($i = 0; $i -lt 12 -and $null -ne $focus; $i++) {
    if ($focus.Current.ControlType.Id -eq 50004) { break }
    $focus = $walker.GetParent($focus)
  }
  if ($null -eq $focus -or $focus.Current.ControlType.Id -ne 50004) { throw 'focused Edit unavailable' }
  $focusRuntime = (@($focus.GetRuntimeId()) | ForEach-Object { [string]$_ }) -join '.'
  $focusId = ([string]$focus.Current.ProcessId + '|' + [string]$focus.Current.NativeWindowHandle + '|' + $focusRuntime)
  if ($focusId -ne $a.controlId) { throw 'active target changed' }
` : '';
  return `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
function Probe-Point([int]$x, [int]$y) {
  $hit = [System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point($x, $y)))
  if ($null -eq $hit) { throw 'no element at point' }
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $element = $hit
  for ($i = 0; $i -lt 12 -and $null -ne $element; $i++) {
    if ($element.Current.ControlType.Id -eq 50004) { break }
    $element = $walker.GetParent($element)
  }
  if ($null -eq $element -or $element.Current.ControlType.Id -ne 50004) { throw 'hit is not an Edit control' }
  if (-not $element.Current.IsEnabled -or $element.Current.IsOffscreen) { throw 'edit unavailable' }
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
  return @{ controlId = ([string]$element.Current.ProcessId + '|' + [string]$element.Current.NativeWindowHandle + '|' + $runtimeId); text = $text; processName = $proc }
}
try {
  $a = Probe-Point ${sx} ${sy}
  $b = Probe-Point ${ex} ${ey}
  if ($a.controlId -ne $b.controlId -or $a.text -cne $b.text) { throw 'endpoint evidence mismatch' }
${focusCheck}
  @{ ok = $true; controlId = $a.controlId; text = $a.text; processName = $a.processName } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; reason = 'probe-failed' } | ConvertTo-Json -Compress
}
`;
}

function parseProbeOutput(stdout) {
  try {
    const parsed = JSON.parse(String(stdout || '').trim().split(/\r?\n/).pop());
    if (!parsed || parsed.ok !== true || typeof parsed.controlId !== 'string' || !parsed.controlId ||
        typeof parsed.text !== 'string' || parsed.text.length === 0 ||
        typeof parsed.processName !== 'string' || !parsed.processName) return null;
    return { confirmed: true, controlId: parsed.controlId, text: parsed.text, processName: parsed.processName };
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
