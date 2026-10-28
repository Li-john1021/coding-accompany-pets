'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { encodePcmWav, parsePcmWav } = require('./audio-chunks');

const ARG = '--audio-capture-runtime-fixture';
const PREFIX = 'AUDIO_CAPTURE_RUNTIME:';
const RECORD_SECONDS = 182;

async function waitFor(predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error('Timeout: ' + label);
}

function writeFakeAudio(file) {
  const rate = 48000;
  const seconds = 180;
  const samples = Buffer.alloc(rate * seconds * 2);
  const tone = (second) => (second >= 5 && second < 10 ? 440 : second >= 90 && second < 95 ? 880 : second >= 170 && second < 175 ? 220 : 0);
  for (let i = 0; i < rate * seconds; i++) {
    const frequency = tone(i / rate);
    const value = frequency ? Math.round(Math.sin(2 * Math.PI * frequency * i / rate) * 0.5 * 32767) : 0;
    samples.writeInt16LE(value, i * 2);
  }
  fs.writeFileSync(file, encodePcmWav(samples, rate));
}

function analyzeWav(wav) {
  const parsed = parsePcmWav(wav);
  const samples = new Float32Array(parsed.samples);
  for (let i = 0; i < parsed.samples; i++) samples[i] = wav.readInt16LE(parsed.dataStart + i * 2) / 32768;
  const windowSamples = Math.floor(parsed.sampleRate / 2);
  const windows = [];
  for (let start = 0; start + windowSamples <= samples.length; start += windowSamples) {
    let energy = 0;
    for (let i = start; i < start + windowSamples; i++) energy += samples[i] * samples[i];
    windows.push({ start, end: start + windowSamples, rms: Math.sqrt(energy / windowSamples) });
  }
  const regions = [];
  for (const window of windows) {
    if (window.rms < 0.1) continue;
    const last = regions[regions.length - 1];
    if (last && window.start - last.end <= windowSamples * 2) last.end = window.end;
    else regions.push({ start: window.start, end: window.end });
  }
  for (const region of regions) {
    let crossings = 0, previous = 0, energy = 0;
    for (let i = region.start; i < region.end; i++) {
      if (i > region.start && (samples[i] >= 0) !== (previous >= 0)) crossings++;
      previous = samples[i];
      energy += samples[i] * samples[i];
    }
    const seconds = (region.end - region.start) / parsed.sampleRate;
    region.startSeconds = region.start / parsed.sampleRate;
    region.endSeconds = region.end / parsed.sampleRate;
    region.rms = Math.sqrt(energy / (region.end - region.start));
    region.zcr = crossings / seconds;
  }
  const silenceStart = Math.floor(parsed.sampleRate * 40);
  const silenceEnd = Math.min(samples.length, Math.floor(parsed.sampleRate * 45));
  let silenceEnergy = 0;
  for (let i = silenceStart; i < silenceEnd; i++) silenceEnergy += samples[i] * samples[i];
  return {
    seconds: parsed.samples / parsed.sampleRate,
    sampleRate: parsed.sampleRate,
    regions,
    silenceRms: Math.sqrt(silenceEnergy / Math.max(1, silenceEnd - silenceStart))
  };
}

