const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Super'];
const MODIFIER_ALIASES = new Map([
  ['cmdorctrl', 'Control'], ['commandorcontrol', 'Control'],
  ['ctrl', 'Control'], ['control', 'Control'], ['alt', 'Alt'],
  ['shift', 'Shift'], ['super', 'Super'], ['meta', 'Super'], ['win', 'Super']
]);

function normalizeAccelerator(value, { allowBlank = false } = {}) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw && allowBlank) return { accelerator: '', canonical: '' };
  if (!raw) throw new Error('快捷键不能为空');

  const parts = raw.split('+').map((part) => part.trim());
  if (parts.some((part) => !part)) throw new Error(`快捷键格式无效：${raw}`);
  const modifiers = [];
  let key = '';
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES.get(part.toLowerCase());
    if (modifier) {
      if (modifiers.includes(modifier)) throw new Error(`快捷键格式无效：${raw}`);
      modifiers.push(modifier);
    } else {
      if (key) throw new Error(`快捷键格式无效：${raw}`);
      key = /^[a-z]$/i.test(part) ? part.toUpperCase() : part;
    }
  }
  if (!key || !modifiers.length) throw new Error(`快捷键格式无效：${raw}`);
  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
  return { accelerator: [...ordered, key].join('+'), canonical: [...ordered, key.toLowerCase()].join('+') };
}

function normalizeMappings(mappings = {}) {
  const voice = normalizeAccelerator(mappings.voice, { allowBlank: true });
  const screenshot = normalizeAccelerator(mappings.screenshot);
  if (voice.canonical && voice.canonical === screenshot.canonical) {
    throw new Error(`录音与截图热键重复：${voice.accelerator}`);
  }
  return { voice: voice.accelerator || '', screenshot: screenshot.accelerator };
}

