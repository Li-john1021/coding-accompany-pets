const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { BASE_WIDTH, BASE_HEIGHT, boundsForScale, applyInitialZoomAfterLoad } = require('./pet-window-layout');

const html = fs.readFileSync(path.join(__dirname, '../renderer/pet.html'), 'utf8');
assert.match(html, new RegExp(`width: ${BASE_WIDTH}px; height: ${BASE_HEIGHT}px`), 'layout bases match the renderer body');
assert.deepStrictEqual(boundsForScale(0.8), { width: 240, height: 245 });
assert.deepStrictEqual(boundsForScale(1), { width: 300, height: 306 });
assert.deepStrictEqual(boundsForScale(2.5), { width: 750, height: 765 });
assert.deepStrictEqual(boundsForScale(1.1), { width: 330, height: 337 }, 'fractional scales use the same rounded bounds formula');

let didFinishLoad;
let scale = 1;
const applied = [];
const petWindow = {
  isDestroyed: () => false,
  webContents: {
    once: (event, callback) => { assert.strictEqual(event, 'did-finish-load'); didFinishLoad = callback; },
    setZoomFactor: (value) => applied.push(value)
  }
};
applyInitialZoomAfterLoad(petWindow, () => scale);
assert.deepStrictEqual(applied, [], 'initial zoom must not be applied before renderer load completes');
scale = 0.8;
didFinishLoad();
assert.deepStrictEqual(applied, [0.8], 'load completion applies the latest persisted scale');

let destroyedCallback;
const destroyedWindow = {
  isDestroyed: () => true,
  webContents: {
    once: (_event, callback) => { destroyedCallback = callback; },
    setZoomFactor: () => assert.fail('destroyed window must not receive zoom')
  }
};
applyInitialZoomAfterLoad(destroyedWindow, () => 2.5);
destroyedCallback();

const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
assert.match(main, /applyInitialZoomAfterLoad\(petWin[\s\S]*?loadFile\(/, 'initial zoom listener is registered before loadFile');
assert.doesNotMatch(main, /loadFile\(path\.join\(__dirname, '\.\.', 'renderer', 'pet\.html'\)\);\s*petWin\.webContents\.setZoomFactor/, 'no eager zoom races renderer navigation');

console.log('PASS pet scale bounds and initial zoom timing');
