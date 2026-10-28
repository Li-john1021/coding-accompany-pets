const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ARG = '--screenshot-vision-p5-fixture';
const PREFIX = 'SCREENSHOT_VISION_P5:';
const OUTPUT_TEXT = '    if (ready) {\n      runTask();\n    }';
const KEY_A = 'synthetic-p5-key-a';
const KEY_B = 'synthetic-p5-key-b';
const MODEL_A = 'synthetic-vision-a';
const MODEL_B = 'synthetic-vision-b';

async function waitFor(predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timeout: ${label}`);
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of crcInput) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, crcBuffer]);
}

function solidPng(r, g, b) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6;
  const scanline = Buffer.from([0, r, g, b, 255, r, g, b, 255, 0, r, g, b, 255, r, g, b, 255]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', require('zlib').deflateSync(scanline)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function clipboardSnapshot(clipboard) {
  const formats = clipboard.availableFormats();
  const buffers = new Map();
  for (const format of formats) {
    try { buffers.set(format, clipboard.readBuffer(format)); } catch { /* unsupported platform format */ }
  }
  return {
    formats,
    buffers,
    text: clipboard.readText(),
    html: clipboard.readHTML(),
    rtf: clipboard.readRTF(),
    image: clipboard.readImage(),
    bookmark: clipboard.readBookmark()
  };
}

function restoreClipboard(clipboard, saved) {
  const value = { text: saved.text, html: saved.html, rtf: saved.rtf };
  if (saved.image && !saved.image.isEmpty()) value.image = saved.image;
  clipboard.write(value);
}

function response(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
}

async function fixture() {
  const { app, BrowserWindow, clipboard, nativeImage } = require('electron');
  const directory = process.env.V2P_P5_USER_DATA;
  app.setPath('userData', directory);
  app.on('browser-window-created', (_event, win) => {
    const show = win.show.bind(win), showInactive = win.showInactive.bind(win), focus = win.focus.bind(win);
    win.setFocusable(false);
    win.hide();
    const isInteractiveSurface = () => win.webContents.getURL().endsWith('/screenshot.html') || win.getTitle() === 'screenshots';
    win.show = () => { if (isInteractiveSurface()) { win.setFocusable(true); show(); } };
    win.showInactive = () => { if (isInteractiveSurface()) showInactive(); };
    win.focus = () => { if (isInteractiveSurface()) focus(); };
  });

  const savedClipboard = clipboardSnapshot(clipboard);
  const state = { requests: [], replyQueue: [], deferNext: false, deferred: null };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { response(res, 400, 'bad-json'); return; }
      state.requests.push({ authorization: req.headers.authorization || '', body });
      if (state.deferNext) {
        state.deferNext = false;
        state.deferred = { res };
        return;
      }
      const reply = state.replyQueue.shift() || { status: 200, text: OUTPUT_TEXT };
      response(res, reply.status, reply.text);
    });
  });

  let pet;
  let settings;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
      asrProviders: [],
      llmProviders: [
        { id: 'provider-a', name: 'Local A', model: MODEL_A, baseUrl, apiKey: KEY_A },
        { id: 'provider-b', name: 'Local B', model: MODEL_B, baseUrl, apiKey: KEY_B }
      ],
      activeLlmId: 'provider-a',
      visionProviders: [
        { id: 'vision-a', name: 'Vision A', model: MODEL_A, baseUrl, apiKey: KEY_A },
        { id: 'vision-b', name: 'Vision B', model: MODEL_B, baseUrl, apiKey: KEY_B }
      ],
      activeVisionId: 'vision-a',
      activeAsrId: '',
      hotkey: 'Control+Shift+F12', screenshotHotkey: 'Control+Alt+F12',
      petModel: '', insertMode: 'paste', undoToastSeconds: 10,
      previewEnabled: false, enableStructure: false, enableOptimize: false
    }));

    require('./main');
    await app.whenReady();
    pet = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/pet.html')), 'production pet');
    await waitFor(() => !pet.webContents.isLoading(), 'pet renderer/preload');
    const button = () => pet.webContents.executeJavaScript("document.querySelector('[data-mode=\\\"image_recognition\\\"]')");
    const buttonState = () => pet.webContents.executeJavaScript("(() => {const b=document.querySelector('[data-mode=\\\"image_recognition\\\"]');return b&&{disabled:b.disabled||b.classList.contains('is-disabled'),busy:b.getAttribute('aria-busy'),label:b.textContent.trim()}})()");
    const setClipboardImage = (buffer) => clipboard.writeImage(nativeImage.createFromBuffer(buffer));
    const isImageClipboard = () => !clipboard.readImage().isEmpty();
    const imagePixels = () => {
      const image = clipboard.readImage();
      return image.isEmpty() ? null : { size: image.getSize(), bitmap: image.getBitmap().toString('hex') };
    };
    const imageDataFromRequest = (request) => {
      const content = request.body?.messages?.[0]?.content;
      const part = Array.isArray(content) && content.find((item) => item?.type === 'image_url');
      const url = part?.image_url?.url;
      return typeof url === 'string' && url.startsWith('data:image/png;base64,') ? Buffer.from(url.slice(url.indexOf(',') + 1), 'base64') : null;
    };
    const clickRecognize = async () => {
      await pet.webContents.executeJavaScript("document.querySelector('[data-mode=\\\"image_recognition\\\"]').click()");
    };
    async function openSettings() {
      await pet.webContents.executeJavaScript('window.v2p.openSettings()');
      settings = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/settings.html')), 'production settings');
      await waitFor(() => !settings.webContents.isLoading(), 'settings renderer');
      await waitFor(() => settings.webContents.executeJavaScript("!!document.querySelector('#vision-list .provider-row[data-id=vision-a] .f-model')"), 'settings vision provider rows');
    }
    const saveSettings = async () => {
      await settings.webContents.executeJavaScript("document.querySelector('#save').click()");
      await waitFor(() => settings.webContents.executeJavaScript("document.querySelector('#save-tip').textContent.includes('已保存')"), 'production settings save');
    };
    const setActiveVisionProvider = async (id) => {
      await settings.webContents.executeJavaScript(`document.querySelector('#vision-list .provider-row[data-id=${JSON.stringify(id)}] input[type=radio]').click()`);
      await saveSettings();
    };
    const setActiveTextProvider = async (id) => {
      await settings.webContents.executeJavaScript(`document.querySelector('#llm-list .provider-row[data-id=${JSON.stringify(id)}] input[type=radio]').click()`);
      await saveSettings();
    };
    const waitButton = async (disabled) => waitFor(async () => { const value = await buttonState(); return value?.disabled === disabled ? value : false; }, 'recognition button disabled=' + disabled);

    const imageA = solidPng(230, 35, 45);
    const imageB = solidPng(25, 80, 235);
    const nativeA = nativeImage.createFromBuffer(imageA);
    const nativeB = nativeImage.createFromBuffer(imageB);
    assert.equal(nativeA.isEmpty(), false, 'synthetic image A decodes in Electron');
    assert.equal(nativeB.isEmpty(), false, 'synthetic image B decodes in Electron');

    setClipboardImage(imageA);
    await waitButton(false);
    await openSettings();
    await setActiveTextProvider('provider-b');
    await waitButton(false);
    assert.equal((await buttonState()).disabled, false, 'text model choice never gates recognition');
    await setActiveVisionProvider('vision-b');
    await waitButton(false);
    await setActiveVisionProvider('vision-a');
    await waitButton(false);

    clipboard.writeText('external text clipboard sentinel');
    await waitButton(true);
    assert.equal(isImageClipboard(), false, 'copying external text replaces the actual clipboard image');
    setClipboardImage(imageA);
    await waitButton(false);

    const validationBefore = state.requests.length;
    state.replyQueue.push({ status: 200, text: 'V2P-7KQ2' });
    await settings.webContents.executeJavaScript("document.querySelector('#vision-list .provider-row[data-id=vision-a] .validate').click()");
    await waitFor(() => settings.webContents.executeJavaScript("document.querySelector('#vision-list .provider-row[data-id=vision-a] .validate-msg').textContent.includes('可正常调用')"), 'image validation completed');
    assert.equal(state.requests.length, validationBefore + 1, 'settings validation makes one local image request');
    const validationRequest = state.requests[validationBefore];
    assert.equal(validationRequest.authorization, `Bearer ${KEY_A}`);
    assert.equal(validationRequest.body.model, MODEL_A);
    const validationPng = imageDataFromRequest(validationRequest);
    assert.ok(validationPng && validationPng.length > 40, 'settings validation includes actual PNG bytes');
    assert.equal(validationPng.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');

    const successBefore = state.requests.length;
    const clipboardImageA = clipboard.readImage().toPNG();
    await clickRecognize();
    await waitFor(() => state.requests.length === successBefore + 1, 'recognition request reached local endpoint');
    const successRequest = state.requests[successBefore];
    assert.equal(successRequest.authorization, `Bearer ${KEY_A}`);
    assert.equal(successRequest.body.model, MODEL_A);
    assert.deepStrictEqual(imageDataFromRequest(successRequest), clipboardImageA, 'recognition request uses the actual clipboard PNG');
    await waitFor(() => clipboard.readText() === OUTPUT_TEXT, 'recognition text clipboard');
    assert.equal(clipboard.readText(), OUTPUT_TEXT);
    assert.equal((await waitButton(true)).disabled, true, 'writing recognized text disables image recognition');
    assert.equal(BrowserWindow.getAllWindows().some((win) => win.webContents.getURL().endsWith('/undo.html')), false,
      'insertMode=paste still publishes only to clipboard and opens no undo delivery');

    setClipboardImage(imageA);
    await waitButton(false);
    state.replyQueue.push({ status: 415, text: 'image unsupported' });
    const errorBefore = state.requests.length;
    await clickRecognize();
    await waitFor(() => state.requests.length === errorBefore + 1, 'error request reached local endpoint');
    await waitFor(async () => (await buttonState())?.disabled === false, 'failed recognition returns to idle');
    assert.equal(isImageClipboard(), true, 'HTTP failure leaves the source image on the clipboard');
    assert.equal(clipboard.readText(), '', 'HTTP failure does not publish response text');

    const deferredBefore = state.requests.length;
    state.deferNext = true;
    setClipboardImage(imageA);
    await clickRecognize();
    await waitFor(() => state.deferred, 'deferred recognition request reached local endpoint');
    const deferredRequest = state.requests[deferredBefore];
    assert.equal(deferredRequest.authorization, `Bearer ${KEY_A}`);
    assert.equal(deferredRequest.body.model, MODEL_A);
    clipboard.writeText('changed while request was active');
    await setActiveVisionProvider('vision-b');
    assert.equal(deferredRequest.body.model, MODEL_A, 'in-flight request keeps the starting model snapshot');
    assert.equal(deferredRequest.authorization, `Bearer ${KEY_A}`, 'in-flight request keeps the starting credential snapshot');
    response(state.deferred.res, 200, OUTPUT_TEXT);
    state.deferred = null;
    await waitFor(() => clipboard.readText() === OUTPUT_TEXT, 'deferred recognition publishes exact result');
    assert.equal(clipboard.readText(), OUTPUT_TEXT);
    assert.equal((await buttonState()).disabled, true, 'changed clipboard content remains text after request completion');

    clipboard.writeText('screenshot cancellation sentinel');
    await waitFor(() => pet.webContents.executeJavaScript("!document.querySelector('[data-mode=screenshot]').disabled"), 'screenshot button ready');
    await pet.webContents.executeJavaScript("document.querySelector('[data-mode=screenshot]').click()");
    const overlay = await waitFor(() => BrowserWindow.getAllWindows().find((win) =>
      win.getTitle() === 'screenshots' && win.isVisible()), 'production screenshot selector');
    const overlayView = overlay.getBrowserViews()[0];
    assert.ok(overlayView, 'library uses a BrowserView');
    await waitFor(() => overlayView.webContents.executeJavaScript("!!document.querySelector('.screenshots')"), 'screenshot library root');
    await overlayView.webContents.executeJavaScript("document.querySelector('.screenshots').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:700,clientY:400}))");
    await waitFor(async () => !(await pet.webContents.executeJavaScript('window.v2p.getImageState()')).busy, 'screenshot cancellation settled');
    assert.equal(clipboard.readText(), 'screenshot cancellation sentinel', 'cancelled screenshot preserves clipboard contents');
    await waitFor(() => !BrowserWindow.getAllWindows().some((win) => win.getTitle() === 'screenshots' && win.isVisible()), 'screenshot selector cleanup');

    console.log(PREFIX + JSON.stringify({ ok: true, requestCount: state.requests.length,
      validationPngBytes: validationPng.length, recognizedPngBytes: clipboardImageA.length,
      failurePreservedImage: true, deferredSnapshotModel: deferredRequest.body.model,
      screenshotCancelPreservedClipboard: true }));
  } catch (error) {
    console.error(PREFIX + JSON.stringify({ ok: false, error: error.stack }));
    process.exitCode = 1;
  } finally {
    try { restoreClipboard(clipboard, savedClipboard); } catch { /* restore the user's prior clipboard as far as the platform permits */ }
    try { if (server.listening) await new Promise((resolve) => server.close(resolve)); } catch {}
    app.quit();
  }
}

async function run() {
  assert.equal(process.platform, 'win32');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-screenshot-vision-p5-'));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, ARG], {
        windowsHide: true,
        env: { ...process.env, V2P_P5_USER_DATA: directory },
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
          assert.equal(result.ok, true, result.error);
          assert.equal(code, 0);
          console.log('PASS production Electron image gating, settings image validation, transcription and clipboard-only delivery');
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
