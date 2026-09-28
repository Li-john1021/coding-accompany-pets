// palette-gate.js — 选中浮条限源纯逻辑（可单测，不依赖 electron）
//
// 判定顺序：总开关 → 录音/复制意图 → 终端 → 可编辑且非只读。

const HOST_DENY_RE =
  /^(progman|workerw|cabinetwclass|shell_traywnd|shell_sectraywnd|dv2controlhost|#32768|multitaskingviewframe)$/i;

const TERMINAL_RE =
  /^(windowsterminal|wt|cmd|powershell|pwsh|windowssystem32|conhost|wezterm|alacritty|hyper)$/i;

// Win32 / WinForms 等可编辑控件类（词边界 + contains-EDIT 两套）
const EDITABLE_CLASS_RE =
  /^(edit|richedit.*|scintilla|avalonedit|tsynedit|tedit|tcomboboxex32)$/i;
const EDITABLE_CLASS_CONTAINS_RE = /(\bedit\b|^windowsforms10\.edit|\.edit\.)/i;
// Chromium/Electron 内嵌输入框宿主（需结合 UIA/只读再判定）
const WEB_HOST_RE = /^(chrome_widgetwin_\d+|chrome_renderwidgethosthwnd|electron|window\.webview|wpfgfx_win32)/i;

// UIA ControlType（Win32）：Edit=50004, Document=50030, Text=50027
const UIA_EDITABLE_TYPES = new Set([50004]);

function isTerminalProcess(name) {
  return TERMINAL_RE.test(String(name || '').replace(/\.exe$/i, ''));
}

function isEditableClassName(cls) {
  const c = String(cls || '');
  return EDITABLE_CLASS_RE.test(c) || EDITABLE_CLASS_CONTAINS_RE.test(c);
}

/**
 * @param {null|{
 *   proc?: string,
 *   focusClass?: string,
 *   fgClass?: string,
 *   hasFocus?: boolean,
 *   readOnly?: boolean,
 *   uiaType?: number,
 *   uiaReadOnly?: boolean
 * }} info
 */
function isEditableFocus(info) {
  if (!info) return false;
  if (info.readOnly === true || info.uiaReadOnly === true) return false;

  const focusClass = String(info.focusClass || '');
  const fgClass = String(info.fgClass || '');

  // 桌面 / 资源管理器 / 系统菜单：永不弹
  if (HOST_DENY_RE.test(focusClass) || HOST_DENY_RE.test(fgClass)) return false;

  // UIA：焦点元素是 Edit/Text/Document 且未只读
  if (info.uiaType != null && UIA_EDITABLE_TYPES.has(Number(info.uiaType))) {
    return info.uiaReadOnly !== true;
  }

  // Win32 类名
  if (isEditableClassName(focusClass)) return true;

  // Chromium/Electron 宿主：UIA 认为是 Edit 才放行（避免只读正文误弹）
  if (WEB_HOST_RE.test(focusClass) || WEB_HOST_RE.test(fgClass)) {
    return Number(info.uiaType) === 50004 && info.uiaReadOnly !== true;
  }

  return false;
}

const OUR_PROC_RE = /^(electron|voice2prompt|v2p)$/i;

function isOurUiDrag(processName, focus) {
  if (OUR_PROC_RE.test(String(processName || '').replace(/\.exe$/i, ''))) {
    // 自家进程：只有明确的输入控件才可弹（设置页文本框）；拖宠/拖窗/点按钮不弹
    return !isEditableFocus(focus);
  }
  return false;
}

function shouldShowPalette({ processName, focus, enabled, recording, userCopyAt, now }) {
  if (enabled === false) return { ok: false, reason: 'disabled' };
  if (recording) return { ok: false, reason: 'recording' };
  if (userCopyAt && now - userCopyAt < 500) return { ok: false, reason: 'user-copy' };
  // 自家 UI 拖拽（桌宠/浮条/设置窗等）禁止弹条
  if (isOurUiDrag(processName, focus)) return { ok: false, reason: 'our-ui' };
  // 其它场景全开放（2026-09-28 拍板）
  return { ok: true, reason: 'ok' };
}

module.exports = {
  isOurUiDrag,
  OUR_PROC_RE,
  WEB_HOST_RE,
  isTerminalProcess,
  isEditableFocus,
  isEditableClassName,
  shouldShowPalette,
  EDITABLE_CLASS_RE,
  EDITABLE_CLASS_CONTAINS_RE,
  HOST_DENY_RE,
  TERMINAL_RE,
  UIA_EDITABLE_TYPES
};
