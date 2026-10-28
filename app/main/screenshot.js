const geometry = require('./screenshot-geometry');

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

function createScreenshotController(adapters) {
  let active = null;
  let disposed = false;
  let sequence = 0;

  function start({ signal } = {}) {
    if (disposed) return Promise.resolve({ ok: false, reason: 'disposed' });
    if (signal?.aborted) return Promise.resolve({ ok: false, reason: 'cancelled' });
    if (active) {
      const current = active;
      if (signal && !signal.aborted) {
        const abort = () => { current.abortController.abort(); current.resolve?.({ ok: false, reason: 'cancelled' }); };
        signal.addEventListener('abort', abort, { once: true });
        current.promise.finally(() => signal.removeEventListener('abort', abort));
      }
      return current.promise;
    }
    const token = `shot-${++sequence}`;
    const abortController = new AbortController();
    const session = { token, abortController, windows: [], senderIds: new Set(), visible: [], settled: false };
    active = session;
    const onAbort = () => {
      abortController.abort();
      session.resolve?.({ ok: false, reason: 'cancelled' });
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    session.removeAbortListener = () => signal?.removeEventListener('abort', onAbort);
    session.promise = run(session).finally(() => { if (active === session) active = null; });
    session.promise.token = token;
    session.promise.signal = abortController.signal;
    session.promise.cancel = onAbort;
    return session.promise;
  }

  async function run(session) {
    try {
      session.visible = adapters.getAppWindows().filter((win) => !win.isDestroyed() && win.isVisible());
      for (const win of session.visible) win.hide();
      const displays = adapters.getDisplays().map((display) => ({
        id: String(display.id), bounds: { ...display.bounds }, scaleFactor: display.scaleFactor || 1,
        pixelWidth: Math.ceil(display.bounds.width * (display.scaleFactor || 1)),
        pixelHeight: Math.ceil(display.bounds.height * (display.scaleFactor || 1))
      }));
      const captures = await adapters.captureScreens(displays);
      if (session.abortController.signal.aborted) return { ok: false, reason: 'cancelled' };
      const byId = new Map(captures.map((capture) => [String(capture.id), capture]));
      const screens = displays.map((display) => {
        const capture = byId.get(display.id);
        if (!capture || !capture.dataUrl || !capture.pixelWidth || !capture.pixelHeight) throw new Error(`屏幕 ${display.id} 捕获失败`);
        return { ...display, selectionBounds: capture.selectionBounds || null,
          pixelWidth: capture.pixelWidth, pixelHeight: capture.pixelHeight, dataUrl: capture.dataUrl };
      });
      session.screens = screens;
      session.done = new Promise((resolve) => { session.resolve = resolve; });
      const selectorPayload = (screen) => ({
        token: session.token, screen,
        screens: screens.map(({ id, bounds, selectionBounds, pixelWidth, pixelHeight, dataUrl }) => ({ id, bounds, selectionBounds, pixelWidth, pixelHeight, dataUrl }))
      });
      const created = await Promise.allSettled(screens.map(async (screen) => {
        const win = await adapters.createSelector(selectorPayload(screen));
        session.windows.push(win);
        session.senderIds.add(win.webContents.id);
        const onClosed = () => { if (!session.settled) session.resolve?.({ ok: false, reason: 'cancelled' }); };
        session.closedHandlers ||= new Map();
        session.closedHandlers.set(win, onClosed);
        win.on?.('closed', onClosed);
        return win;
      }));
      const failure = created.find((outcome) => outcome.status === 'rejected');
      if (failure) throw failure.reason;
      if (session.abortController.signal.aborted) return { ok: false, reason: 'cancelled' };
      for (const win of session.windows) { win.show(); win.focus(); }
      const result = await session.done;
      if (session.abortController.signal.aborted) return { ok: false, reason: 'cancelled' };
      if (!result?.ok) return result || { ok: false, reason: 'cancelled' };
      if (result.dataUrl.length > 90 * 1024 * 1024) throw new Error('截图数据超出限制');
      const match = PNG_DATA_URL.exec(result.dataUrl || '');
      if (!match) throw new Error('截图 PNG 数据无效');
      const bytes = Buffer.from(match[1], 'base64');
      if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('截图 PNG 校验失败');
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      if (!width || !height || width > 16384 || height > 16384 || bytes.length > 64 * 1024 * 1024) throw new Error('截图尺寸超出限制');
      if (session.abortController.signal.aborted) return { ok: false, reason: 'cancelled' };
      adapters.writeImage(result.dataUrl);
      return { ok: true, width, height };
    } catch (error) {
      return { ok: false, reason: 'capture-failed', error: String(error.message || error).slice(0, 200) };
    } finally {
      session.settled = true;
      for (const win of session.windows) {
        try {
          const onClosed = session.closedHandlers?.get(win);
          if (onClosed) win.removeListener?.('closed', onClosed);
          if (adapters.releaseSelector) adapters.releaseSelector(win);
          else if (!win.isDestroyed()) win.destroy();
        } catch {}
      }
      for (const win of session.visible) { try { if (!win.isDestroyed()) win.show(); } catch {} }
      session.resolve?.({ ok: false, reason: 'cancelled' });
      session.removeAbortListener?.();
    }
  }

  function isTrusted(event) {
    if (!active || active.settled || !active.senderIds.has(event?.sender?.id)) return false;
    const frame = event.senderFrame;
    return !!frame && frame === event.sender.mainFrame && frame.url.startsWith('file:') && frame.url.endsWith('/screenshot.html');
  }

  function pointer(event, payload) {
    if (!isTrusted(event) || !payload || payload.token !== active.token) return false;
    if (active.expectedSize) return false;
    if (payload.type === 'down' && Number.isFinite(payload.x) && Number.isFinite(payload.y)) active.anchor = { x: payload.x, y: payload.y };
    else if (payload.type === 'move' && active.anchor && Number.isFinite(payload.x) && Number.isFinite(payload.y)) {
      const rect = geometry.normalizeRect(active.anchor, payload);
      for (const win of active.windows) if (!win.isDestroyed()) win.webContents.send('v2p:screenshot:selection', rect);
    } else if (payload.type === 'up' && active.anchor && Number.isFinite(payload.x) && Number.isFinite(payload.y)) {
      const selection = geometry.normalizeRect(active.anchor, payload);
      active.anchor = null;
      const geometryScreens = active.screens.map((screen) => ({ ...screen, bounds: screen.selectionBounds || screen.bounds }));
      if (!selection || !geometry.isSelectionWithinDisplays(selection, geometryScreens)) {
        active.resolve?.({ ok: false, reason: 'zero-area' });
        return true;
      }
      const plan = geometry.planComposition(selection, geometryScreens);
      if (!plan || plan.width > 16384 || plan.height > 16384 || plan.width * plan.height > 100000000) {
        active.resolve?.({ ok: false, reason: 'selection-too-large' });
        return true;
      }
      active.expectedSize = { width: plan.width, height: plan.height };
      active.composingSenderId = event.sender.id;
      event.sender.send('v2p:screenshot:compose', { token: active.token, selection, plan });
    }
    return true;
  }

  function cancel(event, payload) {
    if (!isTrusted(event) || payload?.token !== active.token) return false;
    active.abortController.abort();
    active.resolve?.({ ok: false, reason: 'cancelled' });
    return true;
  }

  function composed(event, payload) {
    if (!isTrusted(event) || payload?.token !== active.token || !active.resolve || !active.expectedSize ||
        event.sender.id !== active.composingSenderId) return false;
    if (payload?.ok && active.expectedSize && payload.dataUrl) {
      if (payload.dataUrl.length > 90 * 1024 * 1024) { active.resolve({ ok: false, reason: 'composition-failed' }); return true; }
      const match = PNG_DATA_URL.exec(payload.dataUrl);
      if (!match) { active.resolve({ ok: false, reason: 'composition-failed' }); return true; }
      const bytes = Buffer.from(match[1], 'base64');
      if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
          bytes.readUInt32BE(16) !== active.expectedSize.width || bytes.readUInt32BE(20) !== active.expectedSize.height) {
        active.resolve({ ok: false, reason: 'composition-failed' });
        return true;
      }
    }
    active.resolve(payload.ok && typeof payload.dataUrl === 'string' ? payload : { ok: false, reason: 'composition-failed' });
    return true;
  }

  function dispose() {
    disposed = true;
    if (!active) return;
    active.abortController.abort();
    active.resolve?.({ ok: false, reason: 'cancelled' });
  }

  return { capture: start, start, pointer, cancel, composed, dispose, isActive: () => !!active, getSignal: () => active?.abortController.signal || null,
    get busy() { return !!active; } };
}

module.exports = { createScreenshotController };
