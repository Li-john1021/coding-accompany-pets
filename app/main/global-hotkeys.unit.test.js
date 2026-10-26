const assert = require('assert');
const {
  createGlobalHotkeyManager,
  normalizeAccelerator,
  applyConfigPatchTransaction
} = require('./global-hotkeys');

function fixture() {
  const registrations = new Map();
  const external = new Set();
  const attempts = [];
  let fail = null;
  const adapter = {
    register(accelerator, callback) {
      attempts.push(['register', accelerator]);
      if (fail === accelerator || external.has(accelerator) || registrations.has(accelerator)) return false;
      registrations.set(accelerator, callback);
      return true;
    },
    unregister(accelerator) {
      attempts.push(['unregister', accelerator]);
      return registrations.delete(accelerator);
    },
    isRegistered(accelerator) { return registrations.has(accelerator) || external.has(accelerator); }
  };
  const calls = { voice: 0, screenshot: 0 };
  const callbacks = { voice() { calls.voice++; }, screenshot() { calls.screenshot++; } };
  const manager = createGlobalHotkeyManager({ adapter, callbacks });
  return { manager, registrations, external, attempts, calls, setFail(value) { fail = value; } };
}

const f = fixture();
assert.deepStrictEqual(normalizeAccelerator(' alt + shift + a '), { accelerator: 'Alt+Shift+A', canonical: 'Alt+Shift+a' });
assert.deepStrictEqual(normalizeAccelerator('CommandOrControl+Alt+A'), normalizeAccelerator('Control+Alt+A'), 'Windows modifier aliases normalize to the same accelerator');
assert.deepStrictEqual(f.manager.apply({ voice: 'Control+Shift+Space', screenshot: 'Alt+A' }), {
  ok: true, mappings: { voice: 'Control+Shift+Space', screenshot: 'Alt+A' }
});
assert.deepStrictEqual(f.manager.getRegisteredMappings(), { voice: 'Control+Shift+Space', screenshot: 'Alt+A' });
f.registrations.get('Control+Shift+Space')();
f.registrations.get('Alt+A')();
assert.deepStrictEqual(f.calls, { voice: 1, screenshot: 1 }, 'each accelerator invokes only its assigned callback');

const beforeDuplicate = [...f.attempts];
const duplicate = f.manager.apply({ voice: 'alt+shift+a', screenshot: 'Alt+Shift+A' });
assert.equal(duplicate.ok, false);
assert.match(duplicate.error, /重复/);
assert.deepStrictEqual(f.attempts, beforeDuplicate, 'duplicate rejected before touching registrations');
assert.deepStrictEqual(f.manager.getMappings(), { voice: 'Control+Shift+Space', screenshot: 'Alt+A' });

f.external.add('Control+Alt+X');
const occupied = f.manager.apply({ voice: 'Control+Alt+S', screenshot: 'Control+Alt+X' });
assert.equal(occupied.ok, false);
assert.match(occupied.error, /占用/);
assert.deepStrictEqual(f.manager.getMappings(), { voice: 'Control+Shift+Space', screenshot: 'Alt+A' });
assert.deepStrictEqual(f.manager.getRegisteredMappings(), { voice: 'Control+Shift+Space', screenshot: 'Alt+A' });
assert.equal(f.external.has('Control+Alt+X'), true, 'transaction never unregisters unrelated registrations');

f.setFail('Control+Alt+X');
const partial = f.manager.apply({ voice: 'Control+Alt+S', screenshot: 'Control+Alt+X' });
assert.equal(partial.ok, false);
assert.deepStrictEqual(f.manager.getRegisteredMappings(), { voice: 'Control+Shift+Space', screenshot: 'Alt+A' }, 'partial install is removed and old pair restored');

const config = { hotkey: 'Control+Shift+Space', screenshotHotkey: 'Alt+A', promptText: 'keep', paletteEnabled: true };
const disk = { ...config };
const beforeRejectedSave = JSON.stringify(config);
const invalidSave = applyConfigPatchTransaction({
  configObject: config,
  patch: { screenshotHotkey: 'Alt++A' },
  save() { throw Error('must not save invalid accelerator'); },
  hotkeys: f.manager
});
assert.equal(invalidSave.ok, false);
assert.match(invalidSave.error, /格式无效/);
assert.equal(JSON.stringify(config), beforeRejectedSave, 'invalid accelerator leaves config untouched');
const rejectedSave = applyConfigPatchTransaction({
  configObject: config,
  patch: { hotkey: 'Control+Alt+S', screenshotHotkey: 'Control+Alt+X' },
  save() { Object.assign(disk, config); },
  hotkeys: f.manager
});
assert.equal(rejectedSave.ok, false);
assert.equal(JSON.stringify(config), beforeRejectedSave, 'registration failure leaves in-memory config untouched');
assert.deepStrictEqual(disk, { hotkey: 'Control+Shift+Space', screenshotHotkey: 'Alt+A', promptText: 'keep', paletteEnabled: true }, 'registration failure never persists candidate config');

f.setFail(null);
assert.equal(f.manager.suspend().ok, true);
const suspendedMappings = f.manager.getMappings();
const suspendedSave = applyConfigPatchTransaction({
  configObject: config,
  patch: { hotkey: 'Control+Alt+S' },
  save() { Object.assign(disk, config); },
  hotkeys: f.manager
});
assert.equal(suspendedSave.ok, false, 'changed mappings are rejected during capture');
assert.equal(JSON.stringify(config), beforeRejectedSave);
assert.deepStrictEqual(f.manager.getMappings(), suspendedMappings);
assert.equal(f.manager.resume().ok, true);
assert.deepStrictEqual(f.manager.getRegisteredMappings(), suspendedMappings);

const saveFailure = applyConfigPatchTransaction({
  configObject: config,
  patch: { hotkey: 'Control+Alt+S', screenshotHotkey: 'Control+Alt+T', promptText: 'changed' },
  save() { throw Error('disk unavailable'); },
  hotkeys: f.manager
});
assert.equal(saveFailure.ok, false);
assert.match(saveFailure.error, /disk unavailable/);
assert.equal(JSON.stringify(config), beforeRejectedSave, 'persistence failure restores in-memory config');
assert.deepStrictEqual(f.manager.getMappings(), { voice: 'Control+Shift+Space', screenshot: 'Alt+A' }, 'persistence failure restores registered pair');
assert.deepStrictEqual(f.manager.getRegisteredMappings(), { voice: 'Control+Shift+Space', screenshot: 'Alt+A' });

const legacy = fixture();
assert.equal(legacy.manager.apply({ voice: '', screenshot: 'Alt+A' }).ok, true, 'blank voice shortcut remains supported');
assert.deepStrictEqual(legacy.manager.getRegisteredMappings(), { screenshot: 'Alt+A' });
assert.equal(legacy.manager.suspend().ok, true);
assert.equal(legacy.manager.suspend().ok, true, 'suspend is idempotent');
assert.equal(legacy.manager.resume().ok, true);
assert.equal(legacy.manager.resume().ok, true, 'resume is idempotent');
assert.equal(legacy.manager.dispose().ok, true);
assert.deepStrictEqual(legacy.manager.getRegisteredMappings(), {});

console.log('PASS transactional dual hotkey manager, ownership, capture suspension and config rollback');
