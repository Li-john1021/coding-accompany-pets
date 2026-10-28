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

function createScreenshotLibrary(options = {}) {
  const electron = options.electron || require('electron');
  const Screenshots = options.Screenshots || require('electron-screenshots');
  const { BrowserWindow, clipboard, nativeImage } = electron;
  let instance = null;
  let pending = null;

  function restore(state) {
    for (const win of state.visible) {
      try { if (!win.isDestroyed()) win.show(); } catch { /* window may be gone */ }
    }
  }

  function settle(result) {
    const state = pending;
    if (!state) return;
    pending = null;
    if (state.onAbort) state.signal.removeEventListener('abort', state.onAbort);
    restore(state);
    state.resolve(result);
  }

  function endAndSettle(result) {
    const shots = instance;
    Promise.resolve(shots ? shots.endCapture() : null).catch(() => {}).finally(() => settle(result));
  }

  function onOk(event, buffer) {
    if (!pending) return;
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
    if (!pending) return;
    event.preventDefault();
    endAndSettle({ ok: false, reason: 'cancelled' });
  }

  function failPending(error) {
    endAndSettle({ ok: false, reason: 'capture-failed', error: String(error.message || error).slice(0, 200) });
  }

  function ensureInstance() {
    if (instance) return instance;
    instance = new Screenshots({ singleWindow: true, lang: ZH_CN });
    instance.on('ok', onOk);
    instance.on('cancel', onCancel);
    return instance;
  }

  function capture(options = {}) {
    if (pending) return Promise.reject(new Error('截图已在进行'));
    if (options.signal?.aborted) return Promise.resolve({ ok: false, reason: 'cancelled' });
    const visible = BrowserWindow.getAllWindows().filter((win) =>
      !win.isDestroyed() && win.isVisible() && win.getTitle() !== 'screenshots');
    for (const win of visible) { try { win.hide(); } catch { /* window may be gone */ } }
    return new Promise((resolve) => {
      const state = { resolve, visible };
      pending = state;
      if (options.signal) {
        state.signal = options.signal;
        state.onAbort = () => endAndSettle({ ok: false, reason: 'cancelled' });
        options.signal.addEventListener('abort', state.onAbort, { once: true });
      }
      try { ensureInstance().startCapture().catch(failPending); }
      catch (error) { failPending(error); }
    });
  }

  function dispose() {
    try { instance?.endCapture(); } catch { /* ignore */ }
  }

  return { capture, dispose };
}

module.exports = { createScreenshotLibrary };