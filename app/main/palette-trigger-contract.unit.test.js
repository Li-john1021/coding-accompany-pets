// Static and simulated contract checks for legacy palette eligibility and its retired trigger.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildProbeScript, parseProbeOutput } = require('./palette-probe');
const { shouldShowPalette, meetsMinimumCharacters } = require('./palette-gate');

const root = __dirname;
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const selection = {
  confirmed: true,
  controlId: 'fixture|edit|win32-edit',
  text: '01234567890123456789',
  processName: 'PaletteFixture'
};

assert.strictEqual(meetsMinimumCharacters(null, 20), false, 'missing evidence is rejected before thresholding');
assert.strictEqual(meetsMinimumCharacters({ ...selection, confirmed: false }, 20), false);
assert.strictEqual(meetsMinimumCharacters({ ...selection, text: '' }, 20), false, 'empty selection is rejected');
assert.strictEqual(meetsMinimumCharacters({ ...selection, text: '1234567890123456789' }, 20), false, 'below threshold denies');
assert.strictEqual(meetsMinimumCharacters(selection, 20), true, 'at threshold passes');
assert.strictEqual(meetsMinimumCharacters({ ...selection, text: selection.text + 'x' }, 20), true, 'above threshold passes');
assert.strictEqual(shouldShowPalette({ selection, enabled: true, recording: true, now: 1000 }).reason, 'recording');

for (const provider of ['uia-textpattern', 'uia-valuepattern', 'browser-contenteditable', 'unknown']) {
  const output = JSON.stringify({ ...selection, ok: true, provider, nativeHandle: 2, processId: 1 });
  assert.strictEqual(parseProbeOutput(output), null, `${provider} evidence fails closed`);
}
const probe = buildProbeScript({ x: 10, y: 20 }, { x: 30, y: 40 }, { requireFocusedTarget: true });
assert.match(probe, /unsupported-provider/);
assert.doesNotMatch(probe, /SendInput|keyTap|clipboard|SetFocus|Select\(/i, 'passive probe has no input or clipboard mutation');

assert.doesNotMatch(main, /uIOhook\.on\('mousemove'/, 'legacy drag selection watcher is absent');
assert.doesNotMatch(main, /captureAndShowPalette\(gesture\.start/, 'legacy drag/double-click trigger is absent');
const hook = main.slice(main.indexOf('function setMouseRecordHook()'));
assert.match(hook, /const want = cfg\.mouseRecord === true;/, 'hook registration is controlled only by mouseRecord');
assert.match(hook, /if \(config\.load\(\)\.mouseRecord === true\)/, 'side-button recording route is preserved');

console.log('PASS palette probe/gate checks and disabled legacy trigger with side-button recording preserved');
