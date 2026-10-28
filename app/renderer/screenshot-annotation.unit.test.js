const assert = require('assert');
const { drawAnnotations } = require('./screenshot-annotation');

const operations = [];
const context = new Proxy({}, {
  set(target, key, value) { target[key] = value; operations.push(['set', key, value]); return true; },
  get(target, key) {
    if (key in target) return target[key];
    return (...args) => operations.push([key, ...args]);
  }
});
drawAnnotations(context, [
  { type: 'pen', points: [{ x: 10.5, y: 20.25 }, { x: 30.75, y: 40.5 }] },
  { type: 'text', x: 42.5, y: 12.25, text: 'Note' }
], 1000);

assert.deepStrictEqual(operations.find((entry) => entry[0] === 'moveTo'), ['moveTo', 10.5, 20.25]);
assert.deepStrictEqual(operations.find((entry) => entry[0] === 'lineTo'), ['lineTo', 30.75, 40.5]);
assert.ok(operations.some((entry) => entry[0] === 'fillText' && entry[1] === 'Note' && entry[2] === 42.5 && entry[3] === 12.25));
assert.ok(operations.some((entry) => entry[0] === 'set' && entry[1] === 'lineWidth' && entry[2] === 3));
assert.ok(operations.some((entry) => entry[0] === 'set' && entry[1] === 'font' && entry[2].startsWith('bold 25px')));
console.log('PASS screenshot annotation pixel-space drawing commands and source-scaled styling');