async function fixture() {
  const { app, BrowserWindow } = require('electron');
  app.setPath('userData', process.env.V2P_AUDIO_PROFILE);
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-audio-capture', process.env.V2P_AUDIO_FILE);
  try {
    require('./main');
    await app.whenReady();
    const pet = await waitFor(() => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/pet.html')), 'production pet');
    await waitFor(() => !pet.webContents.isLoading(), 'pet preload');
    pet.hide();
    let analysis = null;
    if (process.env.V2P_SKIP_LONG !== '1') {
    await pet.webContents.executeJavaScript(`document.getElementById('stage').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,screenX:120,screenY:120}))`);
    await waitFor(() => pet.webContents.executeJavaScript("document.getElementById('status').textContent.includes('正在聆听')"), 'recording started');
    const startedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, RECORD_SECONDS * 1000));
    await pet.webContents.executeJavaScript(`window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,screenX:120,screenY:120}))`);
    const recoveryDir = path.join(process.env.V2P_AUDIO_PROFILE, 'audio-recovery');
    const metaPath = path.join(recoveryDir, 'latest.json');
    await waitFor(() => fs.existsSync(metaPath), 'recovery metadata');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const wavPath = path.join(recoveryDir, `${meta.id}.wav`);
    await waitFor(() => fs.existsSync(wavPath), 'recovery wav');
    analysis = analyzeWav(fs.readFileSync(wavPath));
    analysis.wallSeconds = (Date.now() - startedAt) / 1000;
    console.log('AUDIO_CAPTURE_TRACE:' + JSON.stringify({ analysis }));
    assert.ok(analysis.seconds > 178 && analysis.seconds < 186, `recorded duration ${analysis.seconds}s`);
    assert.ok(analysis.wallSeconds > 180, 'capture ran on a real wall clock');
    assert.ok(analysis.silenceRms < 0.05, 'silent window remains silent');
    assert.ok(analysis.regions.length >= 3, `expected first/middle/end tone regions, got ${JSON.stringify(analysis.regions)}`);
    const [first, middle, end] = analysis.regions;
    assert.ok(first.startSeconds > 2 && first.startSeconds < 12, `first tone at ${first.startSeconds}s`);
    assert.ok(middle.startSeconds > 85 && middle.startSeconds < 100, `middle tone at ${middle.startSeconds}s`);
    assert.ok(end.startSeconds > 165 && end.startSeconds < 180, `end tone at ${end.startSeconds}s`);
    assert.ok(middle.zcr > first.zcr * 1.3, 'middle 880Hz marker survives downsampling');
    assert.ok(first.zcr > end.zcr * 1.3, 'end 220Hz marker survives downsampling');
    }

    await waitFor(() => pet.webContents.executeJavaScript('window.v2p.getImageState().then((state) => state.canScreenshot === true)'), 'submission settled', 30000);
    await pet.webContents.executeJavaScript(`(() => {
      window.__testStreams = [];
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await original(constraints);
        window.__testStreams.push(stream);
        return stream;
      };
      window.AudioWorkletNode = class { constructor() { throw new Error('worklet disabled for test'); } };
      try { Object.defineProperty(window, 'AudioWorkletNode', { configurable: true, value: class { constructor() { throw new Error('worklet disabled for test'); } } }); } catch {}
      try { Object.defineProperty(AudioContext.prototype, 'createScriptProcessor', { configurable: true, value: function () { throw new Error('fallback disabled for test'); } }); } catch {}
      document.getElementById('stage').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,screenX:120,screenY:120}));
    })()`);
    await waitFor(() => pet.webContents.executeJavaScript("document.getElementById('bubble').textContent.includes('无法开始录音')"), 'startup failure message');
    const failed = await pet.webContents.executeJavaScript(`(async () => ({
      tracksEnded: window.__testStreams.length > 0 && window.__testStreams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended')),
      canScreenshot: (await window.v2p.getImageState()).canScreenshot
    }))()`);
    assert.equal(failed.tracksEnded, true, 'both-init failure stops the microphone tracks');
    assert.equal(failed.canScreenshot, true, 'both-init failure clears the main-process recording flag');
    console.log(PREFIX + JSON.stringify({ ok: true, analysis, failed }));
  } catch (error) {
    console.error(PREFIX + JSON.stringify({ ok: false, error: error.stack }));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-audio-runtime-'));
  const fakeAudio = path.join(directory, 'fake-audio.wav');
  writeFakeAudio(fakeAudio);
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
    asrProviders: [{ id: 'asr-fixture', name: 'fixture', model: 'fixture', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', asrProtocol: 'chat' }],
    llmProviders: [{ id: 'llm-fixture', name: 'fixture', model: 'fixture', baseUrl: 'http://127.0.0.1:9/v1', apiKey: '', multimodal: false }],
    activeAsrId: 'asr-fixture', activeLlmId: 'llm-fixture', hotkey: 'Control+Shift+F12', screenshotHotkey: 'Control+Alt+F12',
    petModel: 'keyboard', mouseRecord: false, triggerMode: 'hold'
  }));
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, ARG], {
        windowsHide: true,
        env: { ...process.env, V2P_AUDIO_PROFILE: directory, V2P_AUDIO_FILE: fakeAudio },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const timeout = setTimeout(() => child.kill(), 250000);
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timeout);
        try {
          const line = output.split(/\r?\n/).find((entry) => entry.startsWith(PREFIX));
          assert.ok(line, output.slice(-4000));
          const result = JSON.parse(line.slice(PREFIX.length));
          assert.equal(result.ok, true, result.error);
          assert.equal(code, 0);
          console.log('PASS hidden-window three-minute AudioWorklet capture and failed-start cleanup');
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