const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const geometry = require('./screenshot-geometry');
const { getPhysicalMonitorBounds, mapDisplaysToPhysical } = require('./screenshot-native-capture');
const ARG = '--screenshot-p3-fixture';
const PREFIX = 'SCREENSHOT_P3:';

async function waitFor(predicate, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw Error('Timeout: ' + label);
}

async function fixture() {
  const { app, BrowserWindow, clipboard, screen, desktopCapturer } = require('electron');
  app.setPath('userData', process.env.V2P_SCREENSHOT_PROFILE);
  let markerProcess = null;
  let previousClipboard = null;
  try {
    require('./main');
    await app.whenReady();
    previousClipboard = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF() };
    const previousImage = clipboard.readImage();
    if (!previousImage.isEmpty()) previousClipboard.image = previousImage;
    const pet = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/pet.html')), 'production pet');
    await waitFor(() => !pet.webContents.isLoading(), 'pet preload');
    const displays = screen.getAllDisplays().map((display) => ({
      id: display.id, label: display.label || '', bounds: display.bounds, nativeOrigin: display.nativeOrigin || null,
      size: { width: display.bounds.width, height: display.bounds.height }, scaleFactor: display.scaleFactor,
      nativeBounds: screen.dipToScreenRect(null, display.bounds)
    }));
    const desktopSources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 3200, height: 1800 } });
    const physicalMonitors = await getPhysicalMonitorBounds();
    const identityMap = mapDisplaysToPhysical(displays, physicalMonitors, (display) => display.nativeBounds);

    const compositor = new BrowserWindow({ width: 500, height: 300, show: false, webPreferences: {
      preload: path.join(__dirname, 'screenshot-preload.js'), contextIsolation: true, nodeIntegration: false
    } });
    await compositor.loadFile(path.join(__dirname, '..', 'renderer', 'screenshot.html'));
    const plan = geometry.planComposition({ x: -2, y: 0, width: 4, height: 2 }, [
      { id: 'left', bounds: { x: -4, y: 0, width: 4, height: 2 }, pixelWidth: 4, pixelHeight: 2 },
      { id: 'right', bounds: { x: 0, y: 0, width: 4, height: 2 }, pixelWidth: 8, pixelHeight: 4 }
    ]);
    const pixelResult = await compositor.webContents.executeJavaScript(`(async () => {
      function solid(w,h,color) { const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,w,h);return c.toDataURL('image/png'); }
      const screens=[{id:'left',dataUrl:solid(4,2,'#ff0000')},{id:'right',dataUrl:solid(8,4,'#00ff00')}];
      const url=await window.screenshotCompose.composeScreens(screens,${JSON.stringify(plan)});
      const img=new Image();img.src=url;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
      const a=x.getImageData(1,1,1,1).data;const b=x.getImageData(6,1,1,1).data;
      return {width:img.width,height:img.height,left:[...a],right:[...b]};
    })()`);
    assert.deepStrictEqual(pixelResult, { width: 8, height: 4, left: [255, 0, 0, 255], right: [0, 255, 0, 255] }, 'production canvas compositor preserves colored source pixels across mixed scales');
    const gapPlan = geometry.planComposition({ x: -2, y: 0, width: 4, height: 3 }, [
      { id: 'left', bounds: { x: -4, y: 0, width: 4, height: 3 }, pixelWidth: 4, pixelHeight: 3 },
      { id: 'right', bounds: { x: 0, y: 1, width: 4, height: 2 }, pixelWidth: 8, pixelHeight: 4 }
    ]);
    const gapPixels = await compositor.webContents.executeJavaScript(`(async () => {
      function solid(w,h,color){const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,w,h);return c.toDataURL('image/png');}
      const url=await window.screenshotCompose.composeScreens([{id:'left',dataUrl:solid(4,3,'red')},{id:'right',dataUrl:solid(8,4,'#00ff00')}],${JSON.stringify(gapPlan)});
      const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);
      return {left:[...context.getImageData(1,1,1,1).data],gap:[...context.getImageData(6,0,1,1).data],right:[...context.getImageData(6,3,1,1).data]};
    })()`);
    assert.deepStrictEqual(gapPixels, { left:[255,0,0,255], gap:[0,0,0,255], right:[0,255,0,255] }, 'staggered screen gaps keep an explicit black background and correct screen pixels');
    compositor.destroy();

    assert.ok(displays.length >= 1, 'Electron must report at least one display');
    clipboard.writeText('screenshot cancel sentinel');
    await pet.webContents.executeJavaScript('void window.v2p.screenshot().then(result => window.__cancelShot = result)');
    const cancelState = await waitFor(async () => {
      const win = BrowserWindow.getAllWindows().find((entry) => entry.webContents.getURL().endsWith('/screenshot.html') && entry.isVisible());
      if (win) return { win };
      const result = await pet.webContents.executeJavaScript('window.__cancelShot || null');
      return result ? { result } : null;
    }, 'cancel selector or result');
    if (!cancelState.win) throw Error(JSON.stringify({ startResult: cancelState.result, displays, physicalMonitors, identityMap }));
    const cancelOverlay = cancelState.win;
    await cancelOverlay.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
    const cancelled = await waitFor(() => pet.webContents.executeJavaScript('window.__cancelShot || null'), 'cancel result');
    assert.deepStrictEqual(cancelled, { ok: false, reason: 'cancelled' });
    assert.equal(clipboard.readText(), 'screenshot cancel sentinel', 'cancel leaves clipboard untouched');
    await waitFor(() => !BrowserWindow.getAllWindows().some((win) => win.webContents.getURL().endsWith('/screenshot.html')), 'cancel selector cleanup');

    markerProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; $form=New-Object System.Windows.Forms.Form; $form.FormBorderStyle='None'; $form.StartPosition='Manual'; $form.Location=New-Object System.Drawing.Point(60,60); $form.ClientSize=New-Object System.Drawing.Size(40,30); $form.BackColor=[System.Drawing.Color]::Magenta; $form.TopMost=$true; $form.Show(); [Console]::Out.WriteLine('MARKER_READY'); Start-Sleep -Seconds 60"],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('marker window did not start')), 8000);
      markerProcess.stdout.on('data', (data) => { if (String(data).includes('MARKER_READY')) { clearTimeout(timeout); resolve(); } });
      markerProcess.on('error', (error) => { clearTimeout(timeout); reject(error); });
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await pet.webContents.executeJavaScript('void window.v2p.screenshot().then(result => window.__captureShot = result)');
    const captureOverlay = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/screenshot.html') && win.isVisible() && win.getBounds().x === 0 && win.getBounds().y === 0), 'capture selector');
    await captureOverlay.webContents.executeJavaScript(`(() => {
      const options={bubbles:true,button:0,clientX:60,clientY:60};
      document.dispatchEvent(new MouseEvent('mousedown',options));
      document.dispatchEvent(new MouseEvent('mousemove',{...options,clientX:100,clientY:90}));
      document.dispatchEvent(new MouseEvent('mouseup',{...options,clientX:100,clientY:90}));
    })()`);
    const captured = await waitFor(() => pet.webContents.executeJavaScript('window.__captureShot || null'), 'capture result');
    assert.equal(captured.ok, true, JSON.stringify(captured));
    assert.equal(captured.width, 40); assert.equal(captured.height, 30);
    const image = clipboard.readImage();
    assert.equal(image.isEmpty(), false, 'clipboard receives a real image');
    assert.deepStrictEqual(image.getSize(), { width: 40, height: 30 });
    const pixels = image.getBitmap();
    const centerPixel = [...pixels.subarray((15 * 40 + 20) * 4, (15 * 40 + 20) * 4 + 4)];
    assert.deepStrictEqual(centerPixel, [255, 0, 255, 255], 'real screenshot crop contains the external magenta target pixels');
    await waitFor(() => !BrowserWindow.getAllWindows().some((win) => win.webContents.getURL().endsWith('/screenshot.html')), 'capture selector cleanup');
    assert.equal(pet.isVisible(), true, 'previously visible pet window is restored');
    console.log(PREFIX + JSON.stringify({ ok: true, displays,
      desktopSources: desktopSources.map((source) => ({ id: source.id, name: source.name, display_id: source.display_id, thumbnailSize: source.thumbnail.getSize() })),
      physicalMonitors, identityMap: identityMap.map(({ id, name, x, y, width, height }) => ({ id, name, x, y, width, height })),
      capture: captured, cancelClipboardPreserved: true, centerPixel, compositionPixels: pixelResult, gapPixels }));
  } catch (error) {
    console.error(PREFIX + JSON.stringify({ ok: false, error: error.stack }));
    process.exitCode = 1;
  } finally {
    if (markerProcess && markerProcess.exitCode === null) markerProcess.kill();
    if (previousClipboard) clipboard.write(previousClipboard);
    app.quit();
  }
}

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-screenshot-p3-'));
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
    asrProviders: [{ id: 'asr-fixture', name: 'fixture', model: 'fixture', baseUrl: 'https://invalid.example', apiKey: '' }],
    llmProviders: [{ id: 'llm-fixture', name: 'fixture', model: 'fixture', baseUrl: 'https://invalid.example', apiKey: '', multimodal: false }],
    activeAsrId: 'asr-fixture', activeLlmId: 'llm-fixture', hotkey: 'Control+Shift+F12', screenshotHotkey: 'Control+Alt+F12', petModel: 'keyboard', mouseRecord: false
  }));
  await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [__filename, ARG], { windowsHide: true,
      env: { ...process.env, V2P_SCREENSHOT_PROFILE: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const timeout = setTimeout(() => child.kill(), 90000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      try {
        const line = output.split(/\r?\n/).find((entry) => entry.startsWith(PREFIX));
        assert.ok(line, output.slice(-4000));
        const result = JSON.parse(line.slice(PREFIX.length));
        assert.equal(result.ok, true, result.error);
        assert.equal(code, 0);
        console.log('PASS production Electron screenshot cancel/capture and mixed-scale color pixels');
        console.log('EVIDENCE ' + JSON.stringify(result));
        resolve();
      } catch (error) { reject(error); }
    });
  }).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
}

if (process.argv.includes(ARG)) fixture();
else run().catch((error) => { console.error(error); process.exitCode = 1; });
