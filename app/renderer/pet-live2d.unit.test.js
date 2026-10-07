const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

async function createHarness(renderedPixels) {
  const source = fs.readFileSync(path.join(__dirname, 'pet-live2d.js'), 'utf8');
  const canvas = { width: 284, height: 164, pixels: false };
  const stageClasses = new Set();
  const stageEl = {
    classList: {
      add(name) { stageClasses.add(name); },
      remove(name) { stageClasses.delete(name); }
    }
  };
  let renderCount = 0;
  const app = {
    stage: { addChild() {} },
    ticker: { add() {} },
    start() {},
    stop() {},
    render() { renderCount++; canvas.pixels = renderedPixels(); }
  };
  class Container {
    addChild() {}
    removeChildren() {}
  }
  const coreModel = {
    getParameterIndex() { return -1; },
    getParameterCount() { return 0; }
  };
  const model = {
    scale: { set() {} },
    anchor: { set() {} },
    destroy() {},
    internalModel: { coreModel }
  };
  const context2d = {
    drawImage(sourceCanvas) {
      assert.ok(renderCount > 0, 'the WebGL canvas is rendered before it is sampled');
      this.pixels = sourceCanvas.pixels;
    },
    getImageData() {
      const data = new Uint8ClampedArray(4);
      data[3] = this.pixels ? 255 : 0;
      return { data };
    }
  };
  const document = {
    getElementById(id) { return id === 'l2d' ? canvas : stageEl; },
    createElement() {
      return { get width() { return 284; }, set width(_v) {}, get height() { return 164; }, set height(_v) {}, getContext() { return context2d; } };
    }
  };
  const PIXI = {
    Application: function () { return app; },
    Container,
    live2d: { Live2DModel: { async from() { return model; } } }
  };
  const window = { PIXI, live2dcubismcore: {}, v2p: { async keyCaps() { return { keys: [] }; } } };
  const context = {
    window, document, PIXI,
    fetch: async () => ({ ok: false }),
    console: { log() {}, warn() {}, error() {} },
    Math, Map
  };
  vm.runInNewContext(source, context, { filename: 'pet-live2d.js' });
  await window.petLive2d.loadModel('model://test/model3.json');
  return { pet: window.petLive2d, getRenderCount: () => renderCount };
}

(async () => {
  let harness = await createHarness(() => true);
  assert.strictEqual(await harness.pet.hasVisiblePixels(), true,
    'a visible model is detected after synchronously rendering a frame');
  assert.strictEqual(harness.getRenderCount(), 1);

  harness = await createHarness(() => false);
  assert.strictEqual(await harness.pet.hasVisiblePixels(), false,
    'a genuinely empty rendered frame still triggers the fallback');
  assert.strictEqual(harness.getRenderCount(), 1);
  console.log('PASS Live2D pixel detection renders before sampling and preserves empty-frame fallback');
})().catch((error) => { console.error(error); process.exitCode = 1; });
