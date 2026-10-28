'use strict';

const ZH_CN = {
  magnifier_position_label: '位置',
  operation_ok_title: '完成',
  operation_cancel_title: '取消',
  operation_save_title: '保存',
  operation_redo_title: '重做',
  operation_undo_title: '撤销',
  operation_mosaic_title: '马赛克',
  operation_text_title: '文字',
  operation_brush_title: '画笔',
  operation_arrow_title: '箭头',
  operation_ellipse_title: '椭圆',
  operation_rectangle_title: '矩形'
};

const DEFAULT_CAPTURE_TIMEOUT_MS = 60000;

function createScreenshotLibrary(options = {}) {
  const electron = options.electron || require('electron');
  const Screenshots = options.Screenshots || require('electron-screenshots');
  const { BrowserWindow, clipboard, nativeImage } = electron;
  const dialog = options.dialog || electron.dialog;
  const fs = options.fs || require('fs');
  const defaultTimeout = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_CAPTURE_TIMEOUT_MS;
  const trace = (...args) => { if (process.env.V2P_LIB_TRACE === '1') console.log('[screenshot-library]', ...args); };
  let instance = null;
  let pending = null;
  let settling = false;

  function restore(state) {
    for (const win of state.visible) {
      try { if (!win.isDestroyed()) win.show(); } catch { /* window may be gone */ }
    }
  }

  function armTimer(state) {
    clearTimeout(state.timer);
    const timeout = Number.isFinite(state.timeoutMs) ? state.timeoutMs : defaultTimeout;
    state.timer = setTimeout(() => failPending(new Error('截图界面未响应')), timeout);
  }

  function settle(result) {
    const state = pending;
    if (!state) return;
    pending = null;
    clearTimeout(state.timer);
    trace('settle', result);
    if (state.onAbort) state.signal.removeEventListener('abort', state.onAbort);
    restore(state);
    state.resolve(result);
  }

  function endAndSettle(result) {
    if (!pending || settling) return;
    settling = true;
    trace('endAndSettle', result);
    const shots = instance;
    Promise.resolve(shots ? shots.endCapture() : null).catch(() => {}).finally(() => {
      settling = false;
      settle(result);
    });
  }

  function onOk(event, buffer) {
    if (!pending || settling) { event.preventDefault(); return; }
    event.preventDefault();
    try {
      const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
      const image = nativeImage.createFromBuffer(bytes);
      if (image.isEmpty()) throw new Error('截图图像为空');
      const size = image.getSize();
      if (!size || !size.width || !size.height) throw new Error('截图尺寸无效');
      clipboard.writeImage(image);
      endAndSettle({ ok: true, width: size.width, height: size.height });
    } catch (error) {
      endAndSettle({ ok: false, reason: 'capture-failed', error: String(error.message || error).slice(0, 200) });
    }
  }

  function onCancel(event) {
    if (!pending || settling) { event.preventDefault(); return; }
    event.preventDefault();
    endAndSettle({ ok: false, reason: 'cancelled' });
  }

  function onSave(event, buffer) {
    if (!pending || settling || pending.saving) { event.preventDefault(); return; }
    event.preventDefault();
    const state = pending;
    state.saving = true;
    clearTimeout(state.timer);
    const parent = instance?.$win && !instance.$win.isDestroyed() ? instance.$win : undefined;
    try { parent?.setAlwaysOnTop(false); } catch { /* optional */ }
    const restoreTop = () => { try { parent?.setAlwaysOnTop(true); } catch { /* optional */ } };
    let save;
    try {
      save = dialog.showSaveDialog(parent, {
        defaultPath: `screenshot-${Date.now()}.png`,
        filters: [{ name: 'PNG image', extensions: ['png'] }]
      });
    } catch (error) {
      restoreTop();
      failPending(error);
      return;
    }
    Promise.resolve(save).then(({ canceled, filePath } = {}) => {
      if (pending !== state) return;
      if (canceled || !filePath) {
        state.saving = false;
        return;
      }
      try {
        const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
        const image = nativeImage.createFromBuffer(bytes);
        if (image.isEmpty()) throw new Error('截图图像为空');
        fs.writeFileSync(filePath, image.toPNG());
      } catch (error) {
        failPending(error);
        return;
      }
      endAndSettle({ ok: false, reason: 'cancelled', saved: true });
    }).catch((error) => { if (pending === state) failPending(error); }).finally(restoreTop);
  }

  function failPending(error) {
    trace('failPending', String(error.message || error));
    endAndSettle({ ok: false, reason: 'capture-failed', error: String(error.message || error).slice(0, 200) });
  }

  function ensureInstance() {
    if (instance) return instance;
    instance = new Screenshots({ singleWindow: true, lang: ZH_CN });
    if (typeof options.captureImage === 'function') {
      instance.capture = (display) => options.captureImage(display);
    }
    instance.on('ok', onOk);
    instance.on('cancel', onCancel);
    instance.on('save', onSave);
    instance.on('windowCreated', (win) => {
      trace('windowCreated', win.getTitle(), win.isVisible());
      win.once?.('closed', () => { if (pending && !settling) failPending(new Error('截图窗口已关闭')); });
    });
    instance.on('windowClosed', () => { if (pending && !settling) failPending(new Error('截图窗口已关闭')); });
    return instance;
  }

  async function revealWhenPainted() {
    let ready = false;
    try {
      const state = await instance.$view.webContents.executeJavaScript(`(async () => {
        const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        for (let attempt = 0; attempt < 80; attempt++) {
          const image = document.querySelector('.screenshots-background-image');
          if (image && image.complete && image.naturalWidth > 0) return 'image';
          if (document.querySelector('.screenshots')) {
            await nextFrame();
            return 'root';
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return '';
      })()`);
      ready = !!state;
      trace('reveal state', state);
    } catch { ready = false; }
    if (!ready) {
      trace('reveal failed');
      failPending(new Error('截图界面未就绪'));
      return;
    }
    if (pending) clearTimeout(pending.timer);
  }

  function capture(options = {}) {
    trace('capture start', !!pending, options.signal?.aborted);
    if (pending || settling) return Promise.reject(new Error('截图已在进行'));
    if (options.signal?.aborted) return Promise.resolve({ ok: false, reason: 'cancelled' });
    const visible = BrowserWindow.getAllWindows().filter((win) =>
      !win.isDestroyed() && win.isVisible() && win.getTitle() !== 'screenshots');
    for (const win of visible) { try { win.hide(); } catch { /* window may be gone */ } }
    return new Promise((resolve) => {
      const state = { resolve, visible, timeoutMs: options.timeoutMs };
      pending = state;
      if (options.signal) {
        state.signal = options.signal;
        state.onAbort = () => endAndSettle({ ok: false, reason: 'cancelled' });
        options.signal.addEventListener('abort', state.onAbort, { once: true });
      }
      armTimer(state);
      try {
        const shots = ensureInstance();
        trace('startCapture begin');
        shots.startCapture().then(() => { trace('startCapture resolved'); return revealWhenPainted(); }).catch(failPending);
      } catch (error) {
        failPending(error);
      }
    });
  }

  function warm() {
    try { ensureInstance(); return true; } catch { return false; }
  }

  function dispose() {
    try { instance?.endCapture(); } catch { /* ignore */ }
  }

  return { capture, warm, dispose };
}

module.exports = { createScreenshotLibrary };