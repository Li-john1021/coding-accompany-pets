const assert = require('assert');
const { EventEmitter } = require('events');
const { createInputDirtyGuard } = require('./input-dirty-guard');
const hook = new EventEmitter(); let starts = 0, dirty = 0, sides = 0;
hook.start = () => { starts++; }; hook.stop = () => {};
const guard = createInputDirtyGuard({ hook, markDirty: () => { dirty++; },
  isToastPoint: (x, y) => x === 100 && y === 200, onSideButton: () => { sides++; } });
guard.start(); guard.start(); assert.equal(starts, 1);
assert.equal(hook.listenerCount('mousedown'), 1); assert.equal(hook.listenerCount('keydown'), 1);
hook.emit('keydown', { keycode: 30 }); assert.equal(dirty, 1);
hook.emit('mousedown', { x: 100, y: 200, button: 1 }); assert.equal(dirty, 1, 'toast does not dirty source');
hook.emit('mousedown', { x: 0, y: 0, button: 4 }); assert.equal(dirty, 2); assert.equal(sides, 1);
guard.stop(); guard.start(); assert.equal(starts, 2); assert.equal(hook.listenerCount('mousedown'), 1);
console.log('PASS v5 dirty guard listener uniqueness, keyboard/external mouse, popup exclusion and side button');
