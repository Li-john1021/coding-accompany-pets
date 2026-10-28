'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ARG = '--pet-restore-ui-fixture';
const PREFIX = 'PET_RESTORE_UI:';

async function waitFor(predicate, label, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Timeout: ' + label);
}

async function fixture() {
  const { app, BrowserWindow, clipboard, screen } = require('electron');
  app.setPath('userData', process.env.V2P_UI_PROFILE);
  const { startInputHelper } = require('./test-input-helper');
  let input = null;
  let previous = null;
  try {
    require('./main');
    await app.whenReady();
    const pet = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/pet.html')), 'production pet');
    await waitFor(() => !pet.webContents.isLoading(), 'pet preload');
    await new Promise((resolve) => setTimeout(resolve, 700));
    pet.setBounds({ x: 40, y: 40, width: 300, height: 306 });
    pet.moveTop();
    await new Promise((resolve) => setTimeout(resolve, 500));

    await pet.webContents.executeJavaScript(`(() => {
      window.__probe = { down: 0, up: 0, move: 0 };
      document.getElementById('stage').addEventListener('mousedown', () => { window.__probe.down++; }, true);
      window.addEventListener('mouseup', () => { window.__probe.up++; }, true);
      window.addEventListener('mousemove', () => { window.__probe.move++; }, true);
    })()`);
    const stage = await pet.webContents.executeJavaScript(`(() => {
      const r = document.getElementById('stage').getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);
    const content = pet.getContentBounds();
    const sf = screen.getPrimaryDisplay().scaleFactor || 1;
    const dip = { x: content.x + stage.x + stage.width / 2, y: content.y + stage.y + stage.height / 2 };
    let physical = dip;
    try { physical = screen.dipToScreenPoint(dip); } catch { /* DIP-only displays */ }
    const cx = Math.round(physical.x);
    const cy = Math.round(physical.y);

    input = startInputHelper();
    await input.ready;
    previous = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF() };
    const previousImage = clipboard.readImage();
    if (!previousImage.isEmpty()) previous.image = previousImage;
    clipboard.writeText('restore-ui-sentinel');

    const resetPosition = async () => {
      pet.setBounds({ x: 40, y: 40, width: 300, height: 306 });
      pet.moveTop();
      await new Promise((resolve) => setTimeout(resolve, 350));
    };
    const dragBy = async (dx, dy) => {
      await pet.webContents.executeJavaScript('window.__probe = { down: 0, up: 0, move: 0 }');
      await input.send(`move ${cx} ${cy}`);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await input.send('down');
      await new Promise((resolve) => setTimeout(resolve, 80));
      await input.send(`move ${cx + Math.round(dx / 2)} ${cy + Math.round(dy / 2)}`);
      await new Promise((resolve) => setTimeout(resolve, 80));
      await input.send(`move ${cx + dx} ${cy + dy}`);
      await new Promise((resolve) => setTimeout(resolve, 80));
      await input.send('up');
      await new Promise((resolve) => setTimeout(resolve, 350));
      return pet.webContents.executeJavaScript('window.__probe');
    };

    await resetPosition();
    const dragDip = { x: Math.round(60 * sf), y: Math.round(40 * sf) };
    const before = pet.getPosition();
    const baselineStats = await dragBy(dragDip.x, dragDip.y);
    const after = pet.getPosition();
    assert.ok(baselineStats.down >= 1, 'baseline drag reaches the pet: ' + JSON.stringify(baselineStats));
    assert.deepStrictEqual({ x: after[0] - before[0], y: after[1] - before[1] }, { x: 60, y: 40 }, 'baseline drag moves the pet');

    await resetPosition();
    await pet.webContents.executeJavaScript(`document.querySelector('[data-mode="screenshot"]').click()`);
    const libraryWindow = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.getTitle() === 'screenshots' && win.isVisible()), 'library screenshot window');
    const view = libraryWindow.getBrowserViews()[0];
    assert.ok(view, 'library uses a BrowserView');
    const wc = view.webContents;
    await waitFor(() => wc.executeJavaScript("!!document.querySelector('.screenshots')"), 'library UI root');
    libraryWindow.setAlwaysOnTop(true, 'screen-saver');
    libraryWindow.focus();
    try { wc.focus(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
    await wc.sendInputEvent({ type: 'mouseDown', x: 150, y: 150, button: 'left', clickCount: 1 });
    await wc.sendInputEvent({ type: 'mouseMove', x: 350, y: 300, button: 'left' });
    await wc.sendInputEvent({ type: 'mouseMove', x: 550, y: 450, button: 'left' });
    await wc.sendInputEvent({ type: 'mouseUp', x: 550, y: 450, button: 'left', clickCount: 1 });
    try {
      await waitFor(() => wc.executeJavaScript("!!document.querySelector('.screenshots-operations')"), 'library floating toolbar', 4000);
    } catch {
      await wc.executeJavaScript(`(() => {
        const root = document.querySelector('.screenshots');
        const fire = (type, x, y) => root.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
        fire('mousedown', 150, 150);
        fire('mousemove', 350, 300);
        fire('mousemove', 550, 450);
        fire('mouseup', 550, 450);
      })()`);
      await waitFor(() => wc.executeJavaScript("!!document.querySelector('.screenshots-operations')"), 'library floating toolbar after DOM drag', 5000);
    }
    const clickedOk = await wc.executeJavaScript(`(() => {
      const icon = document.querySelector('.icon-ok');
      const button = icon && icon.closest('.screenshots-button');
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(clickedOk, true, 'library ok button is present');
    await waitFor(() => clipboard.readImage().isEmpty() === false, 'screenshot copied to clipboard');
    const shotSize = clipboard.readImage().getSize();
    await waitFor(() => pet.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-mode="image_recognition"]');
      return !!button && !button.classList.contains('is-disabled');
    })()`), 'recognition button becomes available', 8000);

    await new Promise((resolve) => setTimeout(resolve, 600));
    await resetPosition();
    const beforeShot = pet.getPosition();
    const shotStats = await dragBy(dragDip.x, dragDip.y);
    const afterShot = pet.getPosition();
    assert.ok(shotStats.down >= 1, 'pet receives mousedown again after the screenshot: ' + JSON.stringify(shotStats));
    assert.deepStrictEqual({ x: afterShot[0] - beforeShot[0], y: afterShot[1] - beforeShot[1] }, { x: 60, y: 40 }, 'pet stays draggable after the screenshot');

    await resetPosition();
    await pet.webContents.executeJavaScript(`document.querySelector('[data-mode="image_recognition"]').click()`);
    await new Promise((resolve) => setTimeout(resolve, 180));
    const bubbleDuring = await pet.webContents.executeJavaScript(`document.getElementById('bubble').textContent`);
    assert.match(bubbleDuring, /正在读取图片中/, 'recognition shows a reading bubble: ' + bubbleDuring);
    const recognized = await waitFor(() => clipboard.readText() === '识图结果 OK' ? clipboard.readText() : null, 'recognition clipboard text', 15000);
    assert.equal(recognized, '识图结果 OK');
    const bubbleAfter = await waitFor(() => pet.webContents.executeJavaScript(`(() => {
      const text = document.getElementById('bubble').textContent;
      return /识图完成/.test(text) ? text : '';
    })()`), 'recognition completion bubble', 5000);

    console.log(PREFIX + JSON.stringify({
      ok: true,
      scaleFactor: sf,
      baseline: { stats: baselineStats, moved: { x: after[0] - before[0], y: after[1] - before[1] } },
      afterScreenshot: { stats: shotStats, moved: { x: afterShot[0] - beforeShot[0], y: afterShot[1] - beforeShot[1] } },
      bubbleDuring,
      bubbleAfter,
      clipboardText: recognized,
      imageSize: shotSize,
      libraryBounds: libraryWindow.getBounds()
    }));
  } catch (error) {
    console.error(PREFIX + JSON.stringify({ ok: false, error: error.stack }));
    process.exitCode = 1;
  } finally {
    input?.close();
    if (previous) clipboard.write(previous);
    app.quit();
  }
}

function startMockVision() {
  const state = { requests: [] };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { state.requests.push(JSON.parse(body)); } catch { state.requests.push(null); }
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '识图结果 OK' } }] }));
      }, 700);
    });
  });
  return { state, server };
}

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-restore-ui-'));
  const mock = startMockVision();
  await new Promise((resolve) => mock.server.listen(0, '127.0.0.1', resolve));
  const port = mock.server.address().port;
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
    asrProviders: [],
    llmProviders: [{ id: 'fixture-llm', name: 'fixture', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', model: 'fixture-llm' }],
    activeAsrId: '', activeLlmId: 'fixture-llm',
    visionProviders: [{
      id: 'fixture-vision', name: 'fixture-vision', baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: '', model: 'fixture-llm'
    }],
    activeVisionId: 'fixture-vision',
    hotkey: 'Control+Shift+F11', screenshotHotkey: 'Control+Alt+F11', petModel: 'keyboard', petScale: 1,
    mouseRecord: false, triggerMode: 'hold', insertMode: 'clipboard', previewEnabled: false
  }));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, ARG], {
        windowsHide: true,
        env: { ...process.env, V2P_UI_PROFILE: directory },
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
          assert.equal(result.ok, true, JSON.stringify(result).slice(0, 8000));
          assert.equal(code, 0);
          assert.equal(mock.state.requests.length, 1, 'one vision request');
          assert.equal(mock.state.requests[0].model, 'fixture-llm');
          const content = mock.state.requests[0].messages[0].content;
          assert.ok(Array.isArray(content) && content[1].type === 'image_url', 'request carries an image_url part');
          assert.match(content[1].image_url.url, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
          console.log('PASS pet restore after screenshot plus recognition bubble and clipboard result');
          console.log('EVIDENCE ' + JSON.stringify({ ...result, visionRequest: { model: mock.state.requests[0].model, imageChars: content[1].image_url.url.length } }));
          resolve();
        } catch (error) { reject(error); }
      });
    });
  } finally {
    mock.server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv.includes(ARG)) fixture();
else run().catch((error) => { console.error(error); process.exitCode = 1; });