// Real production settings renderer, preload, config IPC and disk persistence.
// Each scenario owns a temporary profile; no provider, global input or user config.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ARG = '--v5-settings-fixture';
const PREFIX = 'V5_SETTINGS_E2E:';

async function waitFor(predicate, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw Error('Timeout: ' + label);
}

async function fixture() {
  const { app, BrowserWindow } = require('electron');
  const directory = process.env.V2P_SETTINGS_TEST_DIR;
  const scenario = process.env.V2P_SETTINGS_SCENARIO;
  const restart = process.env.V2P_SETTINGS_RESTART === '1';
  app.setPath('userData', directory);
  // Visibility alone is overridden: all rendering, preload and IPC stay production.
  app.on('browser-window-created', (_, win) => {
    win.setFocusable(false);
    win.hide();
    win.show = () => {};
    win.showInactive = () => {};
    win.focus = () => {};
  });
  let providerCalls = 0;
  const models = require('./models');
  for (const name of Object.keys(models)) {
    if (/^(chat|transcribe|validate)/i.test(name)) models[name] = async () => {
      providerCalls++;
      throw Error('Provider calls forbidden in settings regression');
    };
  }
  try {
    require('./main');
    await app.whenReady();
    const pet = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/pet.html')), 'production pet');
    await waitFor(() => !pet.webContents.isLoading(), 'pet preload');
    let settings;
    async function open() {
      await pet.webContents.executeJavaScript('window.v2p.openSettings()');
      settings = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/settings.html')), 'settings window');
      await waitFor(() => !settings.webContents.isLoading(), 'settings page');
      await waitFor(() => settings.webContents.executeJavaScript("!!document.querySelector('#prompt-text').value && document.querySelector('#pet-model').options.length > 0"), 'settings loaded via IPC');
    }
    const state = () => settings.webContents.executeJavaScript("({checked:document.querySelector('#insert-mode').checked,seconds:Number(document.querySelector('#undo-toast-seconds').value)})");
    const visionState = () => settings.webContents.executeJavaScript("({hotkey:document.querySelector('#screenshot-hotkey').value,multimodal:document.querySelector('#llm-list .f-multimodal')?.checked ?? false})");
    const persisted = () => JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'));
    async function click(selector) {
      // HTMLElement.click performs checkbox activation and production listeners
      // while the window is hidden, without depending on foreground dispatch.
      await settings.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
    }
    async function reopen(expected) {
      settings.close();
      await waitFor(() => settings.isDestroyed(), 'settings closed');
      await open();
      assert.deepStrictEqual(await state(), expected, 'new settings document reads saved canonical config');
    }
    async function save(checked, inputSeconds, expectedSeconds) {
      if ((await state()).checked !== checked) await click('#insert-mode');
      assert.equal((await state()).checked, checked, 'DOM checkbox activation toggles UI');
      await settings.webContents.executeJavaScript(`(() => {const input=document.querySelector('#undo-toast-seconds');input.value=${JSON.stringify(String(inputSeconds))};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#save-tip').textContent='';})()`);
      await click('#save');
      await waitFor(() => settings.webContents.executeJavaScript("document.querySelector('#save-tip').textContent.includes('已保存')"), 'save handler completed');
      const disk = persisted();
      assert.equal(disk.insertMode, checked ? 'paste' : 'clipboard');
      assert.equal(disk.undoToastSeconds, expectedSeconds);
      assert.equal(Object.hasOwn(disk, 'autoPaste'), false, 'canonical config has no competing boolean');
      assert.deepStrictEqual(await settings.webContents.executeJavaScript('window.v2p.getConfig().then(c=>({insertMode:c.insertMode,seconds:c.undoToastSeconds}))'), {insertMode:disk.insertMode,seconds:expectedSeconds});
      await reopen({ checked, seconds: expectedSeconds });
    }
    async function saveVisionSettings() {
      await click('#llm-add');
      await settings.webContents.executeJavaScript("document.querySelector('.hotkey-capture[data-target=\"screenshot-hotkey\"]').click()");
      await waitFor(() => settings.webContents.executeJavaScript("document.querySelector('.hotkey-capture[data-target=\"screenshot-hotkey\"]').textContent.includes('正在监听')"), 'screenshot recorder started');
      await settings.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
      assert.equal((await visionState()).hotkey, 'Alt+A', 'Escape cancels screenshot recorder');
      await settings.webContents.executeJavaScript("document.querySelector('.hotkey-capture[data-target=\"screenshot-hotkey\"]').click()");
      await waitFor(() => settings.webContents.executeJavaScript("document.querySelector('.hotkey-capture[data-target=\"screenshot-hotkey\"]').textContent.includes('正在监听')"), 'screenshot recorder restarted');
      await settings.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'s',altKey:true,shiftKey:true,bubbles:true,cancelable:true}))");
      const capture = await visionState();
      assert.equal(capture.hotkey, 'Alt+Shift+S', 'screenshot recorder captures its own field');
      await settings.webContents.executeJavaScript("(() => {const row=document.querySelector('#llm-list .provider-row');row.querySelector('.f-model').value='fixture-model';row.querySelector('.f-multimodal').checked=true;})()");
      await click('#save');
      await waitFor(() => settings.webContents.executeJavaScript("document.querySelector('#save-tip').textContent.includes('已保存')"), 'vision settings save completed');
      const disk = persisted();
      assert.equal(disk.screenshotHotkey, 'Alt+Shift+S');
      assert.equal(disk.llmProviders[0].multimodal, true);
      assert.deepStrictEqual(await visionState(), { hotkey: 'Alt+Shift+S', multimodal: true });
      settings.close();
      await waitFor(() => settings.isDestroyed(), 'settings closed after vision save');
      await open();
      assert.deepStrictEqual(await visionState(), { hotkey: 'Alt+Shift+S', multimodal: true }, 'vision settings persist after settings window recreation');
    }
    await open();
    if (restart) {
      assert.deepStrictEqual(await state(), { checked: false, seconds: 37 }, 'fresh Electron process loads saved values from disk');
      assert.deepStrictEqual(await visionState(), { hotkey: 'Alt+Shift+S', multimodal: true }, 'fresh Electron process loads vision settings');
    } else {
      assert.deepStrictEqual(await state(), { checked: scenario === 'default', seconds: 10 }, 'default 10 and canonical/legacy mode load');
      assert.equal((await visionState()).hotkey, 'Alt+A', 'legacy config defaults screenshot hotkey');
      assert.equal((await visionState()).multimodal, false, 'missing legacy capability is unchecked');
      await saveVisionSettings();
      if (scenario === 'legacy-clipboard') await save(false, 10, 10);
      await save(false, 37, 37);
      await save(true, 17, 17);
      // Exercise endpoints and malformed UI values through the real save IPC.
      await save(true, 1, 1);
      await save(false, 120, 120);
      await save(false, 0, 1);
      await save(false, 121, 120);
      await save(true, 12.9, 12);
      await save(false, 37, 37);
    }
    assert.equal(providerCalls, 0);
    console.log(PREFIX + JSON.stringify({ ok: true, scenario, restart, providerCalls }));
  } catch (error) {
    console.error(PREFIX + JSON.stringify({ ok: false, scenario, restart, error: error.stack }));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}

