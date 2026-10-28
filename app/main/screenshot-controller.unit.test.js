const assert = require('assert');
const { createScreenshotController } = require('./screenshot');
const { mapDisplaysToPhysical } = require('./screenshot-native-capture');

async function main() {
  const mapped = mapDisplaysToPhysical([
    { id: 'electron-a', nativeBounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 'electron-b', nativeBounds: { x: 1920, y: 0, width: 1920, height: 1080 } }
  ], [
    { name: 'display-left', x: 0, y: 0, width: 1920, height: 1080 },
    { name: 'display-right', x: 1920, y: 0, width: 1920, height: 1080 }
  ]);
  assert.deepStrictEqual(mapped.map((item) => item.name), ['display-left', 'display-right'], 'equal-resolution screens use physical overlap to map identity');
  assert.throws(() => mapDisplaysToPhysical([
    { id: 'electron-a', nativeBounds: { x: 0, y: 0, width: 1920, height: 1080 } }
  ], [
    { name: 'display-left', x: -1920, y: 0, width: 1920, height: 1080 },
    { name: 'display-right', x: 1920, y: 0, width: 1920, height: 1080 }
  ]), /ambiguous/);
  const displays = [
    { id: 'a', bounds: { x: 0, y: 0, width: 100, height: 80 }, scaleFactor: 1 },
    { id: 'b', bounds: { x: 100, y: 0, width: 100, height: 80 }, scaleFactor: 2 }
  ];
  const windows = [];
  const appVisibility = [
    { visible: true, destroyed: false, isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; }, hide() { this.visible = false; }, show() { this.visible = true; } },
    { visible: false, destroyed: false, isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; }, hide() { this.visible = false; }, show() { assert.fail('previously hidden app window must remain hidden'); } }
  ];
  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const controller = createScreenshotController({
    getAppWindows: () => appVisibility, getDisplays: () => displays,
    captureScreens: async (items) => items.map((d) => ({ id: d.id, pixelWidth: d.pixelWidth, pixelHeight: d.pixelHeight, dataUrl: 'data:image/png;base64,AA==' })),
    createSelector: async ({ screen }) => {
      const frame = { url: 'file:///app/renderer/screenshot.html' };
      const webContents = { id: windows.length + 1, mainFrame: frame, sent: [], send(channel, payload) { this.sent.push({ channel, payload }); } };
      const win = { webContents, destroyed: false, isDestroyed() { return this.destroyed; }, show() {}, focus() {}, destroy() { this.destroyed = true; } };
      windows.push({ win, screen });
      if (windows.length === 2) resolveReady();
      return win;
    }, writeImage: () => assert.fail('cancelled capture must not write the clipboard')
  });
  const promise = controller.capture();
  await ready;
  await new Promise((resolve) => setImmediate(resolve));
  const evt = (index) => ({ sender: windows[index].win.webContents, senderFrame: windows[index].win.webContents.mainFrame });
  assert.equal(controller.pointer(evt(0), { token: promise.token, type: 'down', x: 90, y: 20 }), true);
  assert.equal(controller.pointer(evt(1), { token: promise.token, type: 'move', x: 140, y: 50 }), true);
  assert.equal(controller.pointer(evt(1), { token: promise.token, type: 'up', x: 140, y: 50 }), true);
  assert.equal(windows[0].win.webContents.sent.some((entry) => entry.channel === 'v2p:screenshot:compose'), false,
    'cross-screen completion is delivered to the mouseup selector');
  assert.equal(windows[1].win.webContents.sent.some((entry) => entry.channel === 'v2p:screenshot:compose'), true,
    'an up event from the second selector opens its crop editor');
  assert.equal(controller.cancel(evt(1), { token: promise.token }), true);
  assert.deepStrictEqual(await promise, { ok: false, reason: 'cancelled' });
  assert.equal(windows.every(({ win }) => win.destroyed), true);
  assert.equal(appVisibility[0].visible, true, 'visible app windows are restored after cancellation');
  assert.equal(appVisibility[1].visible, false, 'previously hidden windows remain hidden');
  console.log('PASS screenshot cross-selector drag, sender validation, cancellation and cleanup');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
