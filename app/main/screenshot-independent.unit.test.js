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

function rendererCrossSelectorCase() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'screenshot.js'), 'utf8');
  function makeRenderer(bounds) {
    const listeners = new Map();
    const callbacks = {};
    const sent = [];
    const nodes = { screen: { src: '' }, selection: { style: {} } };
    const bridge = {
      onInit(callback) { callbacks.init = callback; },
      onSelection(callback) { callbacks.selection = callback; },
      onCompose(callback) { callbacks.compose = callback; },
      pointer(payload) { sent.push(payload); }, cancel() {}, composed() {}
    };
    const context = {
      window: { screenshot: bridge, addEventListener(type, callback) { listeners.set(type, callback); } },
      document: { getElementById(id) { return nodes[id]; } }
    };
    vm.runInNewContext(source, context, { filename: 'renderer/screenshot.js' });
    callbacks.init({ token: 'renderer-token', screen: { bounds, dataUrl: 'screen' }, screens: [] });
    return { listeners, nodes, sent };
  }

  const left = makeRenderer({ x: 0, y: 0 });
  const right = makeRenderer({ x: 100, y: 20 });
  left.listeners.get('mousedown')({ button: 0, clientX: 80, clientY: 10 });
  right.listeners.get('mousemove')({ clientX: 5, clientY: 10 });
  right.listeners.get('mouseup')({ button: 0, clientX: 5, clientY: 10 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(left.sent)), [{ token: 'renderer-token', type: 'down', x: 80, y: 10 }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(right.sent)), [
    { token: 'renderer-token', type: 'move', x: 105, y: 30 },
    { token: 'renderer-token', type: 'up', x: 105, y: 30 }
  ], 'production selector renderer reports screen coordinates across selector windows');
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
  const composed = windows[0].webContents.sent.find((item) => item.channel === 'v2p:screenshot:compose');
  assert.ok(composed, 'cross-monitor drag spanning a virtual gap reaches the compositor');
  assert.deepStrictEqual(composed.payload.plan.parts.map((part) => part.id), ['primary', 'raised-secondary']);
  controller.dispose();
  assert.deepStrictEqual(await pending, { ok: false, reason: 'cancelled' });

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
  rendererCrossSelectorCase();
  await geometryCases();
  console.log('PASS independent screenshot controller lifecycle, production renderer cross-selector coordinates, staggered geometry and physical monitor identity');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