async function child(directory, scenario, restart) {
  await new Promise((resolve, reject) => {
    const processChild = spawn(require('electron'), [__filename, ARG], {
      windowsHide: true,
      env: { ...process.env, V2P_SETTINGS_TEST_DIR: directory, V2P_SETTINGS_SCENARIO: scenario, V2P_SETTINGS_RESTART: restart ? '1' : '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    processChild.stdout.on('data', (data) => { output += data; });
    processChild.stderr.on('data', (data) => { output += data; });
    const timeout = setTimeout(() => processChild.kill(), 90000);
    processChild.on('error', reject);
    processChild.on('close', (code) => {
      clearTimeout(timeout);
      try {
        const line = output.split(/\r?\n/).find((value) => value.startsWith(PREFIX));
        assert.ok(line, output.slice(-2000));
        const result = JSON.parse(line.slice(PREFIX.length));
        assert.equal(result.ok, true, result.error);
        assert.equal(code, 0);
        console.log('PASS production settings UI ' + scenario + (restart ? ' fresh-process persistence' : ' checkbox/save/reopen/duration bounds'));
        resolve();
      } catch (error) { reject(error); }
    });
  });
}

async function run() {
  for (const scenario of ['default', 'legacy-clipboard']) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-v5-settings-'));
    try {
      fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
        asrProviders: [], llmProviders: [], petModel: '', mouseRecord: false,
        hotkey: 'Control+Shift+F12', ...(scenario === 'legacy-clipboard' ? { insertMode: 'clipboard' } : {})
      }));
      await child(directory, scenario, false);
      await child(directory, scenario, true);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
}
if (process.argv.includes(ARG)) fixture();
else run().catch((error) => { console.error(error); process.exitCode = 1; });