function createGlobalHotkeyManager({ adapter, callbacks, initialMappings = { voice: '', screenshot: 'Alt+A' } }) {
  if (!adapter || !['register', 'unregister', 'isRegistered'].every((name) => typeof adapter[name] === 'function')) {
    throw new TypeError('Hotkey adapter must provide register, unregister and isRegistered');
  }
  const owned = new Map();
  let desired = { voice: '', screenshot: 'Alt+A' };
  try { desired = normalizeMappings(initialMappings); } catch { }
  let suspended = false;

  function unregisterOwned() {
    const removed = [];
    for (const [role, accelerator] of [...owned]) {
      if (adapter.unregister(accelerator) === false) throw new Error(`无法释放${role === 'voice' ? '录音' : '截图'}热键 ${accelerator}`);
      owned.delete(role);
      removed.push([role, accelerator]);
    }
    return removed;
  }

  function install(mappings) {
    for (const role of ['voice', 'screenshot']) {
      const accelerator = mappings[role];
      if (!accelerator) continue;
      let ok;
      try { ok = adapter.register(accelerator, callbacks[role]); }
      catch (error) { throw new Error(`${role === 'voice' ? '录音' : '截图'}热键 ${accelerator} 注册失败：${error.message || error}`); }
      if (!ok) throw new Error(`${role === 'voice' ? '录音' : '截图'}热键 ${accelerator} 注册失败，可能被其他程序占用`);
      owned.set(role, accelerator);
    }
  }

  function restore(previous) {
    unregisterOwned();
    for (const role of ['voice', 'screenshot']) {
      if (owned.has(role) || !previous[role]) continue;
      let ok;
      try { ok = adapter.register(previous[role], callbacks[role]); }
      catch (error) { throw new Error(`${role === 'voice' ? '录音' : '截图'}热键恢复失败：${error.message || error}`); }
      if (!ok) throw new Error(`${role === 'voice' ? '录音' : '截图'}热键恢复失败，可能被其他程序占用：${previous[role]}`);
      owned.set(role, previous[role]);
    }
  }

  function apply(next) {
    let candidate;
    try { candidate = normalizeMappings(next); }
    catch (error) { return { ok: false, error: error.message, mappings: { ...desired } }; }
    if (suspended && (candidate.voice !== desired.voice || candidate.screenshot !== desired.screenshot)) {
      return { ok: false, error: '快捷键录制期间不能修改热键，请先结束录制', mappings: { ...desired } };
    }
    const mappingsMatch = candidate.voice === desired.voice && candidate.screenshot === desired.screenshot;
    const installedMatch = ['voice', 'screenshot'].every((role) =>
      candidate[role] ? owned.get(role) === candidate[role] : !owned.has(role));
    if (mappingsMatch && (suspended || installedMatch)) {
      return { ok: true, mappings: { ...desired } };
    }
    const previous = { ...desired };
    if (suspended) { desired = candidate; return { ok: true, mappings: { ...desired } }; }
    try {
      unregisterOwned();
      install(candidate);
      desired = candidate;
      return { ok: true, mappings: { ...desired } };
    } catch (error) {
      let rollbackError = '';
      try { restore(previous); }
      catch (restoreFailure) { rollbackError = `；恢复原热键失败：${restoreFailure.message || restoreFailure}`; }
      return { ok: false, error: `${error.message || error}${rollbackError}`, mappings: { ...desired } };
    }
  }

  function suspend() {
    if (suspended) return { ok: true, mappings: { ...desired } };
    try {
      unregisterOwned();
      suspended = true;
      return { ok: true, mappings: { ...desired } };
    } catch (error) {
      let restoreError = '';
      try { restore(desired); }
      catch (restoreFailure) { restoreError = `；恢复热键失败：${restoreFailure.message || restoreFailure}`; }
      return { ok: false, error: `${error.message || error}${restoreError}`, mappings: { ...desired } };
    }
  }

  function resume() {
    if (!suspended) return { ok: true, mappings: { ...desired } };
    const previous = { ...desired };
    suspended = false;
    try {
      install(previous);
      return { ok: true, mappings: { ...desired } };
    } catch (error) {
      try { unregisterOwned(); } catch { }
      suspended = true;
      return { ok: false, error: error.message || String(error), mappings: { ...desired } };
    }
  }

  return {
    apply,
    suspend,
    resume,
    dispose() {
      try { unregisterOwned(); return { ok: true, mappings: { ...desired } }; }
      catch (error) { return { ok: false, error: error.message || String(error), mappings: { ...desired } }; }
    },
    getMappings: () => ({ ...desired }),
    getRegisteredMappings: () => Object.fromEntries(owned),
    isSuspended: () => suspended,
    isRegistered: (accelerator) => adapter.isRegistered(accelerator)
  };
}

function applyConfigPatchTransaction({ configObject, patch, save, hotkeys }) {
  if (!configObject || !patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { ok: false, error: '配置格式无效' };
  }
  const previous = JSON.parse(JSON.stringify(configObject));
  const candidate = { ...previous, ...patch, paletteEnabled: false };
  const changed = 'hotkey' in patch || 'screenshotHotkey' in patch;
  let oldMappings;
  let nextMappings;
  if (changed) {
    try {
      oldMappings = normalizeMappings({ voice: previous.hotkey || '', screenshot: previous.screenshotHotkey || 'Alt+A' });
      nextMappings = normalizeMappings({ voice: candidate.hotkey || '', screenshot: candidate.screenshotHotkey || 'Alt+A' });
    } catch (error) {
      return { ok: false, error: error.message, mappings: hotkeys.getMappings() };
    }
    candidate.hotkey = nextMappings.voice;
    candidate.screenshotHotkey = nextMappings.screenshot;
  }
  if (changed) {
    const result = hotkeys.apply(nextMappings);
    if (!result.ok) return result;
  }

  for (const key of Object.keys(configObject)) delete configObject[key];
  Object.assign(configObject, candidate);
  try {
    save();
    return { ok: true };
  } catch (error) {
    for (const key of Object.keys(configObject)) delete configObject[key];
    Object.assign(configObject, previous);
    const rollback = changed ? hotkeys.apply(oldMappings) : { ok: true };
    const rollbackError = rollback.ok ? '' : `；热键回滚失败：${rollback.error}`;
    return { ok: false, error: `配置保存失败：${error.message || error}${rollbackError}` };
  }
}

module.exports = { createGlobalHotkeyManager, normalizeAccelerator, normalizeMappings, applyConfigPatchTransaction };
