'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { transcribeSmart } = require('./models');
const { parsePcmWav, encodePcmWav, splitPcmWav } = require('./audio-chunks');
const recovery = require('./audio-recovery');

function makeWav(sampleCount) {
  const pcm = Buffer.allocUnsafe(sampleCount * 2);
  for (let i = 0; i < sampleCount; i++) pcm.writeInt16LE((i % 30000) - 15000, i * 2);
  return encodePcmWav(pcm, 16000);
}

function requestAudio(url, request) {
  if (url.endsWith('/audio/transcriptions')) {
    const boundary = request.headers['Content-Type'].split('boundary=')[1];
    const marker = Buffer.from('\r\n\r\n');
    const fileHeader = request.body.indexOf(Buffer.from('name="file"'));
    const start = request.body.indexOf(marker, fileHeader) + marker.length;
    const tail = request.body.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
    return request.body.subarray(start, tail);
  }
  const body = JSON.parse(request.body);
  const data = body.messages[0].content[0].input_audio.data;
  return Buffer.from(data.slice(data.indexOf(',') + 1), 'base64');
}

const okJson = (body) => ({ ok: true, json: async () => body });
const provider = (asrProtocol) => ({ baseUrl: 'https://mock.invalid/v1', apiKey: 'unit-test', model: 'mock-asr', asrProtocol });

