'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ARG = '--vision-e2e-fixture';
const PREFIX = 'VISION_E2E:';

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function waitFor(predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Timeout: ' + label);
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'); }

function startMockVision() {
  const state = { requests: [] };
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const content = parsed.messages?.[0]?.content || [];
        const image = content.find((part) => part.type === 'image_url');
        const text = content.find((part) => part.type === 'text');
        const data = image?.image_url?.url || '';
        const png = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
        assert.ok(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'mock received a PNG');
        const record = {
          model: parsed.model, prompt: text?.text || '', imageSha256: sha256(png),
          width: png.readUInt32BE(16), height: png.readUInt32BE(20)
        };
        state.requests.push(record);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'V2P-7KQ2' } }] }));
      } catch (error) {
        response.writeHead(400); response.end(String(error.message || error));
      }
    });
  });
  return { server, state };
}

async function fixture() {
  const { app, BrowserWindow, clipboard, nativeImage } = require('electron');
  const scenario = process.env.V2P_VISION_SCENARIO;
  app.setPath('userData', process.env.V2P_VISION_PROFILE);
  let previous = null;
  try {
    require('./main');
    await app.whenReady();
    const pet = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/pet.html')), 'production pet');
    await waitFor(() => !pet.webContents.isLoading(), 'pet preload');
    pet.hide();
    previous = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF() };
    const previousImage = clipboard.readImage();
    if (!previousImage.isEmpty()) previous.image = previousImage;
    const image = nativeImage.createFromPath(process.env.V2P_VALIDATION_IMAGE);
    assert.equal(image.isEmpty(), false, 'validation image loads');
    clipboard.writeImage(image);
    const state = await pet.webContents.executeJavaScript('window.v2p.getImageState()');
    if (scenario === 'gate') {
      assert.equal(state.hasImage, true);
      assert.equal(state.multimodal, false);
      assert.equal(state.eligible, false);
      assert.match(state.reason, /多模态/);
      const result = await pet.webContents.executeJavaScript('window.v2p.recognizeImage()');
      assert.equal(result.ok, false);
      assert.match(result.error, /多模态/);
      console.log(PREFIX + JSON.stringify({ ok: true, scenario, state, result }));
      return;
    }
    assert.equal(state.hasImage, true);
    assert.equal(state.multimodal, true);
    assert.equal(state.eligible, true);
    assert.equal(state.reason, '');
    const started = Date.now();
    const result = await pet.webContents.executeJavaScript('window.v2p.recognizeImage()');
    const ms = Date.now() - started;
    const clipboardText = clipboard.readText();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(typeof result.text, 'string');
    assert.ok(result.text.includes('V2P-7KQ2'), result.text);
    assert.equal(clipboardText, result.text, 'recognition writes the full text to the clipboard');
    console.log(PREFIX + JSON.stringify({
      ok: true, scenario, state, ms, text: result.text, textSha256: sha256(result.text),
      clipboardMatches: true
    }));
  } catch (error) {
    console.error(PREFIX + JSON.stringify({ ok: false, scenario, error: error.stack }));
    process.exitCode = 1;
  } finally {
    if (previous) clipboard.write(previous);
    app.quit();
  }
}

async function runScenario(scenario, profile, validationPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(require('electron'), [__filename, ARG], {
      windowsHide: true,
      env: { ...process.env, V2P_VISION_SCENARIO: scenario, V2P_VISION_PROFILE: profile, V2P_VALIDATION_IMAGE: validationPath },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const timeout = setTimeout(() => child.kill(), 180000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      try {
        const line = output.split(/\r?\n/).find((entry) => entry.startsWith(PREFIX));
        assert.ok(line, output.slice(-4000));
        const result = JSON.parse(line.slice(PREFIX.length));
        assert.equal(result.ok, true, JSON.stringify(result).slice(0, 8000));
        assert.equal(code, 0);
        resolve(result);
      } catch (error) { reject(error); }
    });
  });
}

