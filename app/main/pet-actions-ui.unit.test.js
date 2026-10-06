const assert = require('assert');
const fs = require('fs');
const path = require('path');
const migrateLegacyPalette = require('./legacy-palette-migration');

const root = path.join(__dirname, '..', 'renderer');
const html = fs.readFileSync(path.join(root, 'pet.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'pet.js'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'settings.html'), 'utf8');
const settingsJs = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');

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
assert.match(js, /e\.target\.closest\('#action-row'\)/, 'releasing a body drag over an action clears the body gesture');
assert.match(js, /\['listening', 'transcribing'\]\.includes\(curStage\)/, 'voice stages block action clicks');
assert.match(js, /activePetAction = mode/, 'processing action enters a visible active state');
assert.match(settings, /mouse-record/);
assert.doesNotMatch(settings, /启用选中浮条|palette-enabled/, 'obsolete palette setting is removed');
assert.doesNotMatch(settingsJs, /palette-enabled|paletteEnabled:/, 'settings cannot re-enable the old palette');
assert.match(main, /const want = cfg\.mouseRecord === true;/, 'hook is not retained by legacy palette configuration');
assert.match(main, /Object\.assign\(cfg, patch\);\s*cfg\.paletteEnabled = false;/, 'saving settings cannot re-enable the legacy palette');
assert.match(main, /v2p:pet-action'[\s\S]*?return \{ ok: false, error: '文本操作暂不可用' \}/, 'current action stub fails closed without model routing');

console.log('PASS pet action layout, pointer isolation, busy state, settings migration, and side-button preservation');