async function run() {
  let failed = 0;
  async function test(name, fn) {
    try { await fn(); console.log('PASS', name); }
    catch (error) { failed++; console.error('FAIL', name, error.stack || error.message); }
  }

  await test('five-minute WAV has contiguous complete <=30s chunks and multipart sends exact original PCM bytes', async () => {
    const wav = makeWav(16000 * 300);
    const original = parsePcmWav(wav);
    const observed = [];
    const text = await transcribeSmart(provider('transcriptions'), wav, 'recording.wav', 'audio/wav', {
      fetchImpl: async (url, request) => {
        const sent = requestAudio(url, request);
        const part = parsePcmWav(sent);
        assert.ok(part.samples <= 16000 * 30);
        observed.push(sent.subarray(part.dataStart));
        return okJson({ text: `part${observed.length}` });
      }
    });
    const rebuilt = Buffer.concat(observed);
    assert.deepEqual(rebuilt, wav.subarray(original.dataStart));
    assert.equal(rebuilt.length / 2, 16000 * 300);
    assert.equal(text, Array.from({ length: observed.length }, (_, i) => `part${i + 1}`).join('\n'));
    assert.equal(observed.length, 10);
  });

  await test('AudioWorklet keeps 5 minutes of 48kHz input and flushes its final partial block', async () => {
    let Processor;
    const output = [];
    const processorPort = { onmessage: null, postMessage(message) { if (message.type === 'pcm') output.push(message.samples); } };
    class WorkletBase { constructor() { this.port = processorPort; } }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'audio-capture-worklet.js'), 'utf8'), {
      AudioWorkletProcessor: WorkletBase, sampleRate: 48000, registerProcessor: (_name, ctor) => { Processor = ctor; }, Float32Array, Math
    });
    const instance = new Processor();
    const totalFrames = 48000 * 300 + 17;
    for (let offset = 0; offset < totalFrames; offset += 128) {
      const size = Math.min(128, totalFrames - offset);
      const input = new Float32Array(size);
      input.fill(offset < totalFrames / 3 ? 0.1 : offset < totalFrames * 2 / 3 ? 0.4 : -0.4);
      instance.process([[input]], [[new Float32Array(size)]]);
    }
    instance.port.onmessage({ data: 'flush' });
    const captured = Float32Array.from(output.flatMap((block) => Array.from(block)));
    assert.equal(captured.length, Math.ceil(totalFrames * 16000 / 48000));
    assert.ok(captured[100] > 0.09 && captured[100] < 0.11);
    assert.ok(captured[16000 * 150] > 0.39 && captured[16000 * 150] < 0.41);
    assert.ok(captured[captured.length - 10] < -0.39 && captured[captured.length - 10] > -0.41);
  });

  await test('chat protocol sends valid per-chunk WAVs and concatenates results in request order', async () => {
    const wav = makeWav(16000 * 65);
    const seen = [];
    const text = await transcribeSmart(provider('chat'), wav, 'voice.wav', 'audio/wav', {
      fetchImpl: async (url, request) => {
        assert.equal(url, 'https://mock.invalid/v1/chat/completions');
        const sent = requestAudio(url, request);
        const parsed = parsePcmWav(sent);
        assert.ok(parsed.samples <= 16000 * 30);
        seen.push(sent.subarray(parsed.dataStart));
        return okJson({ choices: [{ finish_reason: 'stop', message: { content: `segment-${seen.length}` } }] });
      }
    });
    assert.equal(Buffer.concat(seen).compare(wav.subarray(44)), 0);
    assert.equal(text, 'segment-1\nsegment-2\nsegment-3');
  });

  await test('refuses malformed WAV lengths and non-PCM input before fetch', async () => {
    const wav = makeWav(1000);
    wav.writeUInt32LE(wav.readUInt32LE(4) - 2, 4);
    let calls = 0;
    await assert.rejects(transcribeSmart(provider('chat'), wav, 'x.wav', 'audio/wav', { fetchImpl: async () => { calls++; } }), /长度与文件头/);
    assert.equal(calls, 0);
  });

  await test('rejects chat length/content-filter endings and never returns their prefix', async () => {
    const wav = makeWav(16000 * 31);
    for (const reason of ['length', 'content_filter']) {
      let calls = 0;
      await assert.rejects(transcribeSmart(provider('chat'), wav, 'x.wav', 'audio/wav', {
        fetchImpl: async () => okJson({ choices: [{ finish_reason: reason, message: { content: `prefix-${calls++}` } }] })
      }), /返回不完整内容/);
    }
    await assert.rejects(transcribeSmart(provider('transcriptions'), wav, 'x.wav', 'audio/wav', {
      fetchImpl: async () => okJson({ finish_reason: 'length', text: 'partial' })
    }), /返回不完整内容/);
  });

  await test('429 and a middle chunk failure reject the entire transcript', async () => {
    const wav = makeWav(16000 * 65);
    await assert.rejects(transcribeSmart(provider('transcriptions'), wav, 'x.wav', 'audio/wav', {
      fetchImpl: async () => ({ ok: false, status: 429, text: async () => 'rate limited' })
    }), /HTTP 429/);
    let calls = 0;
    await assert.rejects(transcribeSmart(provider('chat'), wav, 'x.wav', 'audio/wav', {
      fetchImpl: async () => { calls++; return calls === 2 ? ({ ok: false, status: 503, text: async () => 'down' }) : okJson({ choices: [{ finish_reason: 'stop', message: { content: 'first' } }] }); }
    }), /HTTP 503/);
    assert.equal(calls, 2);
    let silenceCalls = 0;
    const withPause = await transcribeSmart(provider('chat'), makeWav(16000 * 31), 'x.wav', 'audio/wav', {
      fetchImpl: async () => okJson({ choices: [{ finish_reason: 'stop', message: { content: ++silenceCalls === 1 ? '   ' : 'speech after pause' } }] })
    });
    assert.equal(withPause, 'speech after pause', 'valid silent segment does not discard later speech');
    await assert.rejects(transcribeSmart(provider('chat'), makeWav(16000), 'x.wav', 'audio/wav', {
      fetchImpl: async () => okJson({ choices: [{ finish_reason: 'stop', message: {} }] })
    }), /返回为空/);
  });

  await test('each request timeout aborts a stalled fetch', async () => {
    const wav = makeWav(16000 * 2);
    await assert.rejects(transcribeSmart(provider('chat'), wav, 'x.wav', 'audio/wav', {
      timeoutMs: 8,
      fetchImpl: (_url, request) => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason || new Error('aborted'))))
    }), /timed out/);
  });

  await test('recovery survives module reload, rejects stale IDs, stores raw transcript, and clears explicitly', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-audio-test-'));
    try {
      recovery.initialize(dir);
      const first = recovery.save(makeWav(2000));
      const firstData = recovery.get();
      assert.equal(firstData.id, first.id);
      assert.ok(Buffer.isBuffer(firstData.wav));
      delete require.cache[require.resolve('./audio-recovery')];
      const restarted = require('./audio-recovery');
      restarted.initialize(dir);
      assert.equal(restarted.get().id, first.id);
      assert.deepEqual(restarted.saveText(first.id, 'recognized raw'), { ok: true });
      assert.equal(restarted.get().raw, 'recognized raw');
      const second = restarted.save(makeWav(1000));
      assert.equal(restarted.clear(first.id).ok, false);
      assert.equal(restarted.get().id, second.id);
      assert.deepEqual(restarted.clear(second.id), { ok: true });
      assert.equal(restarted.get().id, null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  if (failed) process.exitCode = 1;
  else console.log('AUDIO CHUNK UNIT ALL PASS');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
