// Builds a PowerShell guard that runs immediately before the explicit Ctrl+V.
function buildPasteTargetGuard(target) {
  if (!target || typeof target.text !== 'string' || !target.text.trim()) return null;
  const match = /^(\d+)\|(\d+)\|([\d.]+)$/.exec(String(target.controlId || ''));
  if (!match) return null;
  const expectedText = Buffer.from(target.text, 'utf8').toString('base64');
  return `
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
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
$selectedText = ''
if ($focusedId) {
  $valuePattern = $focused.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  if ($null -eq $valuePattern -or $valuePattern.Current.IsReadOnly) { $focusedId = '' }
  else {
    $textPattern = $focused.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
    $ranges = @($textPattern.GetSelection())
    $selectedParts = @()
    foreach ($range in $ranges) { $selectedParts += $range.GetText(100000) }
    $selectedText = [string]::Join('', $selectedParts)
  }
}
$expectedText = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${expectedText}'))
if ($foregroundPid -ne ${match[1]} -or $focusedId -ne '${match[1]}|${match[2]}|${match[3]}' -or $selectedText -cne $expectedText) {
  Write-Output 'V2P_CANCEL'
  exit 20
}
`;
}

module.exports = { buildPasteTargetGuard };
