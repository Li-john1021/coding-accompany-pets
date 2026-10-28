'use strict';

const assert = require('assert');
const { showAndStabilize, NUDGE_PX } = require('./window-restore');

function fakeWindow({ focusable = false, bounds = { x: 40, y: 40, width: 300, height: 306 }, destroyed = false } = {}) {
  const win = {
    shown: 0,
    bounds: { ...bounds },
    setBoundsCalls: [],
    destroyed,
    show() { win.shown++; },
    isFocusable() { return focusable; },
    isDestroyed() { return win.destroyed; },
    getBounds() { return { ...win.bounds }; },
    setBounds(next) { win.bounds = { ...next }; win.setBoundsCalls.push({ ...next }); }
  };
  return win;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  {
    const win = fakeWindow({ focusable: true });
    assert.equal(showAndStabilize(win), false);
    assert.equal(win.shown, 1);
    assert.equal(win.setBoundsCalls.length, 0, 'focusable windows need no nudge');
  }

  {
    const win = fakeWindow({ focusable: false });
    assert.equal(showAndStabilize(win, { settleMs: 10 }), true);
    assert.equal(win.shown, 1);
    assert.deepStrictEqual(win.bounds, { x: 40, y: 40, width: 300, height: 306 + NUDGE_PX });
    await wait(30);
    assert.deepStrictEqual(win.bounds, { x: 40, y: 40, width: 300, height: 306 });
  }

  {
    const win = fakeWindow({ focusable: false });
    showAndStabilize(win, { settleMs: 15 });
    win.bounds = { x: 80, y: 90, width: 300, height: 306 + NUDGE_PX };
    await wait(40);
    assert.deepStrictEqual(win.bounds, { x: 80, y: 90, width: 300, height: 306 }, 'the nudge keeps a position changed while settling');
  }

  {
    const win = fakeWindow({ focusable: false });
    showAndStabilize(win, { settleMs: 15 });
    win.bounds = { x: 40, y: 40, width: 330, height: 337 };
    await wait(40);
    assert.deepStrictEqual(win.bounds, { x: 40, y: 40, width: 330, height: 337 }, 'a user resize wins over the nudge restore');
  }

  {
    const win = fakeWindow({ focusable: false });
    delete win.isFocusable;
    assert.equal(showAndStabilize(win), false);
    assert.equal(win.setBoundsCalls.length, 0);
  }

  {
    const win = fakeWindow({ focusable: false, destroyed: true });
    assert.equal(showAndStabilize(win), false);
    assert.equal(win.shown, 0);
  }

  {
    const win = fakeWindow({ focusable: false });
    showAndStabilize(win, { settleMs: 20 });
    showAndStabilize(win, { settleMs: 20 });
    assert.equal(win.bounds.height, 306 + NUDGE_PX, 'a second show does not stack the nudge');
    await wait(50);
    assert.equal(win.bounds.height, 306);
  }

  console.log('PASS window restore stabilizes non-focusable windows without disturbing user changes');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });