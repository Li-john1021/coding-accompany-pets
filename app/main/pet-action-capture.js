const { randomUUID } = require('crypto');
const { runPowerShellFile } = require('./powershell-file');
const { buildNativeEditPowerShell } = require('./win32-edit');

const CAPTURE_WINDOW_MS = 1200;
const MANUAL_COPY_WINDOW_MS = 10000;
const PREVIEW_TTL_MS = 10000;
const POLL_INTERVAL_MS = 180;
const HOSTS = Object.freeze({
  ORDINARY: 'ordinary_non_terminal',
  WINDOWS_TERMINAL: 'windows_terminal',
  CONHOST: 'conhost',
  VSCODE: 'vscode',
  UNKNOWN_TERMINAL: 'unknown_terminal',
  UNKNOWN: 'unknown'
});

function buildSnapshotScript() {
  return `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
${buildNativeEditPowerShell()}
Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;
public static class V2PClipboardSequence {
  [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
}
"@ -ErrorAction Stop
$hwnd = [V2PNativeEdit]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) { throw 'foreground unavailable' }
$ownerProcessId = [V2PNativeEdit]::ProcessId($hwnd)
$thread = [V2PNativeEdit]::ThreadId($hwnd)
$windowClassName = [V2PNativeEdit]::ClassName($hwnd)
$info = [V2PNativeEdit+GUITHREADINFO]::new()
$info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
if (-not [V2PNativeEdit]::GetGUIThreadInfo($thread, [ref]$info)) { throw 'focus unavailable' }
$focusedWindow = $info.hwndFocus
$focusClassName = if ($focusedWindow -eq [IntPtr]::Zero) { '' } else { [V2PNativeEdit]::ClassName($focusedWindow) }
$process = (Get-Process -Id $ownerProcessId -ErrorAction Stop).ProcessName
@{ ok = $true; hwnd = $hwnd.ToInt64(); pid = $ownerProcessId; threadId = $thread; windowClass = $windowClassName; focusHwnd = $focusedWindow.ToInt64(); focusClass = $focusClassName; processName = $process; sequence = [V2PClipboardSequence]::GetClipboardSequenceNumber() } | ConvertTo-Json -Compress
`;
}

function parseSnapshot(stdout) {
  try {
    const value = JSON.parse(String(stdout || '').trim().split(/\r?\n/).pop());
    if (!value || value.ok !== true || !Number.isSafeInteger(value.hwnd) || value.hwnd <= 0 ||
        !Number.isInteger(value.pid) || value.pid <= 0 || !Number.isInteger(value.threadId) || value.threadId <= 0 ||
        !Number.isSafeInteger(value.sequence) || value.sequence < 0 || typeof value.processName !== 'string' || !value.processName ||
        typeof value.windowClass !== 'string' || typeof value.focusClass !== 'string') return null;
    const target = {
      hwnd: value.hwnd, pid: value.pid, threadId: value.threadId,
      windowClass: value.windowClass, focusHwnd: Number(value.focusHwnd) || 0,
      focusClass: value.focusClass, processName: value.processName
    };
    return { target, sequence: value.sequence };
  } catch { return null; }
}

function getWindowsSnapshot() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((resolve) => runPowerShellFile(buildSnapshotScript(), { timeout: 1600, maxBuffer: 64 * 1024 },
    (error, stdout) => resolve(error ? null : parseSnapshot(stdout))));
}

function sameTarget(a, b) {
  return !!a && !!b && a.hwnd === b.hwnd && a.pid === b.pid && a.threadId === b.threadId &&
    a.focusHwnd === b.focusHwnd && a.windowClass === b.windowClass && a.focusClass === b.focusClass &&
    a.processName === b.processName;
}

function classifyHost(target) {
  if (!target) return HOSTS.UNKNOWN;
  const proc = target.processName.toLowerCase();
  const cls = target.windowClass.toLowerCase();
  const focus = target.focusClass.toLowerCase();
  if (cls === 'consolewindowclass' || proc === 'conhost') return HOSTS.CONHOST;
  if (cls.includes('cascadia_hosting_window_class') || proc === 'windowsterminal') return HOSTS.WINDOWS_TERMINAL;
  if (proc === 'code' || proc === 'code - insiders') return HOSTS.VSCODE;
  if (/(terminal|termcontrol|xterm|pty|console)/i.test(focus) || /(terminal|termcontrol|xterm|pty)/i.test(cls)) return HOSTS.UNKNOWN_TERMINAL;
  if (/^(notepad|notepad\+\+|wordpad|winword|excel|powerpnt)$/i.test(target.processName)) return HOSTS.ORDINARY;
  return HOSTS.UNKNOWN;
}

