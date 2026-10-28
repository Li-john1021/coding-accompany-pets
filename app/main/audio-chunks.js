'use strict';

function parsePcmWav(wav) {
  if (!Buffer.isBuffer(wav) || wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('录音 WAV 格式无效');
  }
  const riffSize = wav.readUInt32LE(4);
  if (riffSize + 8 !== wav.length) throw new Error('录音 WAV 长度与文件头不一致');
  let offset = 12, format = null, data = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString('ascii', offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + size;
    if (end > wav.length) throw new Error('录音 WAV 区块长度无效');
    if (id === 'fmt ') {
      if (size < 16) throw new Error('录音 WAV 格式区块无效');
      format = {
        code: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2), rate: wav.readUInt32LE(start + 4),
        byteRate: wav.readUInt32LE(start + 8), blockAlign: wav.readUInt16LE(start + 12), bits: wav.readUInt16LE(start + 14)
      };
    }
    if (id === 'data') data = { start, size };
    offset = end + (size & 1);
  }
  if (!format || !data || format.code !== 1 || format.channels !== 1 || format.bits !== 16 || !format.rate || format.byteRate !== format.rate * 2 || format.blockAlign !== 2 || data.size % 2) {
    throw new Error('录音必须是单声道 16 位 PCM WAV');
  }
  const bytesPerSample = format.bits / 8;
  if (data.size !== wav.length - data.start) throw new Error('录音 WAV 含有未支持的尾随数据');
  return { wav, sampleRate: format.rate, samples: data.size / bytesPerSample, dataStart: data.start };
}

function encodePcmWav(samples, sampleRate) {
  if (!Buffer.isBuffer(samples) || samples.length % 2 || samples.length > 0xffffffff - 36) throw new Error('录音片段大小无效');
  const wav = Buffer.allocUnsafe(44 + samples.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + samples.length, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(samples.length, 40); samples.copy(wav, 44);
  return wav;
}

function splitPcmWav(wav, { maxSeconds = 30, silenceWindowMs = 250, searchSeconds = 2 } = {}) {
  const parsed = parsePcmWav(wav);
  const maxSamples = Math.floor(parsed.sampleRate * maxSeconds);
  if (maxSamples < 1) throw new Error('录音分段时长无效');
  const chunkCount = Math.ceil(parsed.samples / maxSamples);
  const boundaries = [];
  let startSample = 0;
  for (let part = 1; part < chunkCount; part++) {
    const latest = Math.min(parsed.samples - 1, startSample + maxSamples);
    const earliest = Math.max(startSample + 1, parsed.samples - (chunkCount - part) * maxSamples);
    const ideal = latest;
    const radius = Math.min(Math.floor(parsed.sampleRate * searchSeconds), Math.floor((maxSamples - 1) / 2));
    const win = Math.max(1, Math.floor(parsed.sampleRate * silenceWindowMs / 1000));
    let best = ideal, bestEnergy = Infinity;
    const lo = Math.max(earliest, ideal - radius), hi = Math.min(latest, ideal + radius);
    for (let candidate = lo; candidate <= hi; candidate += Math.max(1, Math.floor(win / 4))) {
      const a = Math.max(startSample, candidate - Math.floor(win / 2));
      const b = Math.min(parsed.samples, a + win);
      let energy = 0;
      for (let i = a; i < b; i++) { const sample = wav.readInt16LE(parsed.dataStart + i * 2); energy += sample * sample; }
      energy /= Math.max(1, b - a);
      if (energy < bestEnergy) { bestEnergy = energy; best = candidate; }
    }
    best = Math.max(earliest, Math.min(latest, best));
    boundaries.push(best);
    startSample = best;
  }
  boundaries.push(parsed.samples);
  const chunks = [];
  startSample = 0;
  for (const endSample of boundaries) {
    if (endSample <= startSample || endSample - startSample > maxSamples) throw new Error('录音分段样本覆盖无效');
    const bytes = wav.subarray(parsed.dataStart + startSample * 2, parsed.dataStart + endSample * 2);
    chunks.push({ index: chunks.length, startSample, endSample, sampleRate: parsed.sampleRate, wav: encodePcmWav(bytes, parsed.sampleRate) });
    startSample = endSample;
  }
  return chunks;
}

module.exports = { parsePcmWav, encodePcmWav, splitPcmWav };
