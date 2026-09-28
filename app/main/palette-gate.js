// palette-gate.js — 选中浮条限源纯逻辑（可单测，不依赖 electron）
const EDITABLE_FOCUS_RE =
  /^(edit|richedit|richedit20a|richedit20w|richedit50w|scintilla|avalonedit|tsynedit|tedit|tcomboboxex32)/i;
const HOST_DENY_RE =
  /^(progman|workerw|cabinetwclass|shell_traywnd|shell_sectraywnd|dv2controlhost|windows\.ui\.core\.corewindow|#32768|applicationframewindow)$/i;
const TERMINAL_RE =
  /^(windowsterminal|wt|cmd|powershell|pwsh|windowssystem32|conhost|wezterm|alacritty|hyper|cursorterminal|code)$/i;

function isTerminalProcess(name) {
  return TERMINAL_RE.test(String(name || '').replace(/\.exe$/i, ''));
}

/**
 * 仅当焦点在可编辑控件上才允许弹条。
 * @param {{proc?:string,focusClass?:string,fgClass?:string,hasFocus?:boolean}|null} info
 */
function isEditableFocus(info) {
  if (!info) return false;
  const focusClass = String(info.focusClass || '');
  const fgClass = String(info.fgClass || '');
  if (HOST_DENY_RE.test(focusClass) || HOST_DENY_RE.test(fgClass)) return false;
  if (EDITABLE_FOCUS_RE.test(focusClass)) return true;
  // 浏览器/Electron 主窗类无法区分只读正文与输入框 → 默认不弹
  return false;
}

function shouldShowPalette({ processName, focus, enabled, recording, userCopyAt, now }) {
  if (enabled === false) return { ok: false, reason: 'disabled' };
  if (recording) return { ok: false, reason: 'recording' };
  if (userCopyAt && now - userCopyAt < 500) return { ok: false, reason: 'user-copy' };
  if (isTerminalProcess(processName)) return { ok: false, reason: 'terminal' };
  if (!isEditableFocus(focus)) return { ok: false, reason: 'non-input' };
  return { ok: true, reason: 'ok' };
}

module.exports = {
  isTerminalProcess,
  isEditableFocus,
  shouldShowPalette,
  EDITABLE_FOCUS_RE,
  HOST_DENY_RE,
  TERMINAL_RE
};
