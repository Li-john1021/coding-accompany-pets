'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { encodePcmWav, parsePcmWav } = require('./audio-chunks');

const ARG = '--asr-e2e-fixture';
const PREFIX = 'ASR_E2E:';

function waitFor(predicate, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return (async () => {
    while (Date.now() < deadline) {
      const result = await predicate();
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error('Timeout: ' + label);
  })();
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; if (body.length > 40 * 1024 * 1024) reject(new Error('request body too large')); });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function createAsrServer(initialMode) {
  const state = { mode: initialMode, runs: [], current: null, runCalls: 0 };
  const server = http.createServer(async (request, response) => {
    if (request.url === '/control') {
      const body = JSON.parse(await readBody(request) || '{}');
      state.mode = body.mode || state.mode;
      if (body.reset) { state.current = null; state.runCalls = 0; }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (request.url === '/stats') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(state));
      return;
    }
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
      response.writeHead(404); response.end('not found'); return;
    }
    try {
      const body = JSON.parse(await readBody(request));
      const data = body.messages[0].content[0].input_audio.data;
      const wav = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
      const parsed = parsePcmWav(wav);
      if (parsed.samples > parsed.sampleRate * 30) throw new Error('chunk exceeds 30 seconds');
      if (!state.current) { state.current = []; state.runs.push(state.current); }
      const chunkIndex = state.runCalls++;
      state.current.push({ index: chunkIndex, samples: parsed.samples, seconds: parsed.samples / parsed.sampleRate, pcm: wav.subarray(parsed.dataStart).toString('base64') });
      if (state.mode === 'fail-middle' && chunkIndex === 1) {
        response.writeHead(503); response.end('down'); return;
      }
      if (state.mode === 'length-middle' && chunkIndex === 1) {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }));
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: `segment-${chunkIndex + 1}` } }] }));
    } catch (error) {
      response.writeHead(400); response.end(String(error.message || error));
    }
  });
  return { server, state };
}

function writeFakeAudio(file, seconds = 40) {
  const rate = 48000;
  const samples = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i++) samples.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 0.4 * 32767), i * 2);
  fs.writeFileSync(file, encodePcmWav(samples, rate));
}

function writeLongWav(file) {
  const rate = 16000;
  const seconds = 180;
  const samples = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i++) {
    const second = i / rate;
    const frequency = second < 60 ? 440 : second < 120 ? 880 : 220;
    samples.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * i / rate) * 0.3 * 32767), i * 2);
  }
  fs.writeFileSync(file, encodePcmWav(samples, rate));
}

async function setMode(port, mode) {
  await new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/control', method: 'POST', headers: { 'content-type': 'application/json' } }, (response) => {
      response.resume(); response.on('end', resolve);
    });
    request.on('error', reject);
    request.end(JSON.stringify({ mode, reset: true }));
  });
}

async function fixture() {
  const { app, BrowserWindow, clipboard } = require('electron');
  const scenario = process.env.V2P_E2E_SCENARIO;
  app.setPath('userData', process.env.V2P_AUDIO_PROFILE);
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.V2P_FAKE_AUDIO);
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
    clipboard.writeText('asr-e2e-sentinel');

    if (scenario === 'success-long') {
      const wav = fs.readFileSync(process.env.V2P_E2E_WAV);
      const base64 = wav.toString('base64');
      const result = await pet.webContents.executeJavaScript(`(async () => {
        const binary = atob(${JSON.stringify(base64)});
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return await window.v2p.submit(bytes, 'audio/wav', { mode: 'none' });
      })()`);
      const saved = await pet.webContents.executeJavaScript('window.v2p.audioRecoveryGet()');
      const clipboardText = clipboard.readText();
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(clipboardText, 'segment-1\nsegment-2\nsegment-3\nsegment-4\nsegment-5\nsegment-6');
      assert.equal(saved.id, null, 'successful long delivery clears recovery');
      console.log(PREFIX + JSON.stringify({ ok: true, scenario, result: { raw: result.raw, copiedOnly: result.copiedOnly }, clipboardText, recoveryId: saved.id }));
      return;
    }

    await pet.webContents.executeJavaScript(`document.getElementById('stage').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,screenX:120,screenY:120}))`);
    await waitFor(() => pet.webContents.executeJavaScript("document.getElementById('status').textContent.includes('正在聆听')"), 'recording started');
    await new Promise((resolve) => setTimeout(resolve, 35000));
    await pet.webContents.executeJavaScript(`window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,screenX:120,screenY:120}))`);
    await waitFor(() => pet.webContents.executeJavaScript("document.getElementById('audio-recovery').style.display === 'flex'"), 'recovery panel');
    const failureClipboard = clipboard.readText();
    assert.equal(failureClipboard, 'asr-e2e-sentinel', 'ASR failure does not write the clipboard');
    const failureBubble = await pet.webContents.executeJavaScript("document.getElementById('bubble').textContent");
    assert.ok(/503|不完整内容/.test(failureBubble), `expected ASR failure message, got ${failureBubble}`);

    await setMode(Number(process.env.V2P_ASR_PORT), 'success');
    await pet.webContents.executeJavaScript("document.getElementById('retry-recording').click()");
    await waitFor(() => pet.webContents.executeJavaScript("document.getElementById('bubble').textContent.includes('恢复完成')"), 'recovery completion', 60000);
    const recoveredClipboard = clipboard.readText();
    const panelHidden = await pet.webContents.executeJavaScript("document.getElementById('audio-recovery').style.display === 'none'");
    const saved = await pet.webContents.executeJavaScript('window.v2p.audioRecoveryGet()');
    assert.equal(recoveredClipboard, 'segment-1\nsegment-2', 'retry copies the recovered transcript');
    assert.equal(panelHidden, true, 'recovery panel closes after success');
    assert.equal(saved.id, null, 'retry success clears recovery');
    console.log(PREFIX + JSON.stringify({ ok: true, scenario, failureBubble, recoveredClipboard, panelHidden, recoveryId: saved.id }));
  } catch (error) {
    console.error(PREFIX + JSON.stringify({ ok: false, error: error.stack }));
    process.exitCode = 1;
  } finally {
    if (previous) clipboard.write(previous);
    app.quit();
  }
}

