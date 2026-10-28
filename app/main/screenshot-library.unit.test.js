'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createScreenshotLibrary } = require('./screenshot-library');

const validationPng = fs.readFileSync(path.join(__dirname, 'vision-validation.png'));

function fakeWindow(title, visible = true) {
  return {
    title, visible, opacity: 1, hidden: 0, shown: 0,
    isDestroyed() { return false; },
    isVisible() { return this.visible; },
    getTitle() { return this.title; },
    hide() { this.visible = false; this.hidden++; },
    show() { this.visible = true; this.shown++; },
    setAlwaysOnTop() {},
    setOpacity(value) { this.opacity = value; },
    getOpacity() { return this.opacity; },
    once(name, callback) { if (name === 'closed') this.closedCallback = callback; }
  };
}

class FakeScreenshots {
  static instance = null;
  static defaultStartError = null;
  static defaultStartHang = false;
  static defaultViewReady = true;
  constructor(options) {
    this.options = options;
    this.handlers = {};
    this.starts = 0;
    this.ends = 0;
    this.startError = FakeScreenshots.defaultStartError;
    this.startHang = FakeScreenshots.defaultStartHang;
    this.viewReady = FakeScreenshots.defaultViewReady;
    FakeScreenshots.defaultStartError = null;
    FakeScreenshots.defaultStartHang = false;
    FakeScreenshots.defaultViewReady = true;
    this.$view = { webContents: { executeJavaScript: async () => this.viewReady ? true : '' } };
    this.$win = fakeWindow('screenshots', true);
    this.$win.opacity = 0;
    FakeScreenshots.instance = this;
  }
  on(name, handler) { (this.handlers[name] ||= []).push(handler); }
  emit(name, event, ...args) { for (const handler of this.handlers[name] || []) handler(event, ...args); }
  startCapture() {
    this.starts++;
    if (this.startError) return Promise.reject(this.startError);
    if (this.startHang) return new Promise(() => {});
    this.emit('windowCreated', this.$win);
    return Promise.resolve();
  }
  endCapture() { this.ends++; return Promise.resolve(); }
}

