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
    const leftMonitor = identityMap.find((monitor) => monitor.primary);
    const rightMonitor = leftMonitor && identityMap.find((monitor) => monitor.x === leftMonitor.x + leftMonitor.width &&
      Math.min(monitor.y + monitor.height, leftMonitor.y + leftMonitor.height) - Math.max(monitor.y, leftMonitor.y) > 80);
    const crossRect = rightMonitor ? { x: rightMonitor.x - 40, y: Math.max(leftMonitor.y, rightMonitor.y) + 40, width: 80, height: 30 } : null;

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
    const timings = {};
    clipboard.writeText('screenshot cancel sentinel');
    const firstTriggerStarted = Date.now();
    await pet.webContents.executeJavaScript('void window.v2p.screenshot().then(result => window.__cancelShot = result)');
    const cancelState = await waitFor(async () => {
      const win = BrowserWindow.getAllWindows().find((entry) => entry.webContents.getURL().endsWith('/screenshot.html') && entry.isVisible());
      if (win) return { win };
      const result = await pet.webContents.executeJavaScript('window.__cancelShot || null');
      return result ? { result } : null;
    }, 'cancel selector or result');
    if (!cancelState.win) throw Error(JSON.stringify({ startResult: cancelState.result, displays, physicalMonitors, identityMap }));
    timings.firstTriggerToReadyMs = Date.now() - firstTriggerStarted;
    const cancelOverlay = cancelState.win;
    await cancelOverlay.webContents.executeJavaScript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");
    const cancelled = await waitFor(() => pet.webContents.executeJavaScript('window.__cancelShot || null'), 'cancel result');
    assert.deepStrictEqual(cancelled, { ok: false, reason: 'cancelled' });
    assert.equal(clipboard.readText(), 'screenshot cancel sentinel', 'cancel leaves clipboard untouched');
    await waitFor(() => !BrowserWindow.getAllWindows().some((win) => win.webContents.getURL().endsWith('/screenshot.html')), 'cancel selector cleanup');

    const crossMarkers = crossRect ? `$left=Marker ${crossRect.x} ${crossRect.y} Magenta; $right=Marker ${rightMonitor.x} ${crossRect.y} Lime;` : '';
    markerProcess = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command',
      'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public class MarkerDpi{[DllImport("user32.dll")]public static extern bool SetProcessDpiAwarenessContext(IntPtr value);}\'; [void][MarkerDpi]::SetProcessDpiAwarenessContext([IntPtr](-4)); Add-Type -AssemblyName System.Windows.Forms; function Marker($x,$y,$color){$f=New-Object System.Windows.Forms.Form;$f.FormBorderStyle="None";$f.StartPosition="Manual";$f.Location=New-Object System.Drawing.Point($x,$y);$f.ClientSize=New-Object System.Drawing.Size(40,30);$f.BackColor=[System.Drawing.Color]::FromName($color);$f.TopMost=$true;$f.Show();$f.Refresh();return $f}; $form=Marker 60 60 Magenta; '+crossMarkers+' [System.Windows.Forms.Application]::DoEvents(); [Console]::Out.WriteLine("MARKER_READY"); Start-Sleep -Seconds 60'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('marker window did not start')), 8000);
      markerProcess.stdout.on('data', (data) => { if (String(data).includes('MARKER_READY')) { clearTimeout(timeout); resolve(); } });
      markerProcess.on('error', (error) => { clearTimeout(timeout); reject(error); });
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const warmTriggerStarted = Date.now();
    await pet.webContents.executeJavaScript('void window.v2p.screenshot().then(result => window.__captureShot = result)');
    const captureOverlay = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/screenshot.html') && win.isVisible() && win.getBounds().x === 0 && win.getBounds().y === 0), 'capture selector');
    timings.warmTriggerToReadyMs = Date.now() - warmTriggerStarted;
    await captureOverlay.webContents.executeJavaScript(`(() => {
      const options={bubbles:true,button:0,clientX:60,clientY:60};
      document.dispatchEvent(new MouseEvent('mousedown',options));
      document.dispatchEvent(new MouseEvent('mousemove',{...options,clientX:100,clientY:90}));
      document.dispatchEvent(new MouseEvent('mouseup',{...options,clientX:100,clientY:90}));
    })()`);
    const editorOverlay = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/screenshot.html') && win.isVisible() && win.webContents.id === captureOverlay.webContents.id), 'crop editor');
    await waitFor(() => editorOverlay.webContents.executeJavaScript("document.getElementById('editor').classList.contains('open')"), 'crop preview rendered');
    await editorOverlay.webContents.executeJavaScript(`(() => {
      const canvas=document.getElementById('preview');
      const box=canvas.getBoundingClientRect();
      const point=(x,y)=>({bubbles:true,button:0,pointerId:1,clientX:box.left+x*box.width/canvas.width,clientY:box.top+y*box.height/canvas.height});
      canvas.dispatchEvent(new PointerEvent('pointerdown',point(5,5)));
      canvas.dispatchEvent(new PointerEvent('pointermove',point(14,14)));
      canvas.dispatchEvent(new PointerEvent('pointerup',point(14,14)));
      document.getElementById('text-tool').click();
      document.getElementById('annotation-text').value='A';
      canvas.dispatchEvent(new PointerEvent('pointerdown',point(20,5)));
      const ctx=canvas.getContext('2d');
      const before=ctx.getImageData(0,0,canvas.width,canvas.height).data.slice();
      document.getElementById('undo-tool').click();
      const after=ctx.getImageData(0,0,canvas.width,canvas.height).data.slice();
      let changed=0; for(let i=0;i<before.length;i++) if(before[i]!==after[i]) changed++;
      const pen=[...ctx.getImageData(10,10,1,1).data];
      window.__annotationPixels={changed,pen,dimensions:[canvas.width,canvas.height]};
    })()`);
    const annotationPixels = await editorOverlay.webContents.executeJavaScript('window.__annotationPixels');
    assert.deepStrictEqual(annotationPixels.dimensions, [40, 30], 'annotation backing canvas retains the source crop resolution');
    assert.ok(annotationPixels.changed > 0, 'undo removes the latest text annotation pixels');
    assert.notDeepStrictEqual(annotationPixels.pen, [255,0,255,255], 'pen stroke paints over the source crop');
    assert.equal(clipboard.readText(), 'screenshot cancel sentinel', 'editing does not write the clipboard before Done');
    await editorOverlay.webContents.executeJavaScript("document.getElementById('done-tool').click()");
    const captured = await waitFor(() => pet.webContents.executeJavaScript('window.__captureShot || null'), 'capture result');
    assert.equal(captured.ok, true, JSON.stringify(captured));
    assert.equal(captured.width, 40); assert.equal(captured.height, 30);
    const image = clipboard.readImage();
    assert.equal(image.isEmpty(), false, 'clipboard receives a real image');
    assert.deepStrictEqual(image.getSize(), { width: 40, height: 30 });
    const pixels = image.getBitmap();
    const centerPixel = [...pixels.subarray((15 * 40 + 20) * 4, (15 * 40 + 20) * 4 + 4)];
    assert.deepStrictEqual(centerPixel, [255, 0, 255, 255], 'unannotated crop pixels remain unchanged');
    const penPixel = [...pixels.subarray((10 * 40 + 10) * 4, (10 * 40 + 10) * 4 + 4)];
    assert.deepStrictEqual(penPixel, [53, 57, 229, 255], 'red pen stroke is present in the final copied PNG bitmap');
    const completedBitmap = Buffer.from(pixels);
    await pet.webContents.executeJavaScript('void window.v2p.screenshot().then(result => window.__editorCancelShot = result)');
    const editorCancelWindow = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/screenshot.html') && win.isVisible()), 'second selector');
    await editorCancelWindow.webContents.executeJavaScript(`(() => {
      const options={bubbles:true,button:0,clientX:60,clientY:60};
      document.dispatchEvent(new MouseEvent('mousedown',options));
      document.dispatchEvent(new MouseEvent('mousemove',{...options,clientX:100,clientY:90}));
      document.dispatchEvent(new MouseEvent('mouseup',{...options,clientX:100,clientY:90}));
    })()`);
    await waitFor(() => editorCancelWindow.webContents.executeJavaScript("document.getElementById('editor').classList.contains('open')"), 'second crop editor');
    await editorCancelWindow.webContents.executeJavaScript("document.getElementById('cancel-tool').click()");
    const editorCancelled = await waitFor(() => pet.webContents.executeJavaScript('window.__editorCancelShot || null'), 'editor cancel result');
    assert.deepStrictEqual(editorCancelled, { ok: false, reason: 'cancelled' });
    assert.deepStrictEqual(Buffer.from(clipboard.readImage().getBitmap()), completedBitmap, 'canceling the editor leaves the clipboard image byte-for-byte unchanged');
    await waitFor(() => !BrowserWindow.getAllWindows().some((win) => win.webContents.getURL().endsWith('/screenshot.html')), 'capture selector cleanup');
    assert.equal(pet.isVisible(), true, 'previously visible pet window is restored');
    let crossMonitorPixels = null;
    if (crossRect) {
      const crossTriggerStarted = Date.now();
      await pet.webContents.executeJavaScript('void window.v2p.screenshot().then(result => window.__crossShot = result)');
      const overlayFor = (monitor) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/screenshot.html') && win.isVisible() && Math.abs(win.getBounds().x - displays.find(d => String(d.id) === monitor.id).bounds.x) < 2);
      const leftOverlay = await waitFor(() => overlayFor(leftMonitor), 'left cross selector');
      const rightOverlay = await waitFor(() => overlayFor(rightMonitor), 'right cross selector');
      timings.crossTriggerToReadyMs = Date.now() - crossTriggerStarted;
      const dispatch = (win, monitor, type, x, y) => win.webContents.executeJavaScript(`document.dispatchEvent(new MouseEvent(${JSON.stringify(type)},{bubbles:true,button:0,clientX:(${x}-${monitor.x})/${monitor.width}*innerWidth,clientY:(${y}-${monitor.y})/${monitor.height}*innerHeight}))`);
      await dispatch(leftOverlay, leftMonitor, 'mousedown', crossRect.x, crossRect.y);
      await dispatch(rightOverlay, rightMonitor, 'mousemove', crossRect.x+crossRect.width, crossRect.y+crossRect.height);
      await dispatch(rightOverlay, rightMonitor, 'mouseup', crossRect.x+crossRect.width, crossRect.y+crossRect.height);
      const rightEditor = await waitFor(() => overlayFor(rightMonitor), 'cross-screen crop editor');
      assert.equal(rightEditor.webContents.id, rightOverlay.webContents.id, 'cross-screen editor opens on the release screen');
      await waitFor(() => rightEditor.webContents.executeJavaScript("document.getElementById('editor').classList.contains('open')"), 'cross-screen crop preview rendered');
      await rightEditor.webContents.executeJavaScript("document.getElementById('done-tool').click()");
      const crossResult = await waitFor(() => pet.webContents.executeJavaScript('window.__crossShot || null'), 'cross-screen image');
      assert.equal(crossResult.ok, true, JSON.stringify(crossResult));
      assert.deepStrictEqual({width:crossResult.width,height:crossResult.height},{width:80,height:30});
      const bitmap=clipboard.readImage().getBitmap();
      const pixel=(x,y)=>[...bitmap.subarray((y*80+x)*4,(y*80+x)*4+4)];
      crossMonitorPixels={rect:crossRect,left:pixel(20,15),right:pixel(60,15),input:'production renderer events across two real OS captures'};
      assert.deepStrictEqual(crossMonitorPixels.left,[255,0,255,255]);
      assert.deepStrictEqual(crossMonitorPixels.right,[0,255,0,255]);
    }
    console.log(PREFIX + JSON.stringify({ ok: true, displays,
      desktopSources: desktopSources.map((source) => ({ id: source.id, name: source.name, display_id: source.display_id, thumbnailSize: source.thumbnail.getSize() })),
      physicalMonitors, identityMap: identityMap.map(({ id, name, x, y, width, height }) => ({ id, name, x, y, width, height })),
      capture: captured, timings, cancelClipboardPreserved: true, editorCancelledWithoutClipboardWrite: true, annotationPixels, centerPixel, penPixel, compositionPixels: pixelResult, gapPixels, crossMonitorPixels }));
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
