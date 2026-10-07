// Windows runtime fixture: real production IPC/capture/native paste+undo, synthetic model/ASR.
const assert = require('assert'); const fs = require('fs'); const os = require('os'); const path = require('path'); const { spawn, execFileSync } = require('child_process');
const ARG = '--v5-fixture'; const PREFIX = 'V5_E2E:';
async function waitFor(predicate, label) {
  const end = Date.now() + 18000;
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await new Promise((r) => setTimeout(r, 50)); }
  throw Error('Timeout: ' + label);
}
async function fixture() {
  const { app, BrowserWindow, clipboard, nativeImage } = require('electron');
  app.setPath('userData', process.env.V2P_V5_USER_DATA);
  app.commandLine.appendSwitch('force-renderer-accessibility');
  fs.writeFileSync(path.join(process.env.V2P_V5_USER_DATA, 'config.json'), JSON.stringify({ asrProviders: [], llmProviders: [], petModel: '', insertMode: 'clipboard', mouseRecord: false, hotkey: 'Control+Shift+F12', undoToastSeconds: 10 }));
  const previous = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() };
  const pipeline = require('./pipeline'); let modelCalls = 0, asrCalls = 0; let nextRaw = 'Initial synthetic ASR';
  const captureModule = require('./pet-action-capture'); const snapshots = [];
  const { runPowerShellFile } = require('./powershell-file');
  const nativeKeys = [];
  require('./powershell-file').runPowerShellFile = (script, options, callback) => runPowerShellFile(script, options, (error, stdout, stderr) => {
    if (script.includes('public class V2PTargetKeys')) nativeKeys.push({ error: error ? String(error.message).slice(0, 1600) : null, stdout: String(stdout || ''), stderr: String(stderr || '').slice(0, 1600) });
    callback(error, stdout, stderr);
  });
  const snapshotDelivery = captureModule.getWindowsSnapshot;
  captureModule.getWindowsSnapshot = async (...args) => {
    const result = await snapshotDelivery(...args);
    snapshots.push({ delivery: true, inspectWritable: !!args[1], target: result && result.target });
    return result;
  };
  const createAdapters = captureModule.createWindowsAdapters;
  let nativeReady = null;
  let nativeChild = null;
  let nativeStop = null;
  captureModule.createWindowsAdapters = () => {
    const adapters = createAdapters(); const snapshot = adapters.snapshot;
    return { ...adapters, snapshot: async (...args) => {
      const identity = await snapshot(false);
      const ownElectron = source && identity && identity.target.hwnd === Number(source.getNativeWindowHandle().readBigUInt64LE());
      const ownNative = nativeReady && identity && identity.target.pid === nativeReady.pid && identity.target.focusHwnd === nativeReady.hwnd;
      if (!ownElectron && !ownNative) return null;
      const result = args[0] ? await snapshot(...args) : identity;
      snapshots.push(result && { target: result.target, sequence: result.sequence }); return result;
    } };
  };
  pipeline.processText = async (text, mode) => { modelCalls++; return { text: 'Processed ' + text, mode }; };
  pipeline.run = async (_, __, ___, options) => {
    asrCalls++; assert.equal(options.deferDelivery, true);
    return { raw: nextRaw, polished: options.mode === 'structure' ? 'Voice processed result' : nextRaw,
      mode: options.mode || 'none', preview: !!options.transcriptOnly, inserted: false, copiedOnly: true };
  };
  let source;
  try {
    require('./main'); await app.whenReady();
    app.setAccessibilitySupportEnabled(true);
    const pet = await waitFor(() => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/pet.html')), 'pet');
    await waitFor(() => !pet.webContents.isLoading(), 'pet load');
    source = new BrowserWindow({ x: 50, y: 50, width: 600, height: 200, show: false, alwaysOnTop: true, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    await source.loadURL('data:text/html,' + encodeURIComponent('<textarea style="width:550px;height:120px"></textarea>'));
    async function select(text) {
      await source.webContents.executeJavaScript(`(() => { const f=document.querySelector('textarea'); f.value=${JSON.stringify(text)};f.focus();f.select(); })()`);
      source.show(); source.focus(); await waitFor(() => BrowserWindow.getFocusedWindow() === source, 'source focus');
      const nativeHandle = Number(source.getNativeWindowHandle().readBigUInt64LE());
      await new Promise((resolve, reject) => runPowerShellFile(`
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public class V5FixtureFocus {
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a,uint b,bool on);
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
 public static void Focus(long hwnd) { uint p;var current=GetCurrentThreadId();var foreground=GetWindowThreadProcessId(GetForegroundWindow(),out p);var target=GetWindowThreadProcessId((IntPtr)hwnd,out p);AttachThreadInput(current,foreground,true);AttachThreadInput(current,target,true);BringWindowToTop((IntPtr)hwnd);SetForegroundWindow((IntPtr)hwnd);AttachThreadInput(current,target,false);AttachThreadInput(current,foreground,false); }
}
"@
[V5FixtureFocus]::Focus(${nativeHandle})
`, { timeout: 5000, maxBuffer: 4096 }, (error) => error ? reject(error) : resolve()));
      await waitFor(async () => { const snapshot = await captureModule.getWindowsSnapshot(); return snapshot && snapshot.target.hwnd === nativeHandle; }, 'native foreground source');
      source.webContents.focus();
      await source.webContents.executeJavaScript("(() => {const f=document.querySelector('textarea');f.focus();f.setSelectionRange(0,f.value.length);})()");
      await new Promise((r) => setTimeout(r, 250));
    }
    const value = () => source.webContents.executeJavaScript("document.querySelector('textarea').value");
    const invoke = (expression) => pet.webContents.executeJavaScript(expression);
    async function toastToken() {
      const win = await waitFor(() => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/undo.html') && w.isVisible()), 'undo toast');
      await waitFor(() => !win.webContents.isLoading(), 'undo load');
      assert.equal(win.isFocusable(), false);
      const [width, height] = win.getSize();
      assert.ok(Math.abs(width - 280) <= 1 && Math.abs(height - 76) <= 1, 'fixed toast size allows one DIP of Windows rounding: ' + JSON.stringify({ width, height }));
      const token = await waitFor(() => win.webContents.executeJavaScript('token'), 'opaque token');
      return { win, token };
    }
    async function clickUndo() {
      const { win, token } = await toastToken();
      const bounds = await win.webContents.executeJavaScript("(() => {const b=document.querySelector('#undo').getBoundingClientRect();return {x:b.x+5,y:b.y+5};})()");
      win.webContents.sendInputEvent({ type: 'mouseDown', ...bounds, button: 'left', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', ...bounds, button: 'left', clickCount: 1 });
      await waitFor(() => win.webContents.executeJavaScript("document.querySelector('#undo').hidden"), 'undo completed');
      return token;
    }
    // One real pet button click captures exact text and publishes clipboard.
    const original = ' exact synthetic selected text\n'; clipboard.writeText('v5 fresh capture sentinel'); await select(original);
    await waitFor(() => pet.webContents.executeJavaScript("!document.querySelector('[data-mode=structure]').disabled"), 'action enabled');
    const button = await pet.webContents.executeJavaScript("(() => {const b=document.querySelector('[data-mode=structure]').getBoundingClientRect();return {x:b.x+b.width/2,y:b.y+b.height/2};})()");
    pet.webContents.sendInputEvent({ type: 'mouseDown', ...button, button: 'left', clickCount: 1 });
    pet.webContents.sendInputEvent({ type: 'mouseUp', ...button, button: 'left', clickCount: 1 });
    try { await waitFor(() => clipboard.readText().startsWith('Processed '), 'text clipboard'); }
    catch (error) { throw Error(error.message + '; modelCalls=' + modelCalls + '; bubble=' + await pet.webContents.executeJavaScript("document.querySelector('#bubble').textContent") + '; snapshots=' + JSON.stringify(snapshots) + '; source=' + await source.webContents.executeJavaScript("JSON.stringify({start:document.querySelector('textarea').selectionStart,end:document.querySelector('textarea').selectionEnd,focused:document.activeElement.tagName})")); }
    const capturedOriginal = clipboard.readText().slice('Processed '.length);
    assert.ok(capturedOriginal.replace(/\r\n/g, '\n') === original, 'captured text must match synthetic source');
    assert.equal(await value(), original); await clickUndo(); assert.equal(clipboard.readText(), capturedOriginal);
    // Actual native Ctrl+V replacement and Ctrl+Z restore, with mouseRecord disabled.
    await invoke("window.v2p.saveConfig({insertMode:'paste'})"); await select('Native editable selection');
    const textResult = await invoke("window.v2p.petAction('optimize')");
    assert.equal(textResult.inserted, true, JSON.stringify({ result: textResult, snapshots, nativeKeys }));
    await waitFor(async () => (await value()) === 'Processed Native editable selection', 'native paste');
    assert.equal(BrowserWindow.getFocusedWindow(), source);
    await clickUndo();
    assert.equal(await value(), 'Processed Native editable selection', 'unknown writable evidence leaves Electron target unchanged on Undo');
    assert.equal(clipboard.readText(), 'Native editable selection');
    // A native Edit supplies affirmative writable evidence; prove actual host Undo.
    const directory = process.env.V2P_V5_USER_DATA;
    const readyFile = path.join(directory, 'native-ready.json'); nativeStop = path.join(directory, 'native-stop');
    const focusRequest = path.join(directory, 'native-focus'); const focusAck = path.join(directory, 'native-focus-ack');
    const nativeExe = path.join(directory, 'NativeEditFixture.exe');
    execFileSync(path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), ['/nologo', '/target:winexe', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/out:' + nativeExe, path.join(__dirname, 'fixtures', 'palette-probe-runtime-win32-edit.cs')], { windowsHide: true, timeout: 20000 });
    nativeChild = spawn(nativeExe, [readyFile, nativeStop, focusRequest, focusAck, path.join(directory, 'native-keep-front')], { windowsHide: true, stdio: 'ignore' });
    nativeReady = await waitFor(() => fs.existsSync(readyFile) && JSON.parse(fs.readFileSync(readyFile, 'utf8')), 'native Edit ready');
    await waitFor(async () => { const snapshot = await captureModule.getWindowsSnapshot(); return snapshot && snapshot.target.pid === nativeReady.pid && snapshot.target.focusHwnd === nativeReady.hwnd; }, 'native Edit foreground');
    const { buildNativeEditPowerShell } = require('./win32-edit');
    async function nativeScript(code) { return new Promise((resolve, reject) => runPowerShellFile(buildNativeEditPowerShell() + '\n' + code, { timeout: 5000, maxBuffer: 8192 }, (error, stdout) => error ? reject(error) : resolve(String(stdout).trim()))); }
    const nativeText = () => nativeScript(`[V2PNativeEdit]::ReadText([IntPtr]${nativeReady.hwnd})`);
    const nativeOriginal = await nativeText(); const nativeSelection = nativeOriginal.slice(8, 74);
    clipboard.writeText('native selection sentinel');
    const nativeResult = await invoke("window.v2p.petAction('structure')"); assert.equal(nativeResult.inserted, true, JSON.stringify({ result: nativeResult, snapshots, nativeKeys }));
    assert.equal(await nativeText(), nativeOriginal.slice(0, 8) + 'Processed ' + nativeSelection + nativeOriginal.slice(74));
    await clickUndo(); await waitFor(async () => (await nativeText()) === nativeOriginal, 'native Edit selection Undo');
    // Empty the same own Edit without keyboard input, then use voice delivery + restoration packet.
    await nativeScript(`
Add-Type -TypeDefinition @"
using System;using System.Runtime.InteropServices;
public class V5OwnEdit { [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageW")] public static extern IntPtr SetText(IntPtr h,uint m,IntPtr w,string text); }
"@
[void][V5OwnEdit]::SetText([IntPtr]${nativeReady.hwnd},12,[IntPtr]::Zero,'')
`);
    nextRaw = 'initial synthetic ASR restored in Edit';
    const voicePaste = await invoke("window.v2p.submit([1],'audio/wav',{mode:'structure'})"); assert.equal(voicePaste.inserted, true);
    assert.equal(await nativeText(), 'Voice processed result');
    await clickUndo(); await waitFor(async () => (await nativeText()) === nextRaw, 'native Edit voice Undo restores ASR in target');
    fs.writeFileSync(nativeStop, 'stop');
    await waitFor(() => nativeChild.exitCode !== null, 'native Edit close'); nativeReady = null;
    // Voice's immutable initial source survives preview editing and a second transform.
    await invoke("window.v2p.saveConfig({insertMode:'clipboard',previewEnabled:true,previewSkipChars:1})");
    await select('Voice target'); nextRaw = ' immutable initial synthetic ASR\n';
    const previewResult = await invoke("window.v2p.submit([1,2,3],'audio/wav',{})"); assert.equal(previewResult.preview, true);
    const preview = await waitFor(() => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/preview.html')), 'preview');
    await waitFor(() => !preview.webContents.isLoading(), 'preview load');
    await preview.webContents.executeJavaScript("window.v2p.processText('edited preview buffer','structure')");
    const beforeUndoModels = modelCalls; const beforeUndoAsr = asrCalls;
    const insertion = await preview.webContents.executeJavaScript("window.v2p.previewInsert({text:'final edited result',copyOnly:true})");
    assert.equal(insertion.ok, true); assert.equal(clipboard.readText(), 'final edited result');
    await preview.webContents.executeJavaScript("window.v2p.previewClose({ok:true,text:'final edited result',copiedOnly:true})");
    await clickUndo(); assert.equal(clipboard.readText(), nextRaw); assert.equal(modelCalls, beforeUndoModels); assert.equal(asrCalls, beforeUndoAsr);
    // Raw-only and short-preview bypass still publish and roll back first ASR.
    await invoke("window.v2p.saveConfig({previewEnabled:false})"); await select('raw target'); nextRaw = 'raw only ASR';
    await invoke("window.v2p.submit([1],'audio/wav',{mode:'none'})"); await clickUndo(); assert.equal(clipboard.readText(), nextRaw);
    await invoke("window.v2p.saveConfig({previewEnabled:true,previewSkipChars:120})"); await select('short target'); nextRaw = 'short ASR';
    await invoke("window.v2p.submit([1],'audio/wav',{})"); assert.equal(clipboard.readText(), 'Processed ' + nextRaw);
    await clickUndo(); assert.equal(clipboard.readText(), nextRaw);
    console.log(PREFIX + JSON.stringify({ ok: true, hosts: ['Windows Electron BrowserWindow textarea (unknown writable: clipboard Undo)', 'Windows native Win32 Edit (writable: selection Ctrl+Z, voice Ctrl+Z/Ctrl+V packet)'], text: 'real native capture/paste/undo', voice: 'mock ASR: auto-paste, preview final, raw-only, preview skip', modelCalls, asrCalls }));
  } catch (error) { console.error(PREFIX + JSON.stringify({ ok: false, error: error.stack })); process.exitCode = 1; }
  finally { if (nativeChild && nativeChild.exitCode === null) { if (nativeStop) fs.writeFileSync(nativeStop, 'stop'); nativeChild.kill(); } if (source && !source.isDestroyed()) source.destroy(); clipboard.write(previous); app.quit(); }
}
if (process.argv.includes(ARG)) fixture();
else {
  assert.equal(process.platform, 'win32');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-v5-'));
  const child = spawn(require('electron'), [__filename, ARG], { windowsHide: true, env: { ...process.env, V2P_V5_USER_DATA: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let errors = ''; child.stdout.on('data', (x) => { output += x; }); child.stderr.on('data', (x) => { errors += x; });
  const timeout = setTimeout(() => child.kill(), 120000);
  child.on('close', (code) => { clearTimeout(timeout);
    try { const line = (output + '\n' + errors).split(/\r?\n/).find((x) => x.startsWith(PREFIX)); assert.ok(line, errors.slice(-1500)); const result = JSON.parse(line.slice(PREFIX.length)); assert.equal(result.ok, true, result.error); assert.equal(code, 0); console.log('PASS v5 real Electron/native selected-text paste+undo, nonfocusable toast and mocked voice initial-ASR undo'); }
    catch (e) { console.error(e); process.exitCode = 1; }
    finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
}
