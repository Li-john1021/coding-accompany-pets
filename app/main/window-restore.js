'use strict';

// Windows/Electron quirk: a non-focusable BrowserWindow that is hidden and
// shown again stops receiving mousedown until its real size changes (mousemove
// and wheel keep arriving). The pet window is focusable:false so pasting does
// not steal focus, which means it never recovers through activation and stays
// undraggable after every screenshot. Nudge the height by one pixel, then put
// it back after the window has processed the resize; the content is anchored to
// the top so the extra transparent row is not visible.

const NUDGE_PX = 1;
const SETTLE_MS = 160;
const pending = new WeakMap();

function settleNow(win, entry) {
  clearTimeout(entry.timer);
  pending.delete(win);
  try {
    const current = win.getBounds();
    if (current.width !== entry.nudged.width || current.height !== entry.nudged.height) return;
    win.setBounds({ ...current, width: entry.bounds.width, height: entry.bounds.height });
  } catch { /* the window may be gone */ }
}

function showAndStabilize(win, options = {}) {
  if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) return false;
  const previous = pending.get(win);
  if (previous) settleNow(win, previous);
  win.show();
  let focusable = true;
  try { focusable = typeof win.isFocusable === 'function' ? win.isFocusable() : true; } catch { focusable = true; }
  if (focusable) return false;
  if (typeof win.getBounds !== 'function' || typeof win.setBounds !== 'function') return false;
  let bounds;
  try { bounds = win.getBounds(); } catch { return false; }
  if (!bounds || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return false;
  const nudge = Number.isFinite(options.nudgePx) ? Math.max(1, Math.round(options.nudgePx)) : NUDGE_PX;
  const settleMs = Number.isFinite(options.settleMs) ? Math.max(0, options.settleMs) : SETTLE_MS;
  const nudged = { ...bounds, height: bounds.height + nudge };
  try { win.setBounds(nudged); } catch { return false; }
  const timer = setTimeout(() => {
    pending.delete(win);
    try {
      if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return;
      const current = win.getBounds();
      if (current.width !== nudged.width || current.height !== nudged.height) return;
      win.setBounds({ ...current, width: bounds.width, height: bounds.height });
    } catch { /* the window may be gone */ }
  }, settleMs);
  if (typeof timer.unref === 'function') timer.unref();
  pending.set(win, { timer, bounds, nudged });
  return true;
}

module.exports = { showAndStabilize, NUDGE_PX, SETTLE_MS };