'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let recoveryDir = path.join(require('os').tmpdir(), `voice2prompt-audio-recovery-${process.pid}`);

function initialize(directory) {
  if (!directory || typeof directory !== 'string') throw new Error('恢复目录无效');
  recoveryDir = path.resolve(directory);
}

function paths() { return { meta: path.join(recoveryDir, 'latest.json') }; }
function readMeta(meta) {
  const value = JSON.parse(fs.readFileSync(meta, 'utf8'));
  if (!/^[a-f0-9-]{36}$/i.test(value.id || '') || !Number.isFinite(value.savedAt)) throw new Error('恢复录音元数据无效');
  return value;
}

function save(wav) {
  if (!Buffer.isBuffer(wav) || wav.length === 0 || wav.length > 128 * 1024 * 1024) throw new Error('恢复录音无效或过大');
  fs.mkdirSync(recoveryDir, { recursive: true });
  const { meta } = paths();
  const id = crypto.randomUUID();
  const wavPath = path.join(recoveryDir, `${id}.wav`);
  const nextMeta = `${meta}.${process.pid}.tmp`;
  let oldId = null;
  try {
    fs.writeFileSync(wavPath, wav, { mode: 0o600 });
    fs.writeFileSync(nextMeta, JSON.stringify({ id, raw: null, savedAt: Date.now() }), { mode: 0o600 });
    if (fs.existsSync(meta)) { try { oldId = readMeta(meta).id; } catch { /* replace invalid metadata */ } }
    fs.renameSync(nextMeta, meta);
  } catch (error) {
    try { fs.unlinkSync(wavPath); } catch { /* best-effort cleanup */ }
    try { fs.unlinkSync(nextMeta); } catch { /* best-effort cleanup */ }
    throw error;
  }
  if (oldId && oldId !== id) { try { fs.unlinkSync(path.join(recoveryDir, `${oldId}.wav`)); } catch { /* stale cleanup */ } }
  return { ok: true, id };
}

function get() {
  const { meta } = paths();
  if (!fs.existsSync(meta)) return { ok: true, id: null, wav: null, raw: null };
  const details = readMeta(meta);
  if (Date.now() - details.savedAt > 7 * 24 * 60 * 60 * 1000) { clear(details.id); return { ok: true, id: null, wav: null, raw: null }; }
  const wav = path.join(recoveryDir, `${details.id}.wav`);
  if (!fs.existsSync(wav)) {
    try { fs.unlinkSync(meta); } catch { /* stale metadata cleanup */ }
    return { ok: true, id: null, wav: null, raw: null };
  }
  return { ok: true, id: details.id, wav: fs.readFileSync(wav), raw: details.raw || null };
}

function saveText(id, raw) {
  const { meta } = paths();
  if (!fs.existsSync(meta)) return { ok: false, error: '恢复录音已不存在' };
  const details = readMeta(meta);
  if (id !== details.id) return { ok: false, error: '恢复录音已被替换' };
  details.raw = String(raw).slice(0, 2_000_000);
  const nextMeta = `${meta}.${process.pid}.tmp`;
  fs.writeFileSync(nextMeta, JSON.stringify(details), { mode: 0o600 });
  fs.renameSync(nextMeta, meta);
  return { ok: true };
}

function clear(id) {
  const { meta } = paths();
  let wav = null;
  if (fs.existsSync(meta)) {
    const details = readMeta(meta);
    if (id && details.id !== id) return { ok: false, error: '恢复录音已被替换' };
    wav = path.join(recoveryDir, `${details.id}.wav`);
  }
  for (const target of [wav, meta].filter(Boolean)) {
    try { fs.unlinkSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { ok: true };
}

module.exports = { initialize, save, get, saveText, clear };
