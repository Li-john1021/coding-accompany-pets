'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createScreenshotLibrary } = require('./screenshot-library');

const validationPng = fs.readFileSync(path.join(__dirname, 'vision-validation.png'));

function fakeWindow(title, visible = true) {
  return {
    title, visible, hidden: 0, shown: 0,
    isDestroyed() { return false; },
    isVisible() { return this.visible; },
    getTitle() { return this.title; },
    hide() { this.visible = false; this.hidden++; },
    show() { this.visible = true; this.shown++; }
  };
}

class FakeScreenshots {
  static instance = null;
  static defaultStartError = null;
  constructor(options) {
    this.options = options;
    this.handlers = {};
    this.starts = 0;
    this.ends = 0;
    this.startError = FakeScreenshots.defaultStartError;
    FakeScreenshots.defaultStartError = null;
    FakeScreenshots.instance = this;
  }
  on(name, handler) { (this.handlers[name] ||= []).push(handler); }
  emit(name, event, ...args) { for (const handler of this.handlers[name] || []) handler(event, ...args); }
  startCapture() { this.starts++; return this.startError ? Promise.reject(this.startError) : Promise.resolve(); }
  endCapture() { this.ends++; return Promise.resolve(); }
}

function fakeEvent() {
  return { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

function createDeps(windows) {
  const clipboard = { written: null, writeImage(image) { this.written = image; } };
  const nativeImage = {
    createFromBuffer(buffer) {
      const valid = buffer.length >= 24 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
      return { buffer, isEmpty: () => !valid, getSize: () => ({ width: 260, height: 72 }) };
    }
  };
  const electron = { BrowserWindow: { getAllWindows: () => windows }, clipboard, nativeImage };
  return { electron, clipboard, nativeImage };
}

(async () => {
  {
    const pet = fakeWindow('pet', true);
    const libraryWindow = fakeWindow('screenshots', true);
    const { electron, clipboard } = createDeps([pet, libraryWindow]);
    const library = createScreenshotLibrary({ electron, Screenshots: FakeScreenshots });
    const pending = library.capture();
    assert.equal(pet.visible, false, 'app windows hide before capture');
    assert.equal(pet.hidden, 1);
    assert.equal(libraryWindow.visible, true, 'library window is not hidden by its own wrapper');
    assert.equal(FakeScreenshots.instance.starts, 1);
    assert.deepStrictEqual(FakeScreenshots.instance.options.lang.operation_text_title, '文字');
    const event = fakeEvent();
    FakeScreenshots.instance.emit('ok', event, validationPng, {});
    assert.deepStrictEqual(await pending, { ok: true, width: 260, height: 72 });
    assert.equal(event.defaultPrevented, true, 'wrapper owns clipboard/end behavior');
    assert.equal(clipboard.written.buffer, validationPng);
    assert.equal(FakeScreenshots.instance.ends, 1);
    assert.equal(pet.visible, true, 'app windows restore after capture');
    assert.equal(pet.shown, 1);
  }

  {
    const pet = fakeWindow('pet', true);
    const { electron, clipboard } = createDeps([pet]);
    const library = createScreenshotLibrary({ electron, Screenshots: FakeScreenshots });
    const pending = library.capture();
    FakeScreenshots.instance.emit('cancel', fakeEvent());
    assert.deepStrictEqual(await pending, { ok: false, reason: 'cancelled' });
    assert.equal(clipboard.written, null);
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    const { electron } = createDeps([pet]);
    FakeScreenshots.defaultStartError = new Error('capture exploded');
    const library = createScreenshotLibrary({ electron, Screenshots: FakeScreenshots });
    const failed = await library.capture();
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'capture-failed');
    assert.match(failed.error, /capture exploded/);
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    const { electron } = createDeps([pet]);
    const library = createScreenshotLibrary({ electron, Screenshots: FakeScreenshots });
    const controller = new AbortController();
    const pending = library.capture({ signal: controller.signal });
    controller.abort();
    assert.deepStrictEqual(await pending, { ok: false, reason: 'cancelled' });
    assert.equal(pet.visible, true);
  }

  {
    const pet = fakeWindow('pet', true);
    const { electron, clipboard } = createDeps([pet]);
    const library = createScreenshotLibrary({ electron, Screenshots: FakeScreenshots });
    const first = library.capture();
    await assert.rejects(library.capture(), /截图已在进行/);
    FakeScreenshots.instance.emit('ok', fakeEvent(), Buffer.from('invalid'));
    const result = await first;
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'capture-failed');
    assert.equal(clipboard.written, null);
    assert.equal(pet.visible, true);
  }

  console.log('PASS screenshot library wrapper ok/cancel/failure/abort/pending semantics');
})().catch((error) => { console.error(error); process.exitCode = 1; });