function buildNativeSelectionScript(target) {
  return `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
${buildNativeEditPowerShell()}
$hwnd = [IntPtr]${target.focusHwnd}
$ownerProcessId = [uint32]${target.pid}
$thread = [uint32]${target.threadId}
$parent = [V2PNativeEdit]::GetParent($hwnd)
$id = [V2PNativeEdit]::GetDlgCtrlID($hwnd)
try {
  if ([V2PNativeEdit]::ClassName($hwnd) -cne 'Edit' -or
      -not [V2PNativeEdit]::IsFocusedTarget($hwnd, $ownerProcessId, $thread, $parent, $id)) { throw 'not focused Edit' }
  $selection = [V2PNativeEdit]::ReadSelection($hwnd)
  if (-not [V2PNativeEdit]::IsFocusedTarget($hwnd, $ownerProcessId, $thread, $parent, $id)) { throw 'target changed' }
  @{ ok = $true; text = $selection.Text; start = $selection.Start; end = $selection.End; hwnd = $hwnd.ToInt64(); parent = $parent.ToInt64(); controlId = $id } | ConvertTo-Json -Compress
} catch { @{ ok = $false } | ConvertTo-Json -Compress }
`;
}

function probeNativeSelection(target) {
  if (!target || !target.focusHwnd) return Promise.resolve(null);
  return new Promise((resolve) => runPowerShellFile(buildNativeSelectionScript(target), { timeout: 1200, maxBuffer: 128 * 1024 },
    (error, stdout) => {
      try {
        const result = JSON.parse(String(stdout || '').trim().split(/\r?\n/).pop());
        resolve(!error && result && result.ok === true && typeof result.text === 'string' && result.text.trim().length > 0 &&
          Number.isInteger(result.start) && result.end > result.start && result.end - result.start === result.text.length
          ? { text: result.text, control: { hwnd: result.hwnd, parent: result.parent, id: result.controlId, start: result.start, end: result.end } }
          : null);
      } catch { resolve(null); }
    }));
}

function createWindowsAdapters() {
  return {
    platform: process.platform,
    snapshot: getWindowsSnapshot,
    probeSelection: probeNativeSelection,
    readClipboard: () => {
      const { clipboard } = require('electron');
      return { text: clipboard.readText(), formats: clipboard.availableFormats() };
    },
    sendOrdinaryCopy: () => {
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      uIOhook.keyTap(UiohookKey.C, [UiohookKey.Ctrl]);
    },
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  };
}

function makeResult(kind, reason, extra = {}) {
  return { kind, reason: reason || null, ...extra };
}

