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
  if (!target || target.provider !== 'win32-edit' || typeof target.text !== 'string' || !target.text.trim()) return null;
  return buildNativePasteTargetGuard(target);
}

const REQUIRE_NATIVE_TARGET = `if (-not (Test-V2PNativePasteTarget)) { Write-Output 'V2P_CANCEL'; exit 20 }`;
const RESTORE_SHIFT_IF_NATIVE_TARGET = `try { if (Test-V2PNativePasteTargetIdentity) { [V2PPaste]::TapShift() } } catch { }`;

module.exports = {
  buildPasteTargetGuard,
  REQUIRE_NATIVE_TARGET,
  RESTORE_SHIFT_IF_NATIVE_TARGET
};
