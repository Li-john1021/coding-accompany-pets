const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const FIXTURE_ARG = '--pet-actions-v4-e2e-fixture';
const RESULT_PREFIX = 'PET_ACTIONS_V4_E2E_RESULT:';

function waitFor(predicate, label, timeoutMs = 12000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      let value;
      try { value = await predicate(); } catch (error) { reject(error); return; }
      if (value) { resolve(value); return; }
      if (Date.now() - started >= timeoutMs) { reject(new Error(`Timed out waiting for ${label}`)); return; }
      setTimeout(poll, 40);
    };
    poll();
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function runFixture() {
  const { app, BrowserWindow, clipboard, nativeImage } = require('electron');
  const root = path.resolve(__dirname, '..');
  const userData = process.env.V2P_PET_ACTIONS_E2E_USER_DATA;
  if (!userData) throw new Error('E2E temporary userData path was not supplied');
  app.setPath('userData', userData);
  fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
    asrProviders: [], llmProviders: [], activeAsrId: '', activeLlmId: '',
    petModel: '', petScale: 1, hotkey: 'Control+Shift+F12', mouseRecord: false,
    paletteEnabled: false, insertMode: 'clipboard'
  }), 'utf8');

  const originalFormats = clipboard.availableFormats();
  const originalClipboard = {};
  if (originalFormats.some((format) => /text\/plain/i.test(format))) originalClipboard.text = clipboard.readText();
  if (originalFormats.some((format) => /text\/html/i.test(format))) originalClipboard.html = clipboard.readHTML();
  if (originalFormats.some((format) => /text\/rtf/i.test(format))) originalClipboard.rtf = clipboard.readRTF();
  if (originalFormats.some((format) => /image\/png/i.test(format))) {
    const image = clipboard.readImage();
    if (!image.isEmpty()) originalClipboard.image = image.toPNG();
  }

  const calls = [];
  const captureMetadata = [];
  let sourceHwnd = null;
  const captureModule = require('./pet-action-capture');
  const originalAdapters = captureModule.createWindowsAdapters;
  const { runPowerShellFile } = require('./powershell-file');
  captureModule.createWindowsAdapters = () => {
    const adapters = originalAdapters();
    return { ...adapters, snapshot: async (includeText) => {
      const identity = await adapters.snapshot(false);
      captureMetadata.push(identity && { target: identity.target, sequence: identity.sequence });
      if (!identity || identity.target.hwnd !== sourceHwnd) return null;
      return includeText ? adapters.snapshot(true) : identity;
    } };
  };
  let nextPlan = null;
  const pipeline = require('./pipeline');
  pipeline.processText = async (text, mode) => {
    calls.push({ text, mode });
    const plan = nextPlan;
    nextPlan = null;
    if (plan && plan.pending) {
      plan.entered.resolve();
      await plan.release.promise;
    }
    return plan ? plan.result : { text: `E2E ${mode} result`, mode, degraded: false, note: '' };
  };

  function setPlan(result, pending = false) {
    const plan = { result, pending, entered: deferred(), release: deferred() };
    nextPlan = plan;
    return plan;
  }

  async function action(petWindow, sourceWindow, text, mode, collapsed = false) {
    await sourceWindow.webContents.executeJavaScript(`(() => {
      const field = document.querySelector('textarea');
      field.focus();
      field.setSelectionRange(${collapsed ? text.length : 0}, ${text.length});
      return { readOnly: field.readOnly, selected: field.value.slice(field.selectionStart, field.selectionEnd) };
    })()`);
    sourceWindow.show();
    sourceWindow.focus();
    await waitFor(() => BrowserWindow.getFocusedWindow() === sourceWindow, 'ordinary source host focus');
    const hwnd = Number(sourceWindow.getNativeWindowHandle().readBigUInt64LE());
    await new Promise((resolve, reject) => runPowerShellFile(`
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public class V4OwnFocus {
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a,uint b,bool on);
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
 public static void Focus(long hwnd) { uint p;var current=GetCurrentThreadId();var foreground=GetWindowThreadProcessId(GetForegroundWindow(),out p);var target=GetWindowThreadProcessId((IntPtr)hwnd,out p);AttachThreadInput(current,foreground,true);AttachThreadInput(current,target,true);BringWindowToTop((IntPtr)hwnd);SetForegroundWindow((IntPtr)hwnd);AttachThreadInput(current,target,false);AttachThreadInput(current,foreground,false); }
}
"@
[V4OwnFocus]::Focus(${hwnd})
`, { timeout: 5000, maxBuffer: 4096 }, (error) => error ? reject(error) : resolve()));
    const native = await captureModule.getWindowsSnapshot();
    assert.ok(native && native.target.hwnd === hwnd, 'v4 fixture must hold actual Windows foreground: ' + JSON.stringify(native && native.target));
    sourceWindow.webContents.focus();
    await sourceWindow.webContents.executeJavaScript(`(() => {const field=document.querySelector('textarea');field.focus();field.setSelectionRange(${collapsed ? text.length : 0},${text.length});})()`);

    const box = await petWindow.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('#action-row [data-mode="${mode}"]');
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, disabled: button.disabled };
    })()`);
    assert.strictEqual(box.disabled, false, `${mode} action is enabled`);
    petWindow.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    petWindow.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }

  async function run() {
    assert.strictEqual(process.platform, 'win32', 'the v4 runtime E2E requires Windows');
    require('./main.js');
    await app.whenReady();
    await waitFor(() => BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().endsWith('/renderer/pet.html')), 'production pet window');
    const petWindow = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().endsWith('/renderer/pet.html'));
    await waitFor(() => petWindow.webContents.isLoading() === false, 'pet renderer load');
    assert.strictEqual(petWindow.isFocusable(), false, 'pet window remains non-focusable');
    await petWindow.webContents.executeJavaScript('document.querySelectorAll("#action-row .pet-action").length');

    const sourceWindow = new BrowserWindow({
      x: 40, y: 40, width: 620, height: 190, show: false, alwaysOnTop: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    sourceHwnd = Number(sourceWindow.getNativeWindowHandle().readBigUInt64LE());
    await sourceWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html>
      <meta charset="utf-8"><textarea readonly style="width:580px;height:120px;font-size:18px">${
        'E2E_SOURCE_TEXT_PLACEHOLDER'
      }</textarea>`));

    const contentByStep = [
      '这是结构化操作的合成中文选区。',
      '这是优化操作的合成中文选区。',
      '只读 DOM 文本也应当正常处理。',
      '降级原文仍然需要写入剪贴板。',
      '结构化 fallback 结果也需要写入。',
      '处理中发生其他复制也不能丢弃结果。'
    ];
    await sourceWindow.webContents.executeJavaScript(`document.querySelector('textarea').value = ${JSON.stringify(contentByStep[0])}`);
    clipboard.writeText('E2E clipboard sentinel before selection');
    await sourceWindow.webContents.executeJavaScript(`(() => {
      const field = document.querySelector('textarea');
      field.focus();
      field.setSelectionRange(0, field.value.length);
    })()`);
    sourceWindow.show();
    sourceWindow.focus();
    await waitFor(() => BrowserWindow.getFocusedWindow() === sourceWindow, 'source focus before selection-only check');
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.strictEqual(calls.length, 0, 'selection alone makes no model call');
    assert.strictEqual(clipboard.readText(), 'E2E clipboard sentinel before selection', 'selection alone does not request copy');

    let expectedCalls = 0;
    const checkAction = async (text, mode, result, expectedClipboard, collapsed = false) => {
      await sourceWindow.webContents.executeJavaScript(`document.querySelector('textarea').value = ${JSON.stringify(text)}`);
      const start = calls.length;
      setPlan(result);
      await action(petWindow, sourceWindow, text, mode, collapsed);
      try { await waitFor(() => calls.length === start + 1, `${mode} model call`); }
      catch (error) { throw new Error(error.message + '; capture=' + JSON.stringify(captureMetadata) + '; message=' + await petWindow.webContents.executeJavaScript('document.querySelector("#bubble").textContent')); }
      await waitFor(() => clipboard.readText() === expectedClipboard, `${mode} system clipboard result`);
      assert.deepStrictEqual(calls[start], { text, mode }, `${mode} receives exactly the selected source`);
      const sourceAfter = await sourceWindow.webContents.executeJavaScript(`(() => {
        const field = document.querySelector('textarea');
        return { value: field.value, selected: field.value.slice(field.selectionStart, field.selectionEnd) };
      })()`);
      assert.strictEqual(sourceAfter.value, text, 'the source host text is not replaced');
      assert.strictEqual(BrowserWindow.getFocusedWindow(), sourceWindow, 'the pet click does not steal host focus or auto-paste');
      expectedCalls++;
    };

    await checkAction(contentByStep[0], 'structure', { text: 'E2E 结构化结果', mode: 'structure', degraded: false }, 'E2E 结构化结果');
    await checkAction(contentByStep[1], 'optimize', { text: 'E2E 优化结果', mode: 'optimize', degraded: false }, 'E2E 优化结果');

    const readonlyInfo = await sourceWindow.webContents.executeJavaScript(`(() => {
      const field = document.querySelector('textarea');
      return { readOnly: field.readOnly, editable: field.isContentEditable };
    })()`);
    assert.strictEqual(readonlyInfo.readOnly, true);
    assert.strictEqual(readonlyInfo.editable, false);
    await checkAction(contentByStep[2], 'structure', { text: 'E2E 只读结果', mode: 'structure', degraded: false }, 'E2E 只读结果');

    await checkAction(contentByStep[3], 'optimize', {
      text: contentByStep[3], mode: 'none', degraded: true, note: '已降级为原文'
    }, contentByStep[3]);
    await checkAction(contentByStep[4], 'structure', {
      text: 'E2E fallback 结构化文本', mode: 'structure', degraded: true, note: '处理失败，已降级为结构化'
    }, 'E2E fallback 结构化文本');

    await sourceWindow.webContents.executeJavaScript(`document.querySelector('textarea').value = ${JSON.stringify(contentByStep[5])}`);
    const latePlan = setPlan({ text: 'E2E pending operation result', mode: 'structure', degraded: false }, true);
    const lateStart = calls.length;
    await action(petWindow, sourceWindow, contentByStep[5], 'structure');
    await latePlan.entered.promise;
    clipboard.writeText('E2E unrelated user copy while model is pending');
    latePlan.release.resolve();
    await waitFor(() => clipboard.readText() === 'E2E pending operation result', 'result publication after interleaved user copy');
    assert.deepStrictEqual(calls[lateStart], { text: contentByStep[5], mode: 'structure' });
    expectedCalls++;

    const noSelection = 'E2E source has no active selection';
    await sourceWindow.webContents.executeJavaScript(`document.querySelector('textarea').value = ${JSON.stringify(noSelection)}`);
    clipboard.writeText('E2E pre-existing stale clipboard sentinel');
    const noSelectionStart = calls.length;
    await action(petWindow, sourceWindow, noSelection, 'optimize', true);
    await waitFor(async () => {
      const message = await petWindow.webContents.executeJavaScript('document.querySelector("#bubble").textContent');
      return message.includes('没有检测到新的剪贴板文本') || message.includes('复制内容为空');
    }, 'visible empty-selection capture failure');
    assert.strictEqual(calls.length, noSelectionStart, 'empty selection makes zero model calls');
    assert.strictEqual(clipboard.readText(), 'E2E pre-existing stale clipboard sentinel', 'stale clipboard is not used or overwritten');
    assert.strictEqual(calls.length, expectedCalls, 'each deliberate click reaches exactly one model call');

    const row = await petWindow.webContents.executeJavaScript(`({
      modes: [...document.querySelectorAll('#action-row .pet-action')].map((button) => button.dataset.mode),
      disabledPlaceholder: document.querySelector('[data-mode="image_recognition"]').disabled
    })`);
    assert.deepStrictEqual(row.modes, ['structure', 'optimize', 'image_recognition']);
    assert.strictEqual(row.disabledPlaceholder, true);
    sourceWindow.destroy();
    return { modelCalls: calls.length, clicks: 7, ordinaryHost: 'Electron BrowserWindow textarea (read-only)', clipboardRestored: true };
  }

  run().then((result) => finish(null, result), (error) => finish(error));

  function finish(error, result) {
    try {
      const restore = {};
      if (Object.hasOwn(originalClipboard, 'text')) restore.text = originalClipboard.text;
      if (Object.hasOwn(originalClipboard, 'html')) restore.html = originalClipboard.html;
      if (Object.hasOwn(originalClipboard, 'rtf')) restore.rtf = originalClipboard.rtf;
      if (Object.hasOwn(originalClipboard, 'image')) restore.image = nativeImage.createFromBuffer(originalClipboard.image);
      if (Object.keys(restore).length) clipboard.write(restore);
      else clipboard.clear();
    } catch (restoreError) {
      error = error || restoreError;
    }
    if (error) console.error(`${RESULT_PREFIX}${JSON.stringify({ ok: false, error: error.message || String(error) })}`);
    else console.log(`${RESULT_PREFIX}${JSON.stringify({ ok: true, ...result })}`);
    app.quit();
  }
}

