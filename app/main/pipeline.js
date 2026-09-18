// pipeline.js — 核心管线：音频 → ASR → 整理+优化 → 光标插入
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { chatCompletion, transcribeSmart } = require('./models');
const { insertText } = require('./insert');
const { STRUCTURE_ONLY_PROMPT } = require('./config');

function findProvider(kind, id) {
  const cfg = config.load();
  const list = kind === 'asr' ? cfg.asrProviders : cfg.llmProviders;
  const activeId = kind === 'asr' ? cfg.activeAsrId : cfg.activeLlmId;
  const p = list.find((x) => x.id === (id || activeId));
  if (!p) throw new Error(kind === 'asr' ? '未配置语音（ASR）模型，请先在设置中添加' : '未配置文字（LLM）模型，请先在设置中添加');
  return { ...p, apiKey: config.unmask(p.apiKey) };
}

function extForMime(mime) {
  if (!mime) return 'webm';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('m4a')) return 'm4a';
  return 'webm';
}

// state 回调：onState(stage) stage ∈ listening|transcribing|polishing|inserting|done|error
async function run(audioBuffer, mime, onState) {
  const cfg = config.load();
  const tmpFile = path.join(os.tmpdir(), `v2p-${Date.now()}.${extForMime(mime)}`);
  fs.writeFileSync(tmpFile, audioBuffer);
  try {
    onState('transcribing');
    const asr = findProvider('asr');
    const raw = await transcribeSmart(asr, audioBuffer, path.basename(tmpFile), mime || 'audio/wav');
    if (!raw) throw new Error('没有识别到语音内容');

    // 输出处理开关组合：
    //  两关皆关 → 纯转录直插；仅结构化 → 内置整理提示词；优化开 → 用户可编辑的优化提示词
    let polished;
    if (!cfg.enableStructure && !cfg.enableOptimize) {
      polished = raw;
    } else if (cfg.enableOptimize) {
      onState('polishing');
      const llm = findProvider('llm');
      let sys = cfg.promptText || config.DEFAULT_PROMPT;
      if (!cfg.enableStructure) {
        sys += '\n\n# 本次附加约束\n- 不要求分节与编号结构，保持自然连贯的表达。';
      }
      polished = await chatCompletion(llm, sys, raw);
    } else {
      onState('polishing');
      const llm = findProvider('llm');
      polished = await chatCompletion(llm, STRUCTURE_ONLY_PROMPT, raw);
    }

    onState('inserting');
    const { inserted, copiedOnly } = await insertText(polished, cfg.insertMode);
    onState('done');
    return { raw, polished, inserted, copiedOnly };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

module.exports = { run, findProvider };
