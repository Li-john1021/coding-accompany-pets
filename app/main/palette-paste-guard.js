// Builds passive target checks for guarded palette key injection.
const { buildNativeEditPowerShell } = require('./win32-edit');

function buildNativePasteTargetGuard(target) {
  const match = /^(\d+)\|(\d+)\|win32-edit$/.exec(String(target.controlId || ''));
  const processId = Number(target.processId), nativeHandle = Number(target.nativeHandle);
  const nativeThreadId = Number(target.nativeThreadId), nativeParentHandle = Number(target.nativeParentHandle);
  const nativeControlId = Number(target.nativeControlId), selectionStart = Number(target.selectionStart), selectionEnd = Number(target.selectionEnd);
  if (!match || !Number.isInteger(processId) || !Number.isSafeInteger(nativeHandle) ||
      Number(match[1]) !== processId || Number(match[2]) !== nativeHandle || nativeHandle <= 0 ||
      !Number.isInteger(nativeThreadId) || nativeThreadId <= 0 || !Number.isSafeInteger(nativeParentHandle) || nativeParentHandle <= 0 ||
      !Number.isInteger(nativeControlId) || nativeControlId < 0 || !Number.isInteger(selectionStart) || selectionStart < 0 ||
      !Number.isInteger(selectionEnd) || selectionEnd <= selectionStart || selectionEnd - selectionStart !== target.text.length) return null;
  return `
${buildNativeEditPowerShell()}
$script:V2PExpectedSelectionBase64 = [Console]::In.ReadLine()
function Test-V2PNativePasteTargetIdentity {
  try { return [V2PNativeEdit]::IsFocusedTarget([IntPtr]${nativeHandle}, [uint32]${processId}, [uint32]${nativeThreadId}, [IntPtr]${nativeParentHandle}, [int]${nativeControlId}) } catch { return $false }
}
function Test-V2PNativePasteTarget {
  try {
    if (-not (Test-V2PNativePasteTargetIdentity)) { return $false }
    $selection = [V2PNativeEdit]::ReadSelection([IntPtr]${nativeHandle})
    $expected = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($script:V2PExpectedSelectionBase64))
    return ([V2PNativeEdit]::IsFocusedTarget([IntPtr]${nativeHandle}, [uint32]${processId}, [uint32]${nativeThreadId}, [IntPtr]${nativeParentHandle}, [int]${nativeControlId}) -and
      $selection.Start -eq ${selectionStart} -and $selection.End -eq ${selectionEnd} -and $selection.Text -ceq $expected)
  } catch { return $false }
}
`;
}

function buildPasteTargetGuard(target) {
  if (!target || typeof target.text !== 'string' || !target.text.trim()) return null;
  if (target.provider === 'win32-edit') return buildNativePasteTargetGuard(target);
  if (target.provider !== 'uia-textpattern') return null;
  const match = /^(\d+)\|(\d+)\|([\d.]+)$/.exec(String(target.controlId || ''));
  if (!match) return null;
  return `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
$script:V2PExpectedSelectionBase64 = [Console]::In.ReadLine()
function Test-V2PPasteTargetIdentity {
  try {
    $foreground = [V2PPaste]::GetForegroundWindow()
    $foregroundPid = [uint32]0
    [void][V2PPaste]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    for ($i = 0; $i -lt 12 -and $null -ne $focused; $i++) {
      if ($focused.Current.ControlType.Id -eq 50004) { break }
      $focused = $walker.GetParent($focused)
    }
    $focusedId = ''
    if ($null -ne $focused -and $focused.Current.ControlType.Id -eq 50004) {
      $focusedRuntime = (@($focused.GetRuntimeId()) | ForEach-Object { [string]$_ }) -join '.'
      $focusedId = ([string]$focused.Current.ProcessId + '|' + [string]$focused.Current.NativeWindowHandle + '|' + $focusedRuntime)
    }
    return ($foregroundPid -eq ${match[1]} -and $focusedId -eq '${match[1]}|${match[2]}|${match[3]}')
  } catch {
    return $false
  }
}
function Test-V2PPasteTarget {
  try {
    if (-not (Test-V2PPasteTargetIdentity)) { return $false }
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    for ($i = 0; $i -lt 12 -and $null -ne $focused; $i++) {
      if ($focused.Current.ControlType.Id -eq 50004) { break }
      $focused = $walker.GetParent($focused)
    }
    $focusedId = ''
    if ($null -ne $focused -and $focused.Current.ControlType.Id -eq 50004) {
      $focusedRuntime = (@($focused.GetRuntimeId()) | ForEach-Object { [string]$_ }) -join '.'
      $focusedId = ([string]$focused.Current.ProcessId + '|' + [string]$focused.Current.NativeWindowHandle + '|' + $focusedRuntime)
    }
    if ($focusedId -ne '${match[1]}|${match[2]}|${match[3]}') { return $false }
    $selectedText = ''
    if ($focusedId) {
      $valuePattern = $focused.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      if ($null -eq $valuePattern -or $valuePattern.Current.IsReadOnly) { return $false }
      $textPattern = $focused.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      $ranges = @($textPattern.GetSelection())
      $selectedParts = @()
      foreach ($range in $ranges) { $selectedParts += $range.GetText(100000) }
      $selectedText = [string]::Join('', $selectedParts)
    }
    $expectedText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($script:V2PExpectedSelectionBase64))
    return ($selectedText -ceq $expectedText)
  } catch {
    return $false
  }
}
`;
}

const REQUIRE_TARGET = `if (-not (Test-V2PPasteTarget)) { Write-Output 'V2P_CANCEL'; exit 20 }`;
const RESTORE_SHIFT_IF_TARGET = `try { if (Test-V2PPasteTargetIdentity) { [V2PPaste]::TapShift() } } catch { }`;
const REQUIRE_NATIVE_TARGET = `if (-not (Test-V2PNativePasteTarget)) { Write-Output 'V2P_CANCEL'; exit 20 }`;
const RESTORE_SHIFT_IF_NATIVE_TARGET = `try { if (Test-V2PNativePasteTargetIdentity) { [V2PPaste]::TapShift() } } catch { }`;

module.exports = {
  buildPasteTargetGuard,
  REQUIRE_TARGET,
  RESTORE_SHIFT_IF_TARGET,
  REQUIRE_NATIVE_TARGET,
  RESTORE_SHIFT_IF_NATIVE_TARGET
};
