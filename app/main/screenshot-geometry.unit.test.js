const assert = require('assert');
const { normalizeRect, planComposition, isSelectionWithinDisplays } = require('./screenshot-geometry');

const screens = [
  { id: 'left', bounds: { x: -4, y: 0, width: 4, height: 2 }, pixelWidth: 4, pixelHeight: 2 },
  { id: 'right', bounds: { x: 0, y: 0, width: 4, height: 2 }, pixelWidth: 8, pixelHeight: 4 }
];
assert.deepStrictEqual(normalizeRect({ x: 2, y: 2 }, { x: -2, y: -1 }), { x: -2, y: -1, width: 4, height: 3 });
assert.equal(normalizeRect({ x: 0, y: 0 }, { x: 0, y: 5 }), null);
const selection = { x: -2, y: 0, width: 4, height: 2 };
const plan = planComposition(selection, screens);
assert.deepStrictEqual({ width: plan.width, height: plan.height, scale: plan.scale }, { width: 8, height: 4, scale: 2 });
assert.deepStrictEqual(plan.parts.map((part) => part.source), [
  { x: 2, y: 0, width: 2, height: 2 },
  { x: 0, y: 0, width: 4, height: 4 }
]);
assert.deepStrictEqual(plan.parts.map((part) => part.destination), [
  { x: 0, y: 0, width: 4, height: 4 },
  { x: 4, y: 0, width: 4, height: 4 }
]);
assert.equal(isSelectionWithinDisplays(selection, screens), true);
assert.equal(isSelectionWithinDisplays({ x: -5, y: 0, width: 10, height: 2 }, screens), false);
const staggered = [
  { id: 'a', bounds: { x: 0, y: 0, width: 100, height: 100 }, pixelWidth: 100, pixelHeight: 100 },
  { id: 'b', bounds: { x: 100, y: 20, width: 100, height: 80 }, pixelWidth: 200, pixelHeight: 160 }
];
assert.equal(!!isSelectionWithinDisplays({ x: 90, y: 10, width: 30, height: 30 }, staggered), true, 'cross-screen selections can contain a virtual-desktop gap');
assert.equal(isSelectionWithinDisplays({ x: 110, y: 0, width: 10, height: 10 }, staggered), false, 'a gap alone is not screen content');
console.log('PASS screenshot geometry negative origins, mixed scale crop, output mapping and bounds');
