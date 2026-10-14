const { randomUUID } = require('crypto');
const { sameTarget, classifyHost, HOSTS } = require('./pet-action-capture');
const { clampUndoSeconds } = require('./text-prompts');

function pasteChord(target, platform = process.platform) {
  const terminal = classifyHost(target) !== HOSTS.ORDINARY;
  if (platform === 'win32') return terminal ? 'shift-insert' : 'ctrl-v';
  if (platform === 'darwin') return 'cmd-v'; // Design only; not runtime validated.
  return terminal ? 'ctrl-shift-v' : 'ctrl-v'; // Design only.
}

// Only this closure holds source text. Renderers receive an opaque token and UI metadata.
function createResultDelivery(deps) {
  let latest = null;
  let timer = null;
  let watchTimer = null;
  let delivering = false;
  let undoing = null;
  let pendingDelivery = null;
  const now = deps.now || Date.now;
  function clear() {
    if (undoing && undoing.controller) undoing.controller.abort();
    if (timer) (deps.clearTimer || clearTimeout)(timer);
    timer = null;
    if (watchTimer) (deps.clearTimer || clearTimeout)(watchTimer);
    watchTimer = null;
    latest = null;
    if (deps.onHide) deps.onHide();
  }
  function markDirty() {
    if (pendingDelivery) pendingDelivery.dirty = true;
    if (latest && latest.armed) latest.dirty = true;
    if (undoing) {
      undoing.dirty = true;
      if (undoing.controller) undoing.controller.abort();
    }
  }
  function watchTarget(token, target) {
    if (!deps.watchTarget) return;
    watchTimer = (deps.setTimer || setTimeout)(async () => {
      const current = await deps.snapshot();
      if (!latest || latest.token !== token) return;
      if (!sameTarget(target, current && current.target)) latest.dirty = true;
      else if (!latest.dirty) watchTarget(token, target);
    }, 500);
    if (watchTimer && watchTimer.unref) watchTimer.unref();
  }
  async function deliver({ original, text, target, kind = 'selection', insertMode, undoToastSeconds, isCurrent = () => true }) {
    if (delivering || undoing) throw new Error('结果正在写入，请稍后重试');
    if (typeof text !== 'string' || !text.trim()) return { inserted: false, copiedOnly: true, empty: true };
    if (!isCurrent()) return { inserted: false, copiedOnly: true, cancelled: true };
    delivering = true;
    clear();
    try {
      await deps.writeClipboard(text);
      const op = { token: randomUUID(), original: String(original ?? ''), target, kind, inserted: false,
        terminal: classifyHost(target) !== HOSTS.ORDINARY, dirty: false, armed: false,
        expiresAt: now() + clampUndoSeconds(undoToastSeconds ?? 10) * 1000 };
      pendingDelivery = op;
      let note = '';
      if (insertMode === 'paste') {
        const current = await deps.snapshot();
        if (!isCurrent()) return { inserted: false, copiedOnly: true, cancelled: true };
        if (sameTarget(target, current && current.target) && current.target.readOnly !== true) {
          try {
            const sent = await deps.sendChord(pasteChord(target, deps.platform), target);
            op.inserted = sent === true || !!(sent && sent.sent);
            if (sent && typeof sent === 'object') {
              op.generation = sent.generation; op.sessionId = sent.sessionId;
              op.uncertainGuard = !Number.isSafeInteger(sent.generation) || typeof sent.sessionId !== 'string';
            }
          }
          catch { op.inserted = false; }
          // Native origin filtering preserves real input during the entire async paste.
          op.armed = op.inserted && !op.uncertainGuard && current.target.readOnly === false && deps.guardAvailable() === true;
          if (!op.inserted) note = '未自动粘贴，结果已复制';
        } else note = '目标已变化或不可写，结果已复制';
      }
      if (!isCurrent()) return { inserted: op.inserted, copiedOnly: !op.inserted, cancelled: true };
      latest = op;
      const seconds = clampUndoSeconds(undoToastSeconds ?? 10);
      op.expiresAt = now() + seconds * 1000;
      timer = (deps.setTimer || setTimeout)(() => { if (latest === op) clear(); }, seconds * 1000);
      if (timer && timer.unref) timer.unref();
      if (op.armed) watchTarget(op.token, target);
      if (deps.onShow) deps.onShow({ token: op.token, seconds, inserted: op.inserted, note });
      return { inserted: op.inserted, copiedOnly: !op.inserted, note };
    } finally { pendingDelivery = null; delivering = false; }
  }
  async function undo(token) {
    const op = latest;
    if (!op || token !== op.token || now() >= op.expiresAt) {
      if (op && now() >= op.expiresAt) clear();
      return { ok: false, note: '回退已过期或已被新结果替换' };
    }
    // Consume before awaiting: duplicate requests can never undo twice.
    clear();
    undoing = op;
    op.controller = new AbortController();
    try {
    await deps.writeClipboard(op.original);
    let restored = false;
    let uncertain = false;
    if (op.inserted && !op.terminal && op.armed && !op.dirty) {
      const current = await deps.snapshot();
      if (!op.dirty && sameTarget(op.target, current && current.target) && current.target.readOnly === false) {
        try {
          const sent = await deps.sendChord(op.kind === 'voice' ? 'voice-restore' : deps.platform === 'darwin' ? 'cmd-z' : 'ctrl-z', op.target,
            { signal: op.controller.signal, expectedGeneration: op.generation, sessionId: op.sessionId });
          restored = sent && typeof sent === 'object' ? !!sent.sent : sent === true && !op.controller.signal.aborted;
          uncertain = !!(sent && typeof sent === 'object' && !sent.sent && !['dirty', 'target-changed', 'guard-unavailable', 'metadata-error'].includes(sent.reason));
        }
        catch { uncertain = true; }
      }
    }
    const note = restored ? '已回退，原文已复制' : uncertain ? '未确认回退，原文已复制' : op.terminal ? '终端内容未修改，原文已复制' :
      op.inserted ? '目标未修改，原文已复制' : '原文已复制';
    return { ok: true, restored, copiedOnly: !restored, note };
    } finally { undoing = null; }
  }
  function dismiss(token) { if (latest && latest.token === token) clear(); }
  return { deliver, undo, dismiss, markDirty, clear, get busy() { return delivering || !!undoing; } };
}
module.exports = { createResultDelivery, pasteChord };
