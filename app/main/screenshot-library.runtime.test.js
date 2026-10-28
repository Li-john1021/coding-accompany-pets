'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ARG = '--screenshot-library-fixture';
const PREFIX = 'SCREENSHOT_LIBRARY:';

async function waitFor(predicate, label, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Timeout: ' + label);
}

function startWhiteForm() {
  const script = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class FormDpi { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value); }
"@
[void][FormDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form
$f.FormBorderStyle = 'None'
$f.StartPosition = 'Manual'
$f.Location = New-Object System.Drawing.Point(100, 100)
$f.ClientSize = New-Object System.Drawing.Size(800, 600)
$f.BackColor = [System.Drawing.Color]::White
$f.TopMost = $true
$f.Show()
$f.Refresh()
[System.Windows.Forms.Application]::DoEvents()
[Console]::Out.WriteLine('FORM_READY')
Start-Sleep -Seconds 40
`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return child;
}

function setCursor() {
  const script = String.raw`
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CursorDpi { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value); [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); }
"@
[void][CursorDpi]::SetProcessDpiAwarenessContext([IntPtr](-4))
[void][CursorDpi]::SetCursorPos(400, 300)
`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error('cursor helper exited ' + code)));
  });
}

async function fixture() {
  const { app, BrowserWindow, clipboard } = require('electron');
  app.setPath('userData', process.env.V2P_LIB_PROFILE);
  let form = null;
  let previous = null;
  try {
    require('./main');
    await app.whenReady();
    form = startWhiteForm();
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('white form did not start')), 8000);
      form.stdout.on('data', (data) => { if (String(data).includes('FORM_READY')) { clearTimeout(timeout); resolve(); } });
      form.on('error', (error) => { clearTimeout(timeout); reject(error); });
    });
    await setCursor();
    require('./main');
    await app.whenReady();
    const pet = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/pet.html')), 'production pet');
    await waitFor(() => !pet.webContents.isLoading(), 'pet preload');
    previous = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF() };
    const previousImage = clipboard.readImage();
    if (!previousImage.isEmpty()) previous.image = previousImage;
    clipboard.writeText('library-screenshot-sentinel');

    const startedAt = Date.now();
    await pet.webContents.executeJavaScript('void window.v2p.screenshot().then(result => window.__shot = result)');
    const libraryWindow = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'screenshots' && win.isVisible()), 'library screenshot window');
    const openMs = Date.now() - startedAt;
    const view = libraryWindow.getBrowserViews()[0];
    assert.ok(view, 'library uses a BrowserView');
    const wc = view.webContents;
    await waitFor(() => wc.executeJavaScript("!!document.querySelector('.screenshots')"), 'library UI root');
    const uiMs = Date.now() - startedAt;
    if (form && form.exitCode === null) { form.kill(); form = null; }
    libraryWindow.setAlwaysOnTop(true, 'screen-saver');
    libraryWindow.focus();
    try { wc.focus(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));

    const dragSelection = async () => {
      await wc.sendInputEvent({ type: 'mouseDown', x: 150, y: 150, button: 'left', clickCount: 1 });
      await wc.sendInputEvent({ type: 'mouseMove', x: 350, y: 300, button: 'left' });
      await wc.sendInputEvent({ type: 'mouseMove', x: 550, y: 450, button: 'left' });
      await wc.sendInputEvent({ type: 'mouseUp', x: 550, y: 450, button: 'left', clickCount: 1 });
    };
    await dragSelection();
    try {
      await waitFor(() => wc.executeJavaScript("!!document.querySelector('.screenshots-operations')"), 'library floating toolbar', 5000);
    } catch {
      await wc.executeJavaScript(`(() => {
        const root = document.querySelector('.screenshots');
        const fire = (type, x, y) => root.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
        fire('mousedown', 150, 150);
        fire('mousemove', 350, 300);
        fire('mousemove', 550, 450);
        fire('mouseup', 550, 450);
      })()`);
      await waitFor(() => wc.executeJavaScript("!!document.querySelector('.screenshots-operations')"), 'library floating toolbar after DOM drag');
    }

    const clickedTextTool = await wc.executeJavaScript(`(() => {
      const icon = document.querySelector('.icon-text');
      const button = icon && icon.closest('.screenshots-button');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(clickedTextTool, true, 'text tool button is present');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const toolTrace = await wc.executeJavaScript(`(() => ({
      buttons: [...document.querySelectorAll('.screenshots-button')].map((b) => ({ title: b.getAttribute('title'), cls: b.className, icon: (b.querySelector('[class^=icon-]') || {}).className || '' })),
      operations: (() => { const e=document.querySelector('.screenshots-operations'); if(!e) return null; const r=e.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })(),
      canvas: (() => { const e=document.querySelector('.screenshots-canvas'); if(!e) return null; const r=e.getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height}; })(),
      textareas: document.querySelectorAll('.screenshots-textarea').length
    }))()`);
    globalThis.__toolTrace = toolTrace;
    console.log('TOOL_TRACE:' + JSON.stringify(toolTrace));
    await wc.sendInputEvent({ type: 'mouseDown', x: 300, y: 300, button: 'left', clickCount: 1 });
    await wc.sendInputEvent({ type: 'mouseUp', x: 300, y: 300, button: 'left', clickCount: 1 });
    try {
      await waitFor(() => wc.executeJavaScript("!!document.querySelector('.screenshots-textarea')"), 'library positioned textarea', 5000);
    } catch {
      await wc.executeJavaScript(`(() => {
        const root = document.querySelector('.screenshots');
        const fire = (type, x, y) => root.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
        fire('mousedown', 300, 300);
        fire('mouseup', 300, 300);
      })()`);
      await waitFor(() => wc.executeJavaScript("!!document.querySelector('.screenshots-textarea')"), 'library positioned textarea after DOM click');
    }
    const textarea = await wc.executeJavaScript(`(() => {
      const el = document.querySelector('.screenshots-textarea');
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return { left: r.left, top: r.top, width: r.width, height: r.height, color: style.color };
    })()`);
    assert.ok(Math.abs(textarea.left - 300) <= 12 && Math.abs(textarea.top - 300) <= 12, `textarea follows the click: ${JSON.stringify(textarea)}`);
    const filled = await wc.executeJavaScript(`(() => {
      const el = document.querySelector('.screenshots-textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, 'Positioned');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      const r = el.getBoundingClientRect();
      return { value: el.value, left: r.left, top: r.top, color: getComputedStyle(el).color };
    })()`);
    assert.equal(filled.value, 'Positioned');
    assert.equal(await pet.webContents.executeJavaScript('window.__shot || null'), null, 'screenshot is still pending while editing');
    assert.equal(clipboard.readText(), 'library-screenshot-sentinel', 'editing does not write the clipboard');
    await wc.executeJavaScript(`(() => {
      const el = document.querySelector('.screenshots-textarea');
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      el.blur();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await wc.executeJavaScript(`(() => {
      const icon = document.querySelector('.icon-brush');
      const button = icon && icon.closest('.screenshots-button');
      if (button) button.click();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    globalThis.__afterTextTrace = await wc.executeJavaScript(`(() => ({
      textareas: document.querySelectorAll('.screenshots-textarea').length,
      textChecked: !!document.querySelector('.icon-text.screenshots-button-checked, .screenshots-button-checked .icon-text'),
      buttons: [...document.querySelectorAll('.screenshots-button')].map((b) => ({ title: b.getAttribute('title'), cls: b.className }))
    }))()`);
    console.log('AFTER_TEXT_TRACE:' + JSON.stringify(globalThis.__afterTextTrace));
    const clickedOk = await wc.executeJavaScript(`(() => {
      const icon = document.querySelector('.icon-ok');
      const button = icon && icon.closest('.screenshots-button');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(clickedOk, true, 'ok button is present');
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      globalThis.__afterOkTrace = await wc.executeJavaScript(`(() => ({
        textareas: document.querySelectorAll('.screenshots-textarea').length,
        textChecked: !!document.querySelector('.icon-text.screenshots-button-checked'),
        ok: !!document.querySelector('.icon-ok'),
        root: !!document.querySelector('.screenshots')
      }))()`);
    } catch (error) {
      globalThis.__afterOkTrace = { destroyed: String(error.message || error) };
    }
    console.log('AFTER_OK_TRACE:' + JSON.stringify(globalThis.__afterOkTrace));

    const result = await waitFor(() => pet.webContents.executeJavaScript('window.__shot || null'), 'library capture result');
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepStrictEqual({ width: result.width, height: result.height }, { width: 400, height: 300 });
    const image = clipboard.readImage();
    assert.equal(image.isEmpty(), false);
    assert.deepStrictEqual(image.getSize(), { width: 400, height: 300 });
    const bitmap = image.getBitmap();
    let textPixels = 0;
    for (let y = 120; y < 190; y++) {
      for (let x = 120; x < 260; x++) {
        const offset = (y * 400 + x) * 4;
        const b = bitmap[offset], g = bitmap[offset + 1], r = bitmap[offset + 2];
        if (r < 200 || g < 200 || b < 200) textPixels++;
      }
    }
    assert.ok(textPixels > 0, 'final clipboard image contains text pixels at the clicked position');
    console.log(PREFIX + JSON.stringify({
      ok: true, result, textarea, filled, textPixels, openMs, uiMs,
      libraryWindow: { title: libraryWindow.getTitle(), bounds: libraryWindow.getBounds() }
    }));
  } catch (error) {
    console.error(PREFIX + JSON.stringify({ ok: false, error: error.stack, trace: globalThis.__toolTrace || null, afterText: globalThis.__afterTextTrace || null, afterOk: globalThis.__afterOkTrace || null }));
    process.exitCode = 1;
  } finally {
    if (form && form.exitCode === null) form.kill();
    if (previous) clipboard.write(previous);
    app.quit();
  }
}

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-lib-shot-'));
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
    asrProviders: [], llmProviders: [], activeAsrId: '', activeLlmId: '',
    hotkey: 'Control+Shift+F12', screenshotHotkey: 'Control+Alt+F12', petModel: 'keyboard', petScale: 1,
    mouseRecord: false, triggerMode: 'hold', insertMode: 'clipboard', previewEnabled: false
  }));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, ARG], {
        windowsHide: true,
        env: { ...process.env, V2P_LIB_PROFILE: directory },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const timeout = setTimeout(() => child.kill(), 120000);
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timeout);
        try {
          const line = output.split(/\r?\n/).find((entry) => entry.startsWith(PREFIX));
          assert.ok(line, output.slice(-5000));
          const result = JSON.parse(line.slice(PREFIX.length));
          assert.equal(result.ok, true, JSON.stringify(result).slice(0, 10000));
          assert.equal(code, 0);
          console.log('PASS electron-screenshots integration: frozen selection, floating toolbar, click-positioned text, clipboard PNG');
          console.log('EVIDENCE ' + JSON.stringify(result));
          resolve();
        } catch (error) { reject(error); }
      });
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv.includes(ARG)) fixture();
else run().catch((error) => { console.error(error); process.exitCode = 1; });