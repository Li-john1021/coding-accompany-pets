'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parsePcmWav } = require('./audio-chunks');

const ARG = '--asr-live-fixture';
const PREFIX = 'ASR_LIVE:';

const GEN_SCRIPT = `Add-Type -AssemblyName System.Speech
$path = Join-Path $env:TEMP 'asr-live-v2p.wav'
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.Rate = -1
$s.SelectVoice('Microsoft Zira Desktop')
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s.SetOutputToWaveFile($path, $fmt)
$a = 'First segment. Alpha one two three. Keep the number three point one four one five nine. '
$b = 'Second segment. Bravo four five six. Order code A B seven Q nine zero two six one five. '
$c = 'Third segment. Charlie seven eight nine. This is the final part. '
$text = $a * 4
$text += '<break time="900ms"/>' + ($b * 4)
$text += '<break time="900ms"/>' + ($c * 4)
$ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">' + $text + '</speak>'
$s.SpeakSsml($ssml)
$s.Dispose()
[Console]::Out.WriteLine($path)`;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function generateFixture(directory) {
  const script = path.join(directory, 'gen.ps1');
  const wav = path.join(directory, 'asr-live.wav');
  fs.writeFileSync(script, GEN_SCRIPT, 'ascii');
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(output.slice(-2000))));
  });
  const generated = path.join(process.env.TEMP, 'asr-live-v2p.wav');
  fs.copyFileSync(generated, wav);
  fs.rmSync(generated, { force: true });
  return wav;
}

async function fixture() {
  const { app } = require('electron');
  app.setPath('userData', process.env.V2P_ASR_PROFILE);
  try {
    await app.whenReady();
    const config = require('./config');
    const models = require('./models');
    const cfg = config.load();
    const provider = cfg.asrProviders.find((item) => item.id === cfg.activeAsrId);
    assert.ok(provider, 'real config has an active ASR provider');
    provider.apiKey = config.unmask(provider.apiKey);
    const wav = fs.readFileSync(process.env.V2P_ASR_WAV);
    const parsed = parsePcmWav(wav);
    const progress = [];
    const started = Date.now();
    const text = await models.transcribeSmart(provider, wav, 'fixture.wav', 'audio/wav', {
      timeoutMs: 120000,
      onProgress: (event) => progress.push(event)
    });
    const ms = Date.now() - started;
    assert.ok(text.trim().length > 0, 'real ASR returns non-empty text');
    const lower = text.toLowerCase();
    assert.ok(lower.includes('first') || lower.includes('segment'), text);
    assert.ok(lower.includes('third') || lower.includes('final'), text);
    const chunks = [...new Set(progress.map((event) => event.total))];
    assert.deepStrictEqual(chunks, [4], '97-second input is split into four chunks');
    assert.ok(progress.some((event) => event.completed === 4), 'all four chunks complete');
    console.log(PREFIX + JSON.stringify({
      ok: true, model: provider.model, host: new URL(provider.baseUrl).host,
      durationSeconds: parsed.samples / parsed.sampleRate, fixtureSha256: sha256(wav),
      ms, progress, text, textSha256: sha256(text)
    }));
  } catch (error) {
    console.error(PREFIX + JSON.stringify({ ok: false, error: error.stack }));
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}

async function run() {
  if (process.env.V2P_ALLOW_REAL_ASR !== '1') {
    console.log('SKIP real ASR validation (set V2P_ALLOW_REAL_ASR=1 to spend up to four real ASR calls)');
    return;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-asr-live-'));
  try {
    const wavPath = await generateFixture(directory);
    const wav = fs.readFileSync(wavPath);
    const parsed = parsePcmWav(wav);
    assert.equal(parsed.sampleRate, 16000);
    assert.ok(parsed.samples / parsed.sampleRate > 60, 'fixture spans multiple 30-second chunks');
    const realProfile = path.join(process.env.APPDATA, 'Voice2Prompt');
    const result = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [__filename, ARG], {
        windowsHide: true,
        env: { ...process.env, V2P_ASR_PROFILE: realProfile, V2P_ASR_WAV: wavPath },
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
          const parsedResult = JSON.parse(line.slice(PREFIX.length));
          assert.equal(parsedResult.ok, true, JSON.stringify(parsedResult).slice(0, 8000));
          assert.equal(code, 0);
          resolve(parsedResult);
        } catch (error) { reject(error); }
      });
    });
    const evidence = [
      'Feedback v2 live ASR evidence',
      'Date: ' + new Date().toISOString(),
      '',
      'Fixture: Windows SAPI Zira TTS, 16k mono PCM WAV',
      'fixtureSha256: ' + sha256(wav),
      'durationSeconds: ' + (parsed.samples / parsed.sampleRate),
      '',
      'Provider:',
      'model: ' + result.model,
      'host: ' + result.host,
      'asrRequests: 4 (new budget max 10; previous calls unchanged)',
      'chunks: ' + JSON.stringify(result.progress),
      'ms: ' + result.ms,
      'textSha256: ' + result.textSha256,
      'text: ' + JSON.stringify(result.text)
    ].join('\n');
    fs.writeFileSync(path.join(__dirname, '..', '..', 'docs', 'evidence', 'feedback-asr-live.txt'), evidence + '\n', 'utf8');
    console.log('PASS real ASR accepted four bounded chunks and merged non-empty text');
    console.log('EVIDENCE ' + JSON.stringify({ ms: result.ms, chunks: result.progress, textSha256: result.textSha256, textLength: result.text.length, fixtureSha256: result.fixtureSha256 }));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv.includes(ARG)) fixture();
else run().catch((error) => { console.error(error); process.exitCode = 1; });