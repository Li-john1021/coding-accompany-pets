// Builds passive target checks for guarded palette key injection.
function buildPasteTargetGuard(target) {
  if (!target || typeof target.text !== 'string' || !target.text.trim()) return null;
  const match = /^(\d+)\|(\d+)\|([\d.]+)$/.exec(String(target.controlId || ''));
  if (!match) return null;
  const expectedText = Buffer.from(target.text, 'utf8').toString('base64');
  return `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
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
    $expectedText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${expectedText}'))
    return ($selectedText -ceq $expectedText)
  } catch {
    return $false
  }
}
`;
}

const REQUIRE_TARGET = `if (-not (Test-V2PPasteTarget)) { Write-Output 'V2P_CANCEL'; exit 20 }`;
const RESTORE_SHIFT_IF_TARGET = `try { if (Test-V2PPasteTargetIdentity) { [V2PPaste]::TapShift() } } catch { }`;

module.exports = { buildPasteTargetGuard, REQUIRE_TARGET, RESTORE_SHIFT_IF_TARGET };