async function run() {
  const validationPath = path.join(__dirname, 'vision-validation.png');
  const validation = fs.readFileSync(validationPath);
  const validationSha = sha256(validation);
  const gateProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-vision-gate-'));
  const mockProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-vision-mock-'));
  const mock = startMockVision();
  await new Promise((resolve) => mock.server.listen(0, '127.0.0.1', resolve));
  const mockPort = mock.server.address().port;
  let realBackup = '';
  let realEnabled = false;
  let activeProvider = null;
  let host = '';
  try {
    writeJson(path.join(gateProfile, 'config.json'), {
      asrProviders: [], llmProviders: [{ id: 'vision-gate', name: 'gate', baseUrl: 'https://invalid.example/v1', apiKey: '', model: 'vision-gate', multimodal: false }],
      activeAsrId: '', activeLlmId: 'vision-gate', hotkey: 'Control+Shift+F12', screenshotHotkey: 'Control+Alt+F12',
      petModel: 'keyboard', petScale: 1, mouseRecord: false, triggerMode: 'hold', insertMode: 'clipboard', previewEnabled: false
    });
    const gate = await runScenario('gate', gateProfile, validationPath);
    assert.match(gate.state.reason, /多模态/);
    assert.match(gate.result.error, /多模态/);

    writeJson(path.join(mockProfile, 'config.json'), {
      asrProviders: [], llmProviders: [{ id: 'vision-fixture', name: 'fixture', baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiKey: '', model: 'vision-fixture', multimodal: true }],
      activeAsrId: '', activeLlmId: 'vision-fixture', hotkey: 'Control+Shift+F12', screenshotHotkey: 'Control+Alt+F12',
      petModel: 'keyboard', petScale: 1, mouseRecord: false, triggerMode: 'hold', insertMode: 'clipboard', previewEnabled: false
    });
    const mocked = await runScenario('mock', mockProfile, validationPath);
    assert.equal(mock.state.requests.length, 1, 'mock receives exactly one vision request');
    assert.equal(mock.state.requests[0].model, 'vision-fixture');
    assert.ok(mock.state.requests[0].prompt.includes('Transcribe the visible content'));
    assert.deepStrictEqual([mock.state.requests[0].width, mock.state.requests[0].height], [260, 72]);
    assert.equal(mocked.clipboardMatches, true);

    if (process.env.V2P_ALLOW_REAL_CONFIG !== '1') {
      console.log('PASS image recognition gate and local request shape (real config step skipped; set V2P_ALLOW_REAL_CONFIG=1 to enable one real vision call)');
      return;
    }

    const realProfile = path.join(process.env.APPDATA, 'Voice2Prompt');
    const realConfigPath = path.join(realProfile, 'config.json');
    const realConfig = readJson(realConfigPath);
    activeProvider = realConfig.llmProviders.find((provider) => provider.id === realConfig.activeLlmId);
    assert.ok(activeProvider, 'real config has an active LLM provider');
    assert.ok(activeProvider.baseUrl && activeProvider.model && activeProvider.apiKey, 'real provider has endpoint, model and key');
    host = new URL(activeProvider.baseUrl).host;
    realBackup = `${realConfigPath}.bak-vision-${Date.now()}`;
    fs.copyFileSync(realConfigPath, realBackup);
    const enabledConfig = JSON.parse(JSON.stringify(realConfig));
    const enabledProvider = enabledConfig.llmProviders.find((provider) => provider.id === enabledConfig.activeLlmId);
    enabledProvider.multimodal = true;
    writeJson(realConfigPath, enabledConfig);
    realEnabled = true;
    let real;
    try {
      real = await runScenario('real', realProfile, validationPath);
    } catch (error) {
      fs.copyFileSync(realBackup, realConfigPath);
      realEnabled = false;
      throw error;
    }
    const evidence = [
      'Feedback v2 U3 recognition evidence',
      'Date: ' + new Date().toISOString(),
      '',
      'Fixture: app/main/vision-validation.png',
      'fixtureSha256: ' + validationSha,
      'promptSha256: ' + sha256(fs.readFileSync(path.join(__dirname, 'vision-prompts.js'))),
      'adapterSha256: ' + sha256(fs.readFileSync(path.join(__dirname, 'models.js'))),
      '',
      'Gate (real config copy, multimodal=false, no provider request):',
      'reason: ' + gate.state.reason,
      'recognizeError: ' + gate.result.error,
      '',
      'Mock provider (local HTTP, no external request):',
      'requests: 1, model: ' + mock.state.requests[0].model + ', image: 260x72',
      'clipboard: ' + mocked.clipboardMatches,
      '',
      'Real provider:',
      'model: ' + activeProvider.model,
      'host: ' + host,
      'visionRequests: 1 (new budget max 2, v1 eight calls unchanged)',
      'userProfileModified: multimodal enabled for ' + activeProvider.id + ' only',
      'backup: ' + path.basename(realBackup),
      'ms: ' + real.ms,
      'textSha256: ' + real.textSha256,
      'text: ' + JSON.stringify(real.text),
      'clipboardMatches: ' + real.clipboardMatches
    ].join('\n');
    fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'evidence', 'feedback-recognition.txt'), evidence + '\n', 'utf8');
    console.log('PASS image recognition gate, local request shape, and real synthetic-image clipboard flow');
    console.log('EVIDENCE ' + JSON.stringify({ gate, mock: mock.state.requests, real: { ms: real.ms, textLength: real.text.length, textSha256: real.textSha256, clipboardMatches: real.clipboardMatches }, validationSha }));
  } finally {
    await new Promise((resolve) => mock.server.close(resolve));
    fs.rmSync(gateProfile, { recursive: true, force: true });
    fs.rmSync(mockProfile, { recursive: true, force: true });
    if (!realEnabled && realBackup && fs.existsSync(realBackup)) {
      // Failure path already restored the original; keep the backup for audit.
    }
  }
}

if (process.argv.includes(ARG)) fixture();
else run().catch((error) => { console.error(error); process.exitCode = 1; });