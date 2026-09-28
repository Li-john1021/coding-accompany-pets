// Fail-closed policy for automatic selection palette eligibility.
const TERMINAL_RE = /^(windowsterminal|wt|cmd|powershell|pwsh|windowssystem32|conhost|wezterm|alacritty|hyper)$/i;

function isTerminalProcess(name) {
  return TERMINAL_RE.test(String(name || '').replace(/\.exe$/i, ''));
}

function shouldShowPalette({ selection, enabled, recording, userCopyAt, now }) {
  if (enabled === false) return { ok: false, reason: 'disabled' };
  if (recording) return { ok: false, reason: 'recording' };
  if (userCopyAt && now - userCopyAt < 500) return { ok: false, reason: 'user-copy' };
  if (!selection || selection.confirmed !== true || !selection.controlId ||
      typeof selection.text !== 'string' || !selection.text.trim()) {
    return { ok: false, reason: 'selection-unconfirmed' };
  }
  if (isTerminalProcess(selection.processName)) return { ok: false, reason: 'terminal' };
  return { ok: true, reason: 'ok' };
}

function meetsMinimumCharacters(selection, minimum) {
  if (!selection || selection.confirmed !== true || typeof selection.text !== 'string' || !selection.text.trim()) {
    return false;
  }
  const limit = Number(minimum);
  return selection.text.trim().length >= (Number.isFinite(limit) && limit > 0 ? limit : 0);
}

module.exports = { isTerminalProcess, shouldShowPalette, meetsMinimumCharacters };
