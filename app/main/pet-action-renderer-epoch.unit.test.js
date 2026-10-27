const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { invoke } = require('../renderer/pet-action-settlement');

function createRendererHarness(options = {}) {
  const state = { microphoneCalls: 0 };
  const timers = [];
  const listeners = new Map();
  const elements = new Map();
  const makeElement = (name) => {
    const handlers = new Map();
    const classes = new Set();
    const element = {
      name, className: 'idle', textContent: '', innerHTML: '', disabled: false, dataset: {},
      classList: {
        add(value) { classes.add(value); },
        remove(value) { classes.delete(value); },
        contains(value) { return classes.has(value) || element.className.split(/\s+/).includes(value); },
        toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); }
      },
      addEventListener(event, handler) { handlers.set(event, handler); },
      setAttribute() {}, removeAttribute() {},
      get handler() { return (event) => handlers.get(event); }
    };
    elements.set(name, element);
    return element;
  };
  const stage = makeElement('stage');
  const petImg = makeElement('pet');
  const status = makeElement('status');
  const bubble = makeElement('bubble');
  const actionRow = makeElement('action-row');
  const buttons = ['structure', 'optimize', 'screenshot', 'image_recognition'].map((mode) => {
    const button = makeElement(`button-${mode}`);
    button.dataset.mode = mode;
    return button;
  });
  const v2p = {
    petAction: async (mode) => ({ ok: true, capture: { kind: 'authorized' }, note: '', mode }),
    screenshot: async () => ({ ok: true, width: 10, height: 10 }),
    recognizeImage: async () => ({ ok: false }), getImageState: async () => ({ eligible: false, busy: false }), onImageState(callback) { listeners.set('imageState', callback); },
    setRecordingFlag() { return { ok: !options.denyRecording, error: '结果正在写入' }; },
    onState(callback) { listeners.set('state', callback); },
    onLoudness() {}, onProbe() {}, onResult(callback) { listeners.set('result', callback); },
    onToast(callback) { listeners.set('toast', callback); },
    onHotkeyStart(callback) { listeners.set('hotkeyStart', callback); },
    onHotkeyStop() {}, onPetImageChanged() {},
    getConfig: async () => ({}), onTriggerModeChanged() {},
    petModel: async () => ({ url: '' }), petImage: async () => ({ dataUrl: '' }),
    onPetModelChanged() {},
    petMove() {}, petScale() {}, openSettings() {}
  };
  const window = {
    v2p, petActionSettlement: { invoke },
    petLive2d: { active: () => false, setState() {}, setLoudness() {} },
    addEventListener() {}
  };
  const document = {
    getElementById(id) { return elements.get(id); },
    querySelectorAll() { return buttons; },
    createElement() { return { getContext() { return null; } }; }
  };
  const context = {
    window, document,
    navigator: { mediaDevices: { getUserMedia: () => { state.microphoneCalls++; return new Promise(() => {}); } } },
    performance: { now: () => 100 },
    console: { log() {}, warn() {}, error() {} },
    setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    Math, Map, Set, Uint8Array, Float32Array, DataView, ArrayBuffer, Promise
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'pet.js'), 'utf8'), context,
    { filename: 'pet.js' });
  return {
    stage, buttons, timers, listeners, state,
    clickAction: () => buttons[0].handler('click')({ stopPropagation() {} }),
    fireDelay(delay) { for (const timer of timers.filter((item) => item.delay === delay && !item.cleared)) timer.callback(); }
  };
}

(async () => {
  const h = createRendererHarness();
  await h.clickAction();
  assert.match(h.stage.className, /^done/);
  h.listeners.get('hotkeyStart')();
  assert.match(h.stage.className, /^listening/, 'voice starts after text completion');
  h.fireDelay(5000);
  assert.match(h.stage.className, /^listening/, 'completion timer cannot overwrite a newer voice state');

  const ordinary = createRendererHarness();
  await ordinary.clickAction();
  ordinary.fireDelay(5000);
  assert.match(ordinary.stage.className, /^idle/, 'normal completion still returns to idle');
  const denied = createRendererHarness({ denyRecording: true });
  denied.listeners.get('hotkeyStart')();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(denied.state.microphoneCalls, 0, 'rejected main admission must not start microphone capture');
  assert.match(denied.stage.className, /^idle/, 'recording denial restores the previous voice UI state');
  console.log('PASS renderer VM completion timer respects voice epoch and preserves ordinary idle transition');
})().catch((error) => { console.error(error); process.exitCode = 1; });