function fakeEvent() {
  return { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

function createDeps(windows) {
  const clipboard = { writes: 0, last: null, writeImage(image) { this.writes++; this.last = image; } };
  const nativeImage = {
    createFromBuffer(buffer) {
      const valid = buffer.length >= 24 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
      return { buffer, isEmpty: () => !valid, getSize: () => ({ width: 260, height: 72 }), toPNG: () => Buffer.from('saved-png') };
    }
  };
  const electron = { BrowserWindow: { getAllWindows: () => windows }, clipboard, nativeImage };
  const dialog = { calls: 0, async showSaveDialog() { this.calls++; return { canceled: false, filePath: 'C:/tmp/shot.png' }; } };
  const fileSystem = { written: null, writeFileSync(file, data) { this.written = { file, data }; } };
  return { electron, clipboard, nativeImage, dialog, fileSystem };
}

function makeLibrary(windows, overrides = {}) {
  const deps = createDeps(windows);
  const Screenshots = overrides.Screenshots || FakeScreenshots;
  const library = createScreenshotLibrary({
    electron: deps.electron,
    Screenshots,
    dialog: overrides.dialog || deps.dialog,
    fs: deps.fileSystem,
    timeoutMs: overrides.timeoutMs,
    captureImage: overrides.captureImage
  });
  return { library, ...deps };
}

(async () => {
  {
    const pet = fakeWindow('pet', true);
    const { library, clipboard } = makeLibrary([pet]);
    const pending = library.capture();
    assert.equal(pet.visible, false, 'app windows hide before capture');
    assert.equal(pet.hidden, 1);
    assert.equal(FakeScreenshots.instance.starts, 1);
    assert.deepStrictEqual(FakeScreenshots.instance.options.lang.operation_text_title, '文字');
    const event = fakeEvent();
    FakeScreenshots.instance.emit('ok', event, validationPng, {});
    assert.deepStrictEqual(await pending, { ok: true, width: 260, height: 72 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(event.defaultPrevented, true, 'wrapper owns clipboard/end behavior');
    assert.equal(clipboard.writes, 1);
    assert.equal(clipboard.last.buffer, validationPng);
    assert.equal(FakeScreenshots.instance.ends, 1);
    assert.equal(pet.visible, true, 'app windows restore after capture');
  }

  {
    const pet = fakeWindow('pet', true);
    const { library, clipboard } = makeLibrary([pet]);
    const pending = library.capture();
    FakeScreenshots.instance.emit('cancel', fakeEvent());
    assert.deepStrictEqual(await pending, { ok: false, reason: 'cancelled' });
    assert.equal(clipboard.writes, 0);
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    const { library } = makeLibrary([pet]);
    FakeScreenshots.defaultStartError = new Error('capture exploded');
    const failed = await library.capture();
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'capture-failed');
    assert.match(failed.error, /capture exploded/);
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    const { library } = makeLibrary([pet]);
    const controller = new AbortController();
    const pending = library.capture({ signal: controller.signal });
    controller.abort();
    assert.deepStrictEqual(await pending, { ok: false, reason: 'cancelled' });
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    const { library, clipboard } = makeLibrary([pet]);
    const first = library.capture();
    await assert.rejects(library.capture(), /截图已在进行/);
    FakeScreenshots.instance.emit('ok', fakeEvent(), validationPng);
    assert.equal((await first).ok, true);
    assert.equal(clipboard.writes, 1);
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    const { library, clipboard } = makeLibrary([pet]);
    const first = library.capture();
    FakeScreenshots.instance.emit('ok', fakeEvent(), Buffer.from('invalid'));
    const result = await first;
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'capture-failed');
    assert.equal(clipboard.writes, 0);
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    const { library, clipboard } = makeLibrary([pet]);
    const pending = library.capture();
    const firstEvent = fakeEvent();
    const secondEvent = fakeEvent();
    FakeScreenshots.instance.emit('ok', firstEvent, validationPng);
    FakeScreenshots.instance.emit('ok', secondEvent, validationPng);
    assert.equal((await pending).ok, true);
    assert.equal(firstEvent.defaultPrevented, true);
    assert.equal(secondEvent.defaultPrevented, true, 'duplicate ok is suppressed');
    assert.equal(clipboard.writes, 1, 'duplicate ok does not write the clipboard twice');
    assert.equal(FakeScreenshots.instance.ends, 1, 'duplicate ok does not end capture twice');
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    const { library, clipboard, dialog, fileSystem } = makeLibrary([pet]);
    const pending = library.capture();
    const event = fakeEvent();
    FakeScreenshots.instance.emit('save', event, validationPng);
    assert.equal(event.defaultPrevented, true, 'wrapper handles Save instead of the library');
    const result = await pending;
    assert.deepStrictEqual(result, { ok: false, reason: 'cancelled', saved: true });
    assert.equal(dialog.calls, 1, 'Save uses the injected save dialog');
    assert.deepStrictEqual(fileSystem.written.file, 'C:/tmp/shot.png');
    assert.deepStrictEqual(fileSystem.written.data, Buffer.from('saved-png'));
    assert.equal(clipboard.writes, 0, 'Save writes a file but does not copy the image');
    assert.equal(FakeScreenshots.instance.ends, 1);
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    const saveDialog = { calls: 0, async showSaveDialog() { this.calls++; return { canceled: true }; } };
    const { library } = makeLibrary([pet], { dialog: saveDialog });
    const pending = library.capture();
    FakeScreenshots.instance.emit('save', fakeEvent(), validationPng);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(saveDialog.calls, 1);
    assert.equal(pet.visible, false, 'canceling Save keeps the capture open');
    FakeScreenshots.instance.emit('cancel', fakeEvent());
    assert.deepStrictEqual(await pending, { ok: false, reason: 'cancelled' });
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    FakeScreenshots.defaultStartHang = true;
    const { library } = makeLibrary([pet], { timeoutMs: 20 });
    const result = await library.capture();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'capture-failed');
    assert.match(result.error, /未响应/);
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    FakeScreenshots.defaultViewReady = false;
    const { library } = makeLibrary([pet]);
    const result = await library.capture();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'capture-failed');
    assert.match(result.error, /未就绪/);
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    const { library } = makeLibrary([pet]);
    const pending = library.capture();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof FakeScreenshots.instance.$win.closedCallback, 'function');
    FakeScreenshots.instance.$win.closedCallback();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'capture-failed');
    assert.match(result.error, /窗口已关闭/);
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    const { library } = makeLibrary([pet]);
    assert.equal(library.warm(), true);
    assert.ok(FakeScreenshots.instance, 'warm creates the library instance');
    assert.equal(FakeScreenshots.instance.starts, 0, 'warm does not start a capture');
    const pending = library.capture();
    assert.equal(FakeScreenshots.instance.starts, 1);
    FakeScreenshots.instance.emit('cancel', fakeEvent());
    await pending;
  }

  {
    const pet = fakeWindow('pet', true);
    let seen = null;
    const { library } = makeLibrary([pet], {
      captureImage: async (display) => { seen = display; return 'data:image/png;base64,fixture'; }
    });
    assert.equal(library.warm(), true);
    const fake = FakeScreenshots.instance;
    assert.equal(typeof fake.capture, 'function', 'captureImage overrides the library capture');
    assert.equal(await fake.capture({ id: 7 }), 'data:image/png;base64,fixture');
    assert.deepStrictEqual(seen, { id: 7 });
    const pending = library.capture();
    FakeScreenshots.instance.emit('cancel', fakeEvent());
    assert.deepStrictEqual(await pending, { ok: false, reason: 'cancelled' });
    assert.equal(pet.visible, true);
  }

  console.log('PASS screenshot library wrapper ok/cancel/save/timeout/close/duplicate/warm semantics');
})().catch((error) => { console.error(error); process.exitCode = 1; });