if (process.argv.includes(FIXTURE_ARG)) {
  runFixture();
} else {
  assert.strictEqual(process.platform, 'win32', 'real Electron system clipboard E2E is Windows-only');
  const electronExe = require('electron');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-pet-actions-v4-'));
  const fixture = spawn(electronExe, [__filename, FIXTURE_ARG], {
    cwd: path.resolve(__dirname, '..'),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, V2P_PET_ACTIONS_E2E_USER_DATA: userData }
  });
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => fixture.kill(), 90000);
  fixture.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  fixture.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  fixture.on('close', (code) => {
    clearTimeout(timeout);
    const line = (stdout + '\n' + stderr).split(/\r?\n/).find((entry) => entry.startsWith(RESULT_PREFIX));
    try {
      assert.ok(line, `Electron fixture returned no result (exit ${code}): ${stderr.slice(-1200)}`);
      const result = JSON.parse(line.slice(RESULT_PREFIX.length));
      assert.strictEqual(code, 0, `Electron fixture exit code ${code}: ${stderr.slice(-1200)}`);
      assert.strictEqual(result.ok, true, result.error || 'Electron fixture failed');
      assert.strictEqual(result.modelCalls, 6);
      console.log('PASS real Electron pet action E2E: ordinary host selection, production copy capture, IPC/model mock, direct OS clipboard publication, stale/empty rejection, and clipboard interleaving');
    } catch (error) {
      console.error(error);
      if (stderr) console.error(stderr.slice(-2000));
      process.exitCode = 1;
    } finally {
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });
}
