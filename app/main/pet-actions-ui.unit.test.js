const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const migrateLegacyPalette = require('./legacy-palette-migration');

const root = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(root, 'pet.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'pet.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'settings.html'), 'utf8');
const settingsJs = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const gestureContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'pet-gesture.js'), 'utf8'), gestureContext);
const resolveMouseUp = gestureContext.window.resolvePetMouseUp;

const legacy = { paletteEnabled: true, mouseRecord: true, hotkey: 'Control+Space' };
assert.strictEqual(migrateLegacyPalette(legacy), true);
assert.strictEqual(legacy.paletteEnabled, false, 'old enabled palette is migrated off');
assert.strictEqual(legacy.mouseRecord, true, 'side-button preference survives migration');
assert.strictEqual(legacy.hotkey, 'Control+Space', 'other user configuration survives migration');
assert.strictEqual(migrateLegacyPalette(legacy), false, 'migration is idempotent');

const buttons = [...html.matchAll(/class="pet-action"[^>]*>/g)].map((m) => m[0]);
assert.strictEqual(buttons.length, 3, 'three pet action controls render');
assert.deepStrictEqual(buttons.map((button) => (button.match(/data-mode="([^"]+)"/) || [])[1]), ['structure', 'optimize', 'image_recognition']);
assert.match(html, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, 'action row uses equal columns');
assert.match(buttons[2], /disabled/, 'image recognition is disabled');
assert.match(js, /eventName of \['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'wheel'\]/, 'button presses do not reach pet gestures');
assert.match(js, /actionRow\.addEventListener\('wheel'/, 'scrolling in the action row does not scale the pet');
assert.match(js, /releaseAction === 'stop-recording'[\s\S]*?stopRecording\(\)/, 'release disposition stops recording');
assert.match(js, /releaseAction === 'open-settings'[\s\S]*?openSettings\(\)/, 'body click still opens settings');
assert.match(html, /pet-gesture\.js[\s\S]*?pet-action-settlement\.js[\s\S]*?pet\.js/, 'gesture and completion guards load before pet handlers');
assert.match(js, /targetInActionRow:\s*!!\(e\.target\.closest && e\.target\.closest\('#action-row'\)\)/, 'row gap and button releases reach the same decision path');
assert.match(js, /\['listening', 'transcribing'\]\.includes\(curStage\)/, 'voice stages block action clicks');
assert.match(js, /activePetAction = mode/, 'processing action enters a visible active state');
assert.match(js, /window\.petActionSettlement\.invoke\([\s\S]*?voiceUiBusy\(\) \|\| actionVoiceEpoch !== voiceUiEpoch[\s\S]*?setState\('idle'\)/, 'late text-action resolve or rejection cannot overwrite active or superseding voice state');
assert.match(js, /function voiceUiBusy\(\)[\s\S]*?starting \|\| isRecording/, 'voice transitions during microphone startup also guard text completion');
assert.match(settings, /mouse-record/);
assert.doesNotMatch(settings, /启用选中浮条|palette-enabled/, 'obsolete palette setting is removed');
assert.doesNotMatch(settingsJs, /palette-enabled|paletteEnabled:/, 'settings cannot re-enable the old palette');
assert.match(main, /const want = cfg\.mouseRecord === true;/, 'hook is not retained by legacy palette configuration');
assert.match(main, /Object\.assign\(cfg, patch\);\s*cfg\.paletteEnabled = false;/, 'saving settings cannot re-enable the legacy palette');
assert.match(main, /v2p:pet-action'[\s\S]*?petActionWorkflow\.run\(mode\)/, 'pet action IPC delegates capture authorization and model processing to the workflow');

assert.strictEqual(resolveMouseUp({ button: 0, bodyGestureActive: true, targetInActionRow: true, triggerMode: 'hold', recording: true, dragging: false, elapsedMs: 400 }), 'stop-recording', 'hold gesture release over row gap stops recording');
assert.strictEqual(resolveMouseUp({ button: 0, bodyGestureActive: false, targetInActionRow: true, triggerMode: 'hold', recording: false, dragging: false, elapsedMs: 20 }), 'ignore', 'action button mouseup without body mousedown has no recording effect');
assert.strictEqual(resolveMouseUp({ button: 0, bodyGestureActive: true, targetInActionRow: true, triggerMode: 'click', recording: true, dragging: false, elapsedMs: 300 }), 'discard', 'row release does not toggle click mode');
assert.strictEqual(resolveMouseUp({ button: 0, bodyGestureActive: true, targetInActionRow: false, triggerMode: 'click', recording: false, dragging: false, elapsedMs: 300 }), 'toggle-recording', 'ordinary click-mode stage click remains intact');
assert.strictEqual(resolveMouseUp({ button: 0, bodyGestureActive: true, targetInActionRow: false, triggerMode: 'hold', recording: false, dragging: false, elapsedMs: 20 }), 'open-settings', 'ordinary hold-mode pet click still opens settings');
assert.strictEqual(resolveMouseUp({ button: 0, bodyGestureActive: true, targetInActionRow: false, triggerMode: 'hold', recording: true, dragging: true, elapsedMs: 400 }), 'stop-recording', 'hold release preserves recording cleanup after drag cancellation');

console.log('PASS pet action layout, pointer isolation, busy state, settings migration, and side-button preservation');
