const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createScreenshotController } = require('./screenshot');
const geometry = require('./screenshot-geometry');
const { mapDisplaysToPhysical } = require('./screenshot-native-capture');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function until(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out: ${label}`);
}

function selector(id, url = 'file:///app/renderer/screenshot.html') {
  const win = new EventEmitter();
  const frame = { url };
  win.destroyed = false;
  win.shown = false;
  win.webContents = {
    id,
    mainFrame: frame,
    sent: [],
    send(channel, payload) { this.sent.push({ channel, payload }); }
  };
  win.isDestroyed = () => win.destroyed;
  win.show = () => { win.shown = true; };
  win.focus = () => {};
  win.destroy = () => { win.destroyed = true; };
  return win;
}

function appWindow(visible) {
  return {
    visible,
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    isVisible() { return this.visible; },
    hide() { this.visible = false; },
    show() { this.visible = true; }
  };
}

function controllerFixture(overrides = {}) {
  const visible = appWindow(true);
  const hidden = appWindow(false);
  const counters = { capture: 0, selectors: 0, writes: 0 };
  const screens = [{ id: 'left', bounds: { x: 0, y: 0, width: 100, height: 80 }, scaleFactor: 1 }];
  const instance = createScreenshotController({
    getAppWindows: () => [visible, hidden],
    getDisplays: () => screens,
    captureScreens: async (items) => {
      counters.capture++;
      return items.map((item) => ({ id: item.id, pixelWidth: item.pixelWidth, pixelHeight: item.pixelHeight, dataUrl: 'screen' }));
    },
    createSelector: async () => {
      counters.selectors++;
      return selector(counters.selectors);
    },
    writeImage: () => { counters.writes++; },
    ...overrides
  });
  return { instance, counters, visible, hidden };
}

async function controllerLifecycleCases() {
  {
    const { instance, counters, visible } = controllerFixture();
    const abort = new AbortController();
    abort.abort();
    assert.deepStrictEqual(await instance.capture({ signal: abort.signal }), { ok: false, reason: 'cancelled' });
    assert.equal(counters.capture, 0, 'already-aborted request skips screen capture');
    assert.equal(counters.selectors, 0);
    assert.equal(visible.visible, true);
  }

  {
    const captureGate = deferred();
    const captureStarted = deferred();
    const { instance, counters, visible, hidden } = controllerFixture({
      captureScreens: async () => { captureStarted.resolve(); return captureGate.promise; }
    });
    const abort = new AbortController();
    const pending = instance.capture({ signal: abort.signal });
    await captureStarted.promise;
    abort.abort();
    captureGate.resolve([{ id: 'left', pixelWidth: 100, pixelHeight: 80, dataUrl: 'screen' }]);
    assert.deepStrictEqual(await pending, { ok: false, reason: 'cancelled' });
    assert.equal(counters.selectors, 0, 'external abort during capture never opens a selector');
    assert.equal(counters.writes, 0);
    assert.equal(visible.visible, true);
    assert.equal(hidden.visible, false, 'cleanup preserves an app window that started hidden');
  }

  {
    const selectorReady = deferred();
    const windows = [];
    const { instance, counters, visible } = controllerFixture({
      createSelector: async () => {
        counters.selectors++;
        const win = selector(windows.length + 1);
        windows.push(win);
        selectorReady.resolve();
        return win;
      }
    });
    const first = instance.capture();
    const reentered = instance.capture();
    assert.strictEqual(reentered, first, 'reentry joins the active capture');
    await selectorReady.promise;
    await until(() => windows[0].shown, 'selector listeners attached before close');
    assert.equal(counters.capture, 1);
    assert.equal(counters.selectors, 1);
    windows[0].emit('closed');
    assert.deepStrictEqual(await first, { ok: false, reason: 'cancelled' }, 'unexpected selector close settles cancellation');
    assert.equal(windows[0].destroyed, true);
    assert.equal(visible.visible, true);
    assert.equal(counters.writes, 0);
    assert.equal(instance.isActive(), false);
  }

  {
    const selectorReady = deferred();
    const windows = [];
    const { instance, counters, visible } = controllerFixture({
      createSelector: async () => {
        counters.selectors++;
        const win = selector(windows.length + 1);
        windows.push(win);
        selectorReady.resolve();
        return win;
      }
    });
    const pending = instance.capture();
    await selectorReady.promise;
    await until(() => windows[0].shown, 'selector shown');
    instance.dispose();
    assert.deepStrictEqual(await pending, { ok: false, reason: 'cancelled' }, 'dispose aborts before selection completion');
    assert.equal(windows[0].destroyed, true);
    assert.equal(visible.visible, true);
    assert.equal(counters.writes, 0);
    assert.deepStrictEqual(await instance.capture(), { ok: false, reason: 'disposed' });
  }

  {
    const { instance, counters, visible, hidden } = controllerFixture({
      createSelector: async () => { throw new Error('selector load failed'); }
    });
    const result = await instance.capture();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'capture-failed');
    assert.match(result.error, /selector load failed/);
    assert.equal(visible.visible, true);
    assert.equal(hidden.visible, false);
    assert.equal(counters.writes, 0);
  }
}

async function rendererCrossSelectorCase() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'screenshot.js'), 'utf8');
  const annotationSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'screenshot-annotation.js'), 'utf8');

  function makeRenderer(bounds) {
    const listeners = new Map();
    const canvasListeners = new Map();
    const callbacks = {};
    const sent = [];
    const composed = [];
    const cancelled = [];
    const ready = [];
    const operations = [];
    const classList = () => {
      const values = new Set();
      return { add: (value) => values.add(value), remove: (value) => values.delete(value), contains: (value) => values.has(value) };
    };
    const editor = { classList: classList() };
    const body = { classList: classList() };
    const selection = { style: {} };
    const screenNode = { src: '', decode: async () => {} };
    const context2d = new Proxy({}, {
      set(target, key, value) { target[key] = value; return true; },
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => operations.push([key, ...args]);
      }
    });
    const canvas = {
      width: 0, height: 0, style: {},
      getContext: () => context2d,
      getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; },
      addEventListener(type, callback) { canvasListeners.set(type, callback); },
      setPointerCapture() {},
      toDataURL: () => 'data:image/png;base64,renderer-fixture'
    };
    const button = () => {
      const handlers = {};
      return { addEventListener(type, callback) { handlers[type] = callback; }, setAttribute() {}, click() { handlers.click?.(); } };
    };
    const tools = { pen: button(), text: button(), undo: button(), cancel: button(), done: button() };
    const textInput = { value: '', addEventListener() {}, focus() {} };
    const toolbar = { style: {}, getBoundingClientRect: () => ({ width: 320, height: 40 }) };
    const nodes = {
      screen: screenNode, selection, editor, preview: canvas, 'annotation-text': textInput, toolbar,
      'pen-tool': tools.pen, 'text-tool': tools.text, 'undo-tool': tools.undo, 'cancel-tool': tools.cancel, 'done-tool': tools.done
    };
    const bridge = {
      onInit(callback) { callbacks.init = callback; },
      onSelection(callback) { callbacks.selection = callback; },
      onCompose(callback) { callbacks.compose = callback; },
      pointer(payload) { sent.push(payload); }, cancel(payload) { cancelled.push(payload); },
      composed(payload) { composed.push(payload); }, ready(payload) { ready.push(payload); }
    };
    const windowObject = {
      screenshot: bridge,
      screenshotCompose: { composeScreens: async () => 'data:image/png;base64,renderer-fixture' },
      innerWidth: 100, innerHeight: 80,
      addEventListener(type, callback) { listeners.set(type, callback); }
    };
    const sandbox = {
      window: windowObject,
      document: { getElementById(id) { return nodes[id]; }, body },
      Image: class { constructor() { this.width = 0; this.height = 0; } async decode() { this.width = 40; this.height = 30; } },
      requestAnimationFrame: (callback) => Promise.resolve().then(callback),
      console
    };
    vm.runInNewContext(annotationSource, sandbox, { filename: 'renderer/screenshot-annotation.js' });
    vm.runInNewContext(source, sandbox, { filename: 'renderer/screenshot.js' });
    const initPromise = callbacks.init({ token: 'renderer-token', screen: { bounds, dataUrl: 'screen' }, screens: [] });
    return {
      listeners, canvasListeners, callbacks, nodes, sent, composed, cancelled, ready, operations, tools, canvas, body, editor, textInput, initPromise
    };
  }

  const point = (x, y) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, preventDefault() {} });

  const left = makeRenderer({ x: 0, y: 0 });
  const right = makeRenderer({ x: 100, y: 20 });
  await Promise.all([left.initPromise, right.initPromise]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(left.ready)), [{ token: 'renderer-token' }], 'selector renderer signals ready after its frozen image decodes');
  left.listeners.get('mousedown')({ button: 0, clientX: 80, clientY: 10 });
  right.listeners.get('mousemove')({ clientX: 5, clientY: 10 });
  right.listeners.get('mouseup')({ button: 0, clientX: 5, clientY: 10 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(left.sent)), [{ token: 'renderer-token', type: 'down', x: 80, y: 10 }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(right.sent)), [
    { token: 'renderer-token', type: 'move', x: 105, y: 30 },
    { token: 'renderer-token', type: 'up', x: 105, y: 30 }
  ], 'production selector renderer reports screen coordinates across selector windows');

  await right.callbacks.compose({ token: 'renderer-token', plan: { width: 40, height: 30 }, selection: { x: 0, y: 0, width: 40, height: 30 } });
  assert.equal(right.editor.classList.contains('open'), true, 'crop composition opens the annotation editor');
  assert.equal(right.body.classList.contains('editing'), true, 'editing hides the selector layer');
  assert.deepStrictEqual([right.canvas.width, right.canvas.height], [40, 30], 'annotation canvas uses source crop pixels');
  right.canvasListeners.get('pointerdown')(point(5, 5));
  right.canvasListeners.get('pointermove')(point(14, 14));
  right.canvasListeners.get('pointerup')(point(14, 14));
  assert.ok(right.operations.some((entry) => entry[0] === 'moveTo' && entry[1] === 5 && entry[2] === 5), 'pen stroke maps display clicks to crop pixels');
  assert.ok(right.operations.some((entry) => entry[0] === 'lineTo' && entry[1] === 14 && entry[2] === 14), 'pen stroke records the drag end point');
  const beforeUndo = right.operations.length;
  right.tools.undo.click();
  assert.ok(right.operations.length > beforeUndo, 'undo repaints the crop');
  assert.equal(right.operations.slice(beforeUndo).some((entry) => entry[0] === 'moveTo'), false, 'undo removes the latest pen annotation');
  assert.equal(right.composed.length, 0, 'editing does not publish before Done');
  right.tools.done.click();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(right.composed)), [
    { token: 'renderer-token', ok: true, dataUrl: 'data:image/png;base64,renderer-fixture' }
  ], 'Done publishes one annotated PNG');
  assert.equal(right.cancelled.length, 0, 'Done does not send cancellation');

  const cancelRenderer = makeRenderer({ x: 0, y: 0 });
  await cancelRenderer.initPromise;
  await cancelRenderer.callbacks.compose({ token: 'renderer-token', plan: { width: 40, height: 30 }, selection: { x: 0, y: 0, width: 40, height: 30 } });
  cancelRenderer.tools.cancel.click();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(cancelRenderer.cancelled)), [{ token: 'renderer-token' }], 'Cancel sends cancellation');
  assert.equal(cancelRenderer.composed.length, 0, 'Cancel never publishes an image');
}

async function geometryCases() {
  const staggered = [
    { id: 'primary', bounds: { x: 0, y: 0, width: 100, height: 60 }, pixelWidth: 100, pixelHeight: 60 },
    { id: 'raised-secondary', bounds: { x: 100, y: 20, width: 60, height: 40 }, pixelWidth: 120, pixelHeight: 80 }
  ];
  const selection = { x: 80, y: 10, width: 80, height: 40 };
  assert.equal(geometry.isSelectionWithinDisplays(selection, staggered), true,
    'a nonempty cross-display selection remains valid when its rectangle spans the virtual-desktop gap');
  const plan = geometry.planComposition(selection, staggered);
  assert.deepStrictEqual({ width: plan.width, height: plan.height, scale: plan.scale }, { width: 160, height: 80, scale: 2 });
  assert.deepStrictEqual(plan.parts.map((part) => ({ id: part.id, source: part.source, destination: part.destination })), [
    { id: 'primary', source: { x: 80, y: 10, width: 20, height: 40 }, destination: { x: 0, y: 0, width: 40, height: 80 } },
    { id: 'raised-secondary', source: { x: 0, y: 0, width: 120, height: 60 }, destination: { x: 40, y: 20, width: 120, height: 60 } }
  ]);

  const windows = [];
  const controller = createScreenshotController({
    getAppWindows: () => [],
    getDisplays: () => staggered.map((screen) => ({ id: screen.id, bounds: screen.bounds, scaleFactor: 1 })),
    captureScreens: async (items) => items.map((item) => ({ id: item.id, pixelWidth: item.pixelWidth, pixelHeight: item.pixelHeight, dataUrl: 'screen' })),
    createSelector: async () => {
      const win = selector(windows.length + 1);
      windows.push(win);
      return win;
    },
    writeImage: () => assert.fail('geometry-only gap selection must not publish before composition')
  });
  const pending = controller.capture();
  await until(() => windows.length === 2 && windows.every((win) => win.shown), 'staggered selectors ready');
  const event = (index) => ({ sender: windows[index].webContents, senderFrame: windows[index].webContents.mainFrame });
  assert.equal(controller.pointer(event(0), { token: pending.token, type: 'down', x: 80, y: 10 }), true);
  assert.equal(controller.pointer(event(1), { token: pending.token, type: 'up', x: 140, y: 50 }), true);
  const composedByWindow = windows.map((win) => win.webContents.sent.find((item) => item.channel === 'v2p:screenshot:compose'));
  assert.equal(composedByWindow[0], undefined, 'the drag-start screen does not receive the crop composition request');
  const composed = composedByWindow[1];
  assert.ok(composed, 'cross-monitor drag sends the composition request to the release screen');
  assert.deepStrictEqual(composed.payload.plan.parts.map((part) => part.id), ['primary', 'raised-secondary']);
  controller.dispose();
  assert.deepStrictEqual(await pending, { ok: false, reason: 'cancelled' });

  const releaseWindows = [];
  const releaseController = createScreenshotController({
    getAppWindows: () => [],
    getDisplays: () => staggered.map((screen) => ({ id: screen.id, bounds: screen.bounds, scaleFactor: 1 })),
    captureScreens: async (items) => items.map((item) => ({ id: item.id, pixelWidth: item.pixelWidth, pixelHeight: item.pixelHeight, dataUrl: 'screen' })),
    createSelector: async () => {
      const win = selector(releaseWindows.length + 1);
      releaseWindows.push(win);
      return win;
    },
    writeImage: () => assert.fail('release-screen geometry must not publish before composition')
  });
  const releasePending = releaseController.capture();
  await until(() => releaseWindows.length === 2 && releaseWindows.every((win) => win.shown), 'release-screen selectors ready');
  const releaseEvent = (index) => ({ sender: releaseWindows[index].webContents, senderFrame: releaseWindows[index].webContents.mainFrame });
  assert.equal(releaseController.pointer(releaseEvent(0), { token: releasePending.token, type: 'down', x: 80, y: 10 }), true);
  assert.equal(releaseController.pointer(releaseEvent(0), { token: releasePending.token, type: 'up', x: 140, y: 50 }), true);
  const releaseComposed = releaseWindows.map((win) => win.webContents.sent.find((item) => item.channel === 'v2p:screenshot:compose'));
  assert.equal(releaseComposed[0], undefined, 'the drag-captured selector does not become the editor when the pointer is released on another screen');
  assert.ok(releaseComposed[1], 'composition follows the physical release screen even when the drag-start selector receives the mouseup');
  releaseController.dispose();
  assert.deepStrictEqual(await releasePending, { ok: false, reason: 'cancelled' });

  const sameSizeElectron = [
    { id: 'electron-right', nativeBounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
    { id: 'electron-left', nativeBounds: { x: 0, y: 0, width: 1920, height: 1080 } }
  ];
  const physical = [
    { name: 'physical-left', x: 0, y: 0, width: 1920, height: 1080 },
    { name: 'physical-right', x: 1920, y: 0, width: 1920, height: 1080 }
  ];
  assert.deepStrictEqual(mapDisplaysToPhysical(sameSizeElectron, physical).map(({ id, name }) => ({ id, name })), [
    { id: 'electron-right', name: 'physical-right' },
    { id: 'electron-left', name: 'physical-left' }
  ], 'same-resolution sources map by physical position, independent of enumeration order');
}

async function main() {
  await controllerLifecycleCases();
  await rendererCrossSelectorCase();
  await geometryCases();
  console.log('PASS independent screenshot controller lifecycle, production renderer cross-selector coordinates, staggered geometry and physical monitor identity');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
