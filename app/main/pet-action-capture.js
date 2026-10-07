const { randomUUID } = require('crypto');
const { runPowerShellFile } = require('./powershell-file');

const COPY_SETTLE_MS = 180;
const HOSTS = Object.freeze({
  ORDINARY: 'ordinary',
  WINDOWS_TERMINAL: 'windows_terminal',
  CONHOST: 'conhost',
  CONSOLE_FOCUS: 'console_focus',
  TERMINAL: 'terminal'
});

function buildSnapshotScript(includeClipboardText = false) {
  return `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
${includeClipboardText ? "Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop" : ''}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class V2PPetCaptureNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
  [StructLayout(LayoutKind.Sequential)] public struct GUITHREADINFO {
    public int cbSize; public int flags; public IntPtr hwndActive; public IntPtr hwndFocus;
    public IntPtr hwndCapture; public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize; public IntPtr hwndCaret;
    public RECT rcCaret;
  }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  public static string ClassName(IntPtr hwnd) { var b = new StringBuilder(256); GetClassName(hwnd, b, b.Capacity); return b.ToString(); }
}
"@ -ErrorAction Stop
$hwnd = [V2PPetCaptureNative]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { throw 'foreground unavailable' }
$pidValue = [uint32]0
$thread = [V2PPetCaptureNative]::GetWindowThreadProcessId($hwnd, [ref]$pidValue)
$info = [V2PPetCaptureNative+GUITHREADINFO]::new()
$info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
if (-not [V2PPetCaptureNative]::GetGUIThreadInfo($thread, [ref]$info)) { throw 'focus unavailable' }
$focus = $info.hwndFocus
$process = (Get-Process -Id $pidValue -ErrorAction Stop).ProcessName
${includeClipboardText ? `$sequenceBefore = [V2PPetCaptureNative]::GetClipboardSequenceNumber()
$text = [Windows.Forms.Clipboard]::GetText()
$sequenceAfter = [V2PPetCaptureNative]::GetClipboardSequenceNumber()
$text64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($text))
@{ ok = $true; hwnd = $hwnd.ToInt64(); pid = $pidValue; threadId = $thread; windowClass = [V2PPetCaptureNative]::ClassName($hwnd); focusHwnd = $focus.ToInt64(); focusClass = if ($focus -eq [IntPtr]::Zero) { '' } else { [V2PPetCaptureNative]::ClassName($focus) }; processName = $process; sequence = $sequenceAfter; stable = ($sequenceBefore -eq $sequenceAfter); text64 = $text64 } | ConvertTo-Json -Compress` : `@{ ok = $true; hwnd = $hwnd.ToInt64(); pid = $pidValue; threadId = $thread; windowClass = [V2PPetCaptureNative]::ClassName($hwnd); focusHwnd = $focus.ToInt64(); focusClass = if ($focus -eq [IntPtr]::Zero) { '' } else { [V2PPetCaptureNative]::ClassName($focus) }; processName = $process; sequence = [V2PPetCaptureNative]::GetClipboardSequenceNumber() } | ConvertTo-Json -Compress`}
`;
}

function parseSnapshot(stdout) {
  try {
    const value = JSON.parse(String(stdout || '').trim().split(/\r?\n/).pop());
    if (!value || value.ok !== true || !Number.isSafeInteger(value.hwnd) || value.hwnd <= 0 ||
        !Number.isInteger(value.pid) || value.pid <= 0 || !Number.isInteger(value.threadId) || value.threadId <= 0 ||
        !Number.isSafeInteger(value.sequence) || value.sequence < 0 || typeof value.processName !== 'string' || !value.processName ||
        typeof value.windowClass !== 'string' || typeof value.focusClass !== 'string') return null;
    const snapshot = { target: { hwnd: value.hwnd, pid: value.pid, threadId: value.threadId,
      windowClass: value.windowClass, focusHwnd: Number(value.focusHwnd) || 0,
      focusClass: value.focusClass, processName: value.processName }, sequence: value.sequence };
    if (typeof value.stable === 'boolean') snapshot.stable = value.stable;
    if (typeof value.text64 === 'string') snapshot.text = Buffer.from(value.text64, 'base64').toString('utf16le');
    return snapshot;
  } catch { return null; }
}

function getWindowsSnapshot(includeClipboardText = false) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => runPowerShellFile(buildSnapshotScript(includeClipboardText), { timeout: 2500, maxBuffer: 64 * 1024 },
    (error, stdout) => resolve(error ? null : parseSnapshot(stdout))));
}

function sameTarget(a, b) {
  return !!a && !!b && a.hwnd === b.hwnd && a.pid === b.pid && a.threadId === b.threadId &&
    a.focusHwnd === b.focusHwnd && a.windowClass === b.windowClass && a.focusClass === b.focusClass &&
    a.processName === b.processName;
}

function classifyHost(target) {
  if (!target) return HOSTS.ORDINARY;
  const process = target.processName.toLowerCase();
  const windowClass = target.windowClass.toLowerCase();
  const focusClass = target.focusClass.toLowerCase();
  if (windowClass === 'consolewindowclass' || process === 'conhost') return HOSTS.CONHOST;
  if (windowClass.includes('cascadia_hosting_window_class') || process === 'windowsterminal') return HOSTS.WINDOWS_TERMINAL;
  if (/^(mintty|wezterm-gui|alacritty|terminus|hyper|tabby)$/i.test(target.processName)) return HOSTS.TERMINAL;
  if (/(terminal|termcontrol|xterm|pty|console)/i.test(focusClass) || /(terminal|termcontrol|xterm|pty)/i.test(windowClass)) return HOSTS.CONSOLE_FOCUS;
  return HOSTS.ORDINARY;
}

function copyStrategy(target) {
  const host = classifyHost(target);
  return { host, key: host === HOSTS.WINDOWS_TERMINAL || host === HOSTS.CONHOST || host === HOSTS.CONSOLE_FOCUS ? 'insert' :
    host === HOSTS.TERMINAL ? 'terminal-copy' : 'copy' };
}

function sendWindowsCopy(strategy, keyTap, keys) {
  if (strategy.key === 'insert') keyTap(keys.Insert, [keys.Ctrl]);
  else if (strategy.key === 'terminal-copy') keyTap(keys.C, [keys.Ctrl, keys.Shift]);
  else keyTap(keys.C, [keys.Ctrl]);
}

function createWindowsAdapters() {
  return {
    platform: process.platform,
    snapshot: getWindowsSnapshot,
    readClipboard: () => {
      const { clipboard } = require('electron');
      return clipboard.readText();
    },
    sendCopy: (strategy) => {
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      sendWindowsCopy(strategy, (key, modifiers) => uIOhook.keyTap(key, modifiers), UiohookKey);
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  };
}

function makeResult(kind, reason, extra = {}) { return { kind, reason: reason || null, ...extra }; }

function createPetActionCapture(adapters) {
  let busy = false;
  let generation = 0;

  function cancel() { generation++; }

  async function click(mode, voiceBusy) {
    const isVoiceBusy = () => typeof voiceBusy === 'function' ? !!voiceBusy() : !!voiceBusy;
    if (isVoiceBusy()) return makeResult('rejected', 'voice-busy');
    if (mode !== 'structure' && mode !== 'optimize') return makeResult('rejected', 'unsupported-mode');
    if (busy) return makeResult('rejected', 'capture-in-progress');
    if (adapters.platform !== 'win32') return makeResult('rejected', 'unsupported-platform');

    busy = true;
    const operationGeneration = generation;
    const cancelled = () => generation !== operationGeneration || isVoiceBusy();
    try {
      const before = await adapters.snapshot();
      if (cancelled()) return makeResult('cancelled', 'voice-busy');
      if (!before) return makeResult('rejected', 'target-unavailable');
      const strategy = copyStrategy(before.target);
      try { adapters.sendCopy(strategy); }
      catch { return makeResult('rejected', 'copy-request-failed', { host: strategy.host }); }

      await adapters.sleep(COPY_SETTLE_MS);
      if (cancelled()) return makeResult('cancelled', 'voice-busy', { host: strategy.host });
      const after = await adapters.snapshot(true);
      if (!after || !sameTarget(before.target, after.target)) return makeResult('rejected', 'target-changed', { host: strategy.host });
      if (!after || after.sequence === before.sequence) return makeResult('rejected', 'no-fresh-clipboard', { host: strategy.host });
      if (after.stable === false) return makeResult('rejected', 'clipboard-changed', { host: strategy.host });
      const text = typeof after.text === 'string' ? after.text : adapters.readClipboard();
      if (typeof text !== 'string' || !text.trim()) return makeResult('rejected', 'empty-or-invalid-text', { host: strategy.host });
      const token = randomUUID();
      return makeResult('authorized', null, { mode, text, token, target: after.target,
        clipboardSequence: after.sequence, evidence: { type: 'fresh-clipboard', host: strategy.host } });
    } finally { busy = false; }
  }

  return { click, cancel, get busy() { return busy; } };
}

module.exports = { COPY_SETTLE_MS, HOSTS, buildSnapshotScript, parseSnapshot,
  sameTarget, classifyHost, copyStrategy, sendWindowsCopy, getWindowsSnapshot, createWindowsAdapters, createPetActionCapture };