function createPetActionCapture(adapters, options = {}) {
  const ttlMs = options.previewTtlMs || PREVIEW_TTL_MS;
  const captureWindowMs = options.captureWindowMs || CAPTURE_WINDOW_MS;
  const manualWindowMs = options.manualWindowMs || MANUAL_COPY_WINDOW_MS;
  const pollMs = options.pollMs || POLL_INTERVAL_MS;
  const monitorPending = options.monitorPending !== false;
  let pending = null;
  let busy = false;
  let generation = 0;

  function cancel(reason) {
    const hadPending = !!pending;
    pending = null;
    generation++;
    if (hadPending && typeof options.onCancel === 'function') options.onCancel(reason || 'cancelled');
    return hadPending;
  }

  function monitor(token, isVoiceBusy) {
    if (!monitorPending) return;
    const run = async () => {
      while (pending && pending.token === token) {
        const remaining = pending.expiresAt - adapters.now();
        if (remaining <= 0) { cancel('expired'); return; }
        await adapters.sleep(Math.min(pollMs, remaining));
        if (!pending || pending.token !== token) return;
        if (isVoiceBusy()) { cancel('voice-busy'); return; }
        try {
          const current = await adapters.snapshot();
          if (!current || !sameTarget(current.target, pending.target)) { cancel('target-changed'); return; }
          if (current.sequence !== pending.sequence) { cancel('clipboard-changed'); return; }
        } catch { cancel('target-unavailable'); return; }
      }
    };
    run().catch(() => cancel('capture-monitor-failed'));
  }

  async function click(mode, voiceBusy) {
    const isVoiceBusy = () => typeof voiceBusy === 'function' ? !!voiceBusy() : !!voiceBusy;
    if (isVoiceBusy()) { cancel('voice-busy'); return makeResult('rejected', 'voice-busy'); }
    if (mode !== 'structure' && mode !== 'optimize') return makeResult('rejected', 'unsupported-mode');
    if (busy) return makeResult('rejected', 'capture-in-progress');
    if (pending) {
      if (pending.mode !== mode) {
        cancel('mode-changed');
        return makeResult('cancelled', 'mode-changed');
      }
      if (adapters.now() >= pending.expiresAt) { cancel('expired'); return makeResult('cancelled', 'expired'); }
      const candidate = pending;
      busy = true;
      try {
        const current = await adapters.snapshot();
        if (pending !== candidate) return makeResult('cancelled', 'cancelled');
        if (adapters.now() >= candidate.expiresAt) { cancel('expired'); return makeResult('cancelled', 'expired'); }
        if (!current || !sameTarget(current.target, candidate.target)) { cancel('target-changed'); return makeResult('cancelled', 'target-changed'); }
        if (current.sequence !== candidate.sequence) { cancel('clipboard-changed'); return makeResult('cancelled', 'clipboard-changed'); }
        if (isVoiceBusy()) { cancel('voice-busy'); return makeResult('cancelled', 'voice-busy'); }
        const authorized = { mode: candidate.mode, text: candidate.text, token: candidate.token, target: candidate.target,
          clipboardSequence: candidate.sequence, evidence: candidate.evidence };
        pending = null;
        generation++;
        return makeResult('authorized', null, authorized);
      } finally { busy = false; }
    }
    busy = true;
    const operationGeneration = generation;
    const wasCancelled = () => generation !== operationGeneration;
    try {
      if (adapters.platform !== 'win32') return makeResult('rejected', 'unsupported-platform');
      const before = await adapters.snapshot();
      if (wasCancelled()) return makeResult('cancelled', 'voice-busy');
      if (!before) return makeResult('rejected', 'target-unavailable');
      const proof = await adapters.probeSelection(before.target);
      if (wasCancelled()) return makeResult('cancelled', 'voice-busy');
      const afterProbe = await adapters.snapshot();
      if (wasCancelled()) return makeResult('cancelled', 'voice-busy');
      if (!afterProbe || !sameTarget(before.target, afterProbe.target) || before.sequence !== afterProbe.sequence) {
        return makeResult('rejected', 'target-or-clipboard-changed');
      }
      if (proof && typeof proof.text === 'string' && proof.text.trim().length > 0) {
        return makeResult('authorized', null, { mode, text: proof.text, token: randomUUID(),
          target: afterProbe.target, clipboardSequence: afterProbe.sequence,
          evidence: { type: 'proven-win32-edit-selection', control: proof.control } });
      }

      const host = classifyHost(before.target);
      const manual = host !== HOSTS.ORDINARY;
      const waitMs = manual ? manualWindowMs : captureWindowMs;
      if (manual && typeof options.onManualCopyRequired === 'function') options.onManualCopyRequired(host);
      if (!manual) {
        try { adapters.sendOrdinaryCopy(); }
        catch { return makeResult('rejected', 'copy-request-failed', { host }); }
      }
      const deadline = adapters.now() + waitMs;
      let observed = null;
      while (adapters.now() < deadline) {
        if (wasCancelled()) return makeResult('cancelled', 'voice-busy', { host });
        if (isVoiceBusy()) return makeResult('cancelled', 'voice-busy', { host });
        await adapters.sleep(Math.min(pollMs, Math.max(1, deadline - adapters.now())));
        const current = await adapters.snapshot();
        if (!current || !sameTarget(before.target, current.target)) return makeResult('cancelled', 'target-changed', { host });
        if (current.sequence !== before.sequence) {
          const value = adapters.readClipboard();
          if (current.sequence !== before.sequence && value && typeof value.text === 'string' && value.text.trim().length > 0) {
            observed = { text: value.text, sequence: current.sequence };
            break;
          }
          return makeResult('rejected', value && value.text ? 'empty-or-invalid-text' : 'empty-or-non-text-clipboard', { host });
        }
      }
      if (!observed) return makeResult('rejected', 'no-fresh-clipboard', { host });
      const finalSnapshot = await adapters.snapshot();
      if (wasCancelled()) return makeResult('cancelled', 'voice-busy', { host });
      if (!finalSnapshot || !sameTarget(before.target, finalSnapshot.target) || finalSnapshot.sequence !== observed.sequence) {
        return makeResult('cancelled', 'target-or-clipboard-changed', { host });
      }
      const token = randomUUID();
      pending = { mode, text: observed.text, token, target: finalSnapshot.target, sequence: finalSnapshot.sequence,
        expiresAt: adapters.now() + ttlMs, evidence: { type: 'fresh-clipboard-unverified', host } };
      generation++;
      monitor(token, isVoiceBusy);
      return makeResult('preview', 'selection-unverified', { mode, text: observed.text, token, target: finalSnapshot.target,
        clipboardSequence: finalSnapshot.sequence, expiresAt: pending.expiresAt, evidence: pending.evidence,
        hint: manual ? '请手动复制后，再点同一按钮确认' : '选区未验证，再点同一按钮确认' });
    } finally { busy = false; }
  }

  return { click, cancel, get pending() { return pending ? { ...pending } : null; }, get busy() { return busy; } };
}

module.exports = { CAPTURE_WINDOW_MS, MANUAL_COPY_WINDOW_MS, PREVIEW_TTL_MS, HOSTS, buildSnapshotScript,
  parseSnapshot, sameTarget, classifyHost, buildNativeSelectionScript, getWindowsSnapshot, probeNativeSelection,
  createWindowsAdapters, createPetActionCapture };
