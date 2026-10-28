'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { encodePcmWav } = require('./audio-chunks');

const ARG = '--screenshot-native-fixture';
const PREFIX = 'SCREENSHOT_NATIVE:';

async function waitFor(predicate, label, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Timeout: ' + label);
}

function startInputHelper() {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class V2PInput {
  [StructLayout(LayoutKind.Sequential)] public struct MOUSE { public int x,y; public uint data,flags,time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSE mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION data; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  public static uint Down() { INPUT[] i = new INPUT[1]; i[0].type=0; i[0].data.mouse.flags=0x0002; return SendInput(1,i,Marshal.SizeOf(typeof(INPUT))); }
  public static uint Up() { INPUT[] i = new INPUT[1]; i[0].type=0; i[0].data.mouse.flags=0x0004; return SendInput(1,i,Marshal.SizeOf(typeof(INPUT))); }
}
"@ -ErrorAction Stop
[void][V2PInput]::SetProcessDpiAwarenessContext([IntPtr](-4))
[Console]::Out.WriteLine('INPUT_READY')
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'move' { [void][V2PInput]::SetCursorPos([int]$p[1],[int]$p[2]); Start-Sleep -Milliseconds 40 }
      'down' { if ([V2PInput]::Down() -ne 1) { throw 'SendInput down failed' }; Start-Sleep -Milliseconds 60 }
      'up' { if ([V2PInput]::Up() -ne 1) { throw 'SendInput up failed' }; Start-Sleep -Milliseconds 60 }
      'click' { [void][V2PInput]::SetCursorPos([int]$p[1],[int]$p[2]); Start-Sleep -Milliseconds 60; if ([V2PInput]::Down() -ne 1) { throw 'SendInput click down failed' }; Start-Sleep -Milliseconds 60; if ([V2PInput]::Up() -ne 1) { throw 'SendInput click up failed' }; Start-Sleep -Milliseconds 150 }
      'type' { [System.Windows.Forms.SendKeys]::SendWait($p[1]); Start-Sleep -Milliseconds 120 }
    }
    [Console]::Out.WriteLine('OK ' + $line)
  } catch { [Console]::Out.WriteLine('ERR ' + $_.Exception.Message) }
}`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === 'INPUT_READY') { readyResolve(); continue; }
      const waiter = waiters.shift();
      if (waiter) waiter(line.startsWith('OK') ? null : new Error(line));
    }
  });
  child.stderr.on('data', () => {});
  return {
    ready,
    send(command) {
      return new Promise((resolve, reject) => {
        waiters.push((error) => error ? reject(error) : resolve());
        child.stdin.write(command + '\n');
      });
    },
    close() { try { child.kill(); } catch {} }
  };
}

async function fixture() {
  const { app, BrowserWindow, clipboard, screen } = require('electron');
  app.setPath('userData', process.env.V2P_NATIVE_PROFILE);
  let marker = null;
  let input = null;
  let previous = null;
  try {
    require('./main');
    await app.whenReady();
    const pet = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/pet.html')), 'production pet');
    await waitFor(() => !pet.webContents.isLoading(), 'pet preload');
    pet.hide();
    const display = screen.getPrimaryDisplay();
    const native = screen.dipToScreenRect(null, display.bounds);
    const scale = display.scaleFactor;
    const markerRect = { x: native.x + 100, y: native.y + 100, width: 80, height: 30 };
    marker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command',
      'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class MarkerDpi{[DllImport("user32.dll")]public static extern bool SetProcessDpiAwarenessContext(IntPtr value);}\'; [void][MarkerDpi]::SetProcessDpiAwarenessContext([IntPtr](-4)); Add-Type -AssemblyName System.Windows.Forms; function Marker($x,$y,$color){$f=New-Object System.Windows.Forms.Form;$f.FormBorderStyle="None";$f.StartPosition="Manual";$f.Location=New-Object System.Drawing.Point($x,$y);$f.ClientSize=New-Object System.Drawing.Size(40,30);$f.BackColor=[System.Drawing.Color]::FromName($color);$f.TopMost=$true;$f.Show();$f.Refresh();return $f}; $left=Marker ' + markerRect.x + ' ' + markerRect.y + ' Magenta; $right=Marker ' + (markerRect.x + 40) + ' ' + markerRect.y + ' Lime; [System.Windows.Forms.Application]::DoEvents(); [Console]::Out.WriteLine("MARKER_READY"); Start-Sleep -Seconds 60'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('marker window did not start')), 8000);
      marker.stdout.on('data', (data) => { if (String(data).includes('MARKER_READY')) { clearTimeout(timeout); resolve(); } });
      marker.on('error', (error) => { clearTimeout(timeout); reject(error); });
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    input = startInputHelper();
    await input.ready;

    previous = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF() };
    const previousImage = clipboard.readImage();
    if (!previousImage.isEmpty()) previous.image = previousImage;
    clipboard.writeText('native-screenshot-sentinel');

    await pet.webContents.executeJavaScript('void window.v2p.screenshot().then(result => window.__nativeShot = result)');
    const overlayFor = () => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.webContents.getURL().endsWith('/screenshot.html') && win.isVisible() && Math.abs(win.getBounds().x - display.bounds.x) < 2);
    const overlay = await waitFor(() => overlayFor(), 'native selector');
    assert.equal(await overlay.webContents.executeJavaScript('document.getElementById("screen").naturalWidth > 0'), true, 'overlay shows a decoded frozen image');

    const startX = markerRect.x, startY = markerRect.y;
    const endX = markerRect.x + markerRect.width, endY = markerRect.y + markerRect.height;
    await input.send(`move ${startX} ${startY}`);
    await input.send('down');
    await input.send(`move ${markerRect.x + markerRect.width / 2} ${markerRect.y + markerRect.height - 5}`);
    await input.send(`move ${endX} ${endY}`);
    await input.send('up');
    await waitFor(() => overlay.webContents.executeJavaScript("document.getElementById('editor').classList.contains('open')"), 'native editor open');
    const crop = await overlay.webContents.executeJavaScript(`({ width:document.getElementById('preview').width, height:document.getElementById('preview').height })`);
    assert.ok(Math.abs(crop.width - 80) <= 1 && Math.abs(crop.height - 30) <= 1, JSON.stringify(crop));
    const basePixels = await overlay.webContents.executeJavaScript(`(() => {
      const c=document.getElementById('preview'), d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      const p=(x,y)=>[...d.subarray((y*c.width+x)*4,(y*c.width+x)*4+4)];
      return { left:p(20,15), right:p(60,15) };
    })()`);
    assert.deepStrictEqual(basePixels.left, [255, 0, 255, 255], 'native crop keeps the magenta marker');
    assert.deepStrictEqual(basePixels.right, [0, 255, 0, 255], 'native crop keeps the lime marker');

    const layout = await overlay.webContents.executeJavaScript(`(() => {
      const r=(sel)=>{const b=document.querySelector(sel).getBoundingClientRect();return {left:b.left,top:b.top,width:b.width,height:b.height};};
      return { canvas:r('#preview'), pen:r('#pen-tool'), text:r('#text-tool'), undo:r('#undo-tool'), cancel:r('#cancel-tool'), done:r('#done-tool'), input:r('#annotation-text'), toolbar:r('#toolbar') };
    })()`);
    const windowPoint = (rect) => ({ x: native.x + (rect.left + rect.width / 2) * scale, y: native.y + (rect.top + rect.height / 2) * scale });
    const canvasPoint = (x, y) => ({ x: native.x + (layout.canvas.left + x * layout.canvas.width / crop.width) * scale, y: native.y + (layout.canvas.top + y * layout.canvas.height / crop.height) * scale });
    const redCount = () => overlay.webContents.executeJavaScript(`(() => {
      const c=document.getElementById('preview'), d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0;
      for(let i=0;i<d.length;i+=4) if(d[i]>180 && d[i+1]<100 && d[i+2]<100) n++;
      return n;
    })()`);
    assert.ok(layout.toolbar.width > 0 && layout.toolbar.height > 0, 'floating toolbar is laid out');

    const penStart = canvasPoint(5, 5), penEnd = canvasPoint(30, 10);
    await input.send(`move ${Math.round(penStart.x)} ${Math.round(penStart.y)}`);
    await input.send('down');
    await input.send(`move ${Math.round((penStart.x + penEnd.x) / 2)} ${Math.round((penStart.y + penEnd.y) / 2)}`);
    await input.send(`move ${Math.round(penEnd.x)} ${Math.round(penEnd.y)}`);
    await input.send('up');
    const afterPen = await redCount();
    assert.ok(afterPen > 0, 'native pen stroke paints red pixels');
    const undoPoint = windowPoint(layout.undo);
    await input.send(`click ${Math.round(undoPoint.x)} ${Math.round(undoPoint.y)}`);
    const afterUndo = await redCount();
    assert.equal(afterUndo, 0, 'native undo removes the latest pen annotation');

    const textPoint = windowPoint(layout.text);
    const inputPoint = windowPoint(layout.input);
    const textCanvas = canvasPoint(20, 5);
    await input.send(`click ${Math.round(textPoint.x)} ${Math.round(textPoint.y)}`);
    await input.send(`click ${Math.round(inputPoint.x)} ${Math.round(inputPoint.y)}`);
    await input.send('type A');
    assert.equal(await overlay.webContents.executeJavaScript("document.getElementById('annotation-text').value"), 'A', 'native typing reaches the annotation input');
    await input.send(`click ${Math.round(textCanvas.x)} ${Math.round(textCanvas.y)}`);
    const afterText = await redCount();
    assert.ok(afterText > 0, 'native text annotation paints red pixels');

    const donePoint = windowPoint(layout.done);
    await input.send(`click ${Math.round(donePoint.x)} ${Math.round(donePoint.y)}`);
    const captured = await waitFor(() => pet.webContents.executeJavaScript('window.__nativeShot || null'), 'native capture result');
    assert.equal(captured.ok, true, JSON.stringify(captured));
    assert.deepStrictEqual({ width: captured.width, height: captured.height }, { width: crop.width, height: crop.height });
    const image = clipboard.readImage();
    assert.equal(image.isEmpty(), false);
    assert.deepStrictEqual(image.getSize(), { width: crop.width, height: crop.height });
    const bitmap = image.getBitmap();
    let finalRed = 0;
    for (let i = 0; i < bitmap.length; i += 4) if (bitmap[i + 2] > 180 && bitmap[i + 1] < 100 && bitmap[i] < 100) finalRed++;
    assert.ok(finalRed > 0, 'final clipboard PNG contains the native text annotation');
    const completedBitmap = Buffer.from(bitmap);

    await pet.webContents.executeJavaScript('window.__cancelShot = null; void window.v2p.screenshot().then(result => window.__cancelShot = result)');
    const cancelOverlay = await waitFor(() => overlayFor(), 'native cancel selector');
    await input.send('move 400 400');
    await input.send('down');
    await input.send('move 500 460');
    await input.send('up');
    await waitFor(() => cancelOverlay.webContents.executeJavaScript("document.getElementById('editor').classList.contains('open')"), 'native cancel editor open');
    const cancelLayout = await cancelOverlay.webContents.executeJavaScript(`(() => { const b=document.getElementById('cancel-tool').getBoundingClientRect(); return {left:b.left,top:b.top,width:b.width,height:b.height}; })()`);
    const cancelPoint = { x: native.x + (cancelLayout.left + cancelLayout.width / 2) * scale, y: native.y + (cancelLayout.top + cancelLayout.height / 2) * scale };
    await input.send(`click ${Math.round(cancelPoint.x)} ${Math.round(cancelPoint.y)}`);
    const cancelled = await waitFor(() => pet.webContents.executeJavaScript('window.__cancelShot || null'), 'native cancel result');
    assert.deepStrictEqual(cancelled, { ok: false, reason: 'cancelled' });
    assert.deepStrictEqual(Buffer.from(clipboard.readImage().getBitmap()), completedBitmap, 'native cancel leaves the clipboard image unchanged');

    pet.setBounds({ x: 100, y: 100, width: 300, height: 306 });
    pet.show();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await waitFor(() => pet.webContents.executeJavaScript("document.getElementById('audio-recovery').style.display === 'flex'"), 'recovery panel visible');
    const recoveryLayout = await pet.webContents.executeJavaScript(`(() => {
      const r=(sel)=>{const b=document.querySelector(sel).getBoundingClientRect();return {left:b.left,top:b.top,width:b.width,height:b.height,right:b.right,bottom:b.bottom};};
      const retry=r('#retry-recording'), copy=r('#copy-recording-text'), panel=r('#audio-recovery');
      const hit=document.elementFromPoint(retry.left+retry.width/2, retry.top+retry.height/2);
      return { panel, retry, copy, inner:[innerWidth,innerHeight], hit:hit && hit.id };
    })()`);
    assert.ok(recoveryLayout.panel.left >= 0 && recoveryLayout.panel.top >= 0 && recoveryLayout.panel.right <= recoveryLayout.inner[0] && recoveryLayout.panel.bottom <= recoveryLayout.inner[1], 'recovery panel fits inside the pet window');
    assert.ok(recoveryLayout.retry.right <= recoveryLayout.inner[0] && recoveryLayout.retry.bottom <= recoveryLayout.inner[1], 'retry button fits inside the pet window');
    assert.ok(recoveryLayout.copy.right <= recoveryLayout.inner[0] && recoveryLayout.copy.bottom <= recoveryLayout.inner[1], 'copy button fits inside the pet window');
    assert.equal(recoveryLayout.hit, 'retry-recording', 'retry button is the topmost hit target');
    const petShot = process.env.V2P_PET_SHOT;
    fs.writeFileSync(petShot, (await pet.webContents.capturePage()).toPNG());
    console.log(PREFIX + JSON.stringify({
      ok: true, display: { bounds: display.bounds, scaleFactor: scale, native }, markerRect,
      captured, crop, basePixels, afterPen, afterUndo, afterText, finalRed, layout,
      recovery: { inner: recoveryLayout.inner, panel: recoveryLayout.panel, retry: recoveryLayout.retry, copy: recoveryLayout.copy, hit: recoveryLayout.hit },
      petShot
    }));
  } catch (error) {
    console.error(PREFIX + JSON.stringify({ ok: false, error: error.stack }));
    process.exitCode = 1;
  } finally {
    if (marker && marker.exitCode === null) marker.kill();
    if (input) input.close();
    if (previous) clipboard.write(previous);
    app.quit();
  }
}

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-native-'));
  const evidence = process.env.V2P_EVIDENCE_DIR
    ? path.join(process.env.V2P_EVIDENCE_DIR, 'feedback-recovery-panel.png')
    : path.join(directory, 'feedback-recovery-panel.png');
  const recoveryId = '11111111-1111-1111-1111-111111111111';
  fs.mkdirSync(path.join(directory, 'audio-recovery'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'audio-recovery', `${recoveryId}.wav`), encodePcmWav(Buffer.alloc(16000 * 2), 16000));
  fs.writeFileSync(path.join(directory, 'audio-recovery', 'latest.json'), JSON.stringify({ id: recoveryId, raw: 'synthetic recovery transcript', savedAt: Date.now() }));
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
    asrProviders: [], llmProviders: [], activeAsrId: '', activeLlmId: '',
    hotkey: 'Control+Shift+F12', screenshotHotkey: 'Control+Alt+F12', petModel: 'keyboard', petScale: 1,
    mouseRecord: false, triggerMode: 'hold', insertMode: 'clipboard', previewEnabled: false
  }));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, ARG], {
        windowsHide: true,
        env: { ...process.env, V2P_NATIVE_PROFILE: directory, V2P_PET_SHOT: evidence },
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
          assert.ok(line, output.slice(-4000));
          const result = JSON.parse(line.slice(PREFIX.length));
          assert.equal(result.ok, true, JSON.stringify(result).slice(0, 12000));
          assert.equal(code, 0);
          console.log('PASS native OS input screenshot annotation on one display, cancel, and recovery-panel layout');
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