// Static and simulated contract checks for trigger cases without a live GUI provider.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildProbeScript, parseProbeOutput } = require('./palette-probe');
const { shouldShowPalette, meetsMinimumCharacters } = require('./palette-gate');

const root = __dirname;
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, '../renderer/palette.js'), 'utf8');
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

const keydownStart = main.indexOf("uIOhook.on('keydown'");
const keydownEnd = main.indexOf("uIOhook.start()", keydownStart);
const keydown = main.slice(keydownStart, keydownEnd);
assert.ok(keydownStart >= 0 && keydownEnd > keydownStart);
assert.match(keydown, /e\.keycode === 46 && \(e\.ctrlKey \|\| e\.metaKey\)/, 'copy gesture is observed');
assert.match(keydown, /lastUserCopyAt = Date\.now\(\)/, 'copy gesture only suppresses a nearby palette');
assert.doesNotMatch(keydown, /preventDefault|stopPropagation|keyTap|SendInput/i, 'copy is not intercepted or synthesized');
assert.match(main, /if \(gestureId !== selectionGestureId \|\| recordingActive\) return;/, 'recording suppresses late probe completion');
assert.match(main, /recording: recordingActive/, 'recording state reaches the eligibility gate');
assert.match(renderer, /onPaletteShow/, 'palette has a display event');
assert.match(renderer, /paletteRun\(mode, selectionId\)/, 'processing is submitted through an explicit mode action');

console.log('PASS palette trigger threshold, recording, passive probe, provider, and copy contracts (static/simulated)');