async function runScenario(scenario, mode) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `v2p-asr-e2e-${scenario}-`));
  const fakeAudio = path.join(directory, 'fake-audio.wav');
  writeFakeAudio(fakeAudio);
  const longWav = path.join(directory, 'long.wav');
  writeLongWav(longWav);
  const { server, state } = createAsrServer(mode);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
      asrProviders: [{ id: 'asr-fixture', name: 'fixture', model: 'fixture', baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: '', asrProtocol: 'chat' }],
      llmProviders: [{ id: 'llm-fixture', name: 'fixture', model: 'fixture', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', multimodal: false }],
      activeAsrId: 'asr-fixture', activeLlmId: 'llm-fixture', hotkey: 'Control+Shift+F12', screenshotHotkey: 'Control+Alt+F12',
      petModel: 'keyboard', mouseRecord: false, triggerMode: 'hold', insertMode: 'clipboard', previewEnabled: false,
      enableStructure: false, enableOptimize: false
    }));
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, ARG], {
        windowsHide: true,
        env: { ...process.env, V2P_E2E_SCENARIO: scenario, V2P_ASR_PORT: String(port), V2P_AUDIO_PROFILE: directory, V2P_FAKE_AUDIO: fakeAudio, V2P_E2E_WAV: longWav },
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
          const parsed = JSON.parse(line.slice(PREFIX.length));
          assert.equal(parsed.ok, true, parsed.error);
          assert.equal(code, 0);
          resolve(parsed);
        } catch (error) { reject(error); }
      });
    });
    const expectedLongHash = scenario === 'success-long'
      ? (() => { const wav = fs.readFileSync(longWav); const parsed = parsePcmWav(wav); return crypto.createHash('sha256').update(wav.subarray(parsed.dataStart)).digest('hex'); })()
      : null;
    return { result, stats: state, expectedLongHash };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function run() {
  const long = await runScenario('success-long', 'success');
  assert.equal(long.stats.runs.length, 1, 'one long-audio run');
  assert.equal(long.stats.runs[0].length, 6, 'three-minute audio is sent as six bounded chunks');
  const longSamples = long.stats.runs[0].reduce((total, chunk) => total + chunk.samples, 0);
  assert.equal(longSamples, 16000 * 180, 'long-audio chunks cover every source sample');
  assert.ok(long.stats.runs[0].every((chunk) => chunk.seconds <= 30), 'long-audio chunks stay within 30 seconds');
  const longBytes = Buffer.concat(long.stats.runs[0].map((chunk) => Buffer.from(chunk.pcm, 'base64')));
  assert.equal(crypto.createHash('sha256').update(longBytes).digest('hex'), long.expectedLongHash, 'long-audio chunks preserve every source PCM byte');

  for (const [scenario, mode] of [['record-http-fail-retry', 'fail-middle'], ['record-length-retry', 'length-middle']]) {
    const { result, stats } = await runScenario(scenario, mode);
    assert.equal(stats.runs.length, 2, `${scenario}: first attempt plus retry`);
    assert.equal(stats.runs[0].length, 2, `${scenario}: failure run sent two chunks`);
    assert.equal(stats.runs[1].length, 2, `${scenario}: retry sent two chunks`);
    assert.ok(stats.runs.every((run) => run.reduce((total, chunk) => total + chunk.samples, 0) > 16000 * 30.5), `${scenario}: recorded audio duration ${stats.runs.map((run) => run.reduce((total, chunk) => total + chunk.samples, 0) / 16000).join('/')}s`);
    assert.deepEqual(stats.runs[1].map((chunk) => chunk.pcm), stats.runs[0].map((chunk) => chunk.pcm), `${scenario}: retry sends the exact recovered audio`);
    assert.equal(result.recoveredClipboard, 'segment-1\nsegment-2');
    assert.equal(result.recoveryId, null);
  }
  console.log('PASS production ASR e2e: six bounded chunks, mid-stream HTTP/length rejection, recovery retry without auto-paste');
}

if (process.argv.includes(ARG)) fixture();
else run().catch((error) => { console.error(error); process.exitCode = 1; });