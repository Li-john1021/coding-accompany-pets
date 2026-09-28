// Fail-closed policy for automatic selection palette eligibility.
const TERMINAL_RE = /^(windowsterminal|wt|cmd|powershell|pwsh|windowssystem32|conhost|conemu|conemu64|mintty|bash|wsl|ubuntu|debian|wezterm|wezterm-gui|alacritty|hyper|tabby|kitty|putty|cmder|fluentterminal|terminus|rio|xterm)$/i;
const PDF_VIEWER_RE = /^(acrobat|acrord32|foxitreader|foxitpdfreader|foxitpdfeditor|sumatrapdf|pdfxedit|pdfxeditor|nitropdf|nitropdfreader)$/i;

function isTerminalProcess(name) {
  return TERMINAL_RE.test(String(name || '').replace(/\.exe$/i, ''));
}

function isPdfViewerProcess(name) {
  return PDF_VIEWER_RE.test(String(name || '').replace(/\.exe$/i, ''));
}

function shouldShowPalette({ selection, enabled, recording, userCopyAt, now }) {
  if (enabled === false) return { ok: false, reason: 'disabled' };
  if (recording) return { ok: false, reason: 'recording' };
  if (userCopyAt && now - userCopyAt < 500) return { ok: false, reason: 'user-copy' };
  if (!selection || selection.confirmed !== true || !selection.controlId ||
      typeof selection.text !== 'string' || selection.text.length === 0 ||
      typeof selection.processName !== 'string' || !selection.processName) {
    return { ok: false, reason: 'selection-unconfirmed' };
  }
  if (isTerminalProcess(selection.processName)) return { ok: false, reason: 'terminal' };
  if (isPdfViewerProcess(selection.processName)) return { ok: false, reason: 'pdf-viewer' };
  return { ok: true, reason: 'ok' };
}

function meetsMinimumCharacters(selection, minimum) {
  if (!selection || selection.confirmed !== true || typeof selection.text !== 'string' || selection.text.length === 0) {
    return false;
  }
  const limit = Number(minimum);
  return selection.text.trim().length >= (Number.isFinite(limit) && limit > 0 ? limit : 0);
}

module.exports = { isTerminalProcess, isPdfViewerProcess, shouldShowPalette, meetsMinimumCharacters };
