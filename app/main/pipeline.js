// pipeline.js — 核心管线：音频 → ASR → 按需整理 → 写入；文本整理可被选区/预览共用
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { chatCompletion, transcribeSmart } = require('./models');
const { insertText } = require('./insert');
const { STRUCTURE_ONLY_PROMPT, DEFAULT_PROMPT, ensureRedline } = config;

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

// 解析生效模式：'default' 读全局开关；默认（皆不勾）= 不处理
function resolveMode(mode, cfg = config.load()) {
  if (mode === 'none' || mode === 'structure' || mode === 'optimize') return mode;
  if (cfg.enableOptimize) return 'optimize';
  if (cfg.enableStructure) return 'structure';
  return 'none';
}

// 启发式：输出是否像「直接回答了问题」而非改写
function looksLikeDirectAnswer(input, output) {
  const inp = String(input || '').trim();
  const out = String(output || '').trim();
  if (!out) return true;
  // 元话语开场
  if (/^(好的|当然|当然可以|没问题|以下是|下面是|整理如下|答案是|简单来说|请注意)[，,：:\s]/.test(out)) return true;
  // 整段被代码块包裹
  if (/^```[\s\S]*```$/.test(out)) return true;

  const isQuestion = /[?？]\s*$|^(什么是|为什么|如何|怎么|怎样|请问|是不是|能否|能不能|是什么)/.test(inp);
  // 仍是问句 / 任务框 / 与原文接近 → 视为合法改写
  const stillQuestion = /[?？]\s*$/.test(out);
  const looksPrompt = /#|请(解释|说明|回答|列出|比较|总结)|提示词|任务[:：]|问题[:：]/.test(out.slice(0, 80));
  if (stillQuestion || looksPrompt) return false;

  if (isQuestion) {
    // 回答体：定义句 / 原因句 / 步骤答
    if (/[是指的]指的是|是指|是一种|本质上|可以通过|主要原因|原因有|答案[:：]|因为[,，]/.test(out.slice(0, 80))) return true;
    // 「XX是…」定义开头（排除「什么是…」这类仍是问题的开头）
    if (/^(?!什么|为何|为什么|如何|怎么|怎样)[\u4e00-\u9fa5A-Za-z]{1,12}是[^指？?]/.test(out.slice(0, 24))) return true;
    const inLen = inp.replace(/\s+/g, '').length;
    const outLen = out.replace(/\s+/g, '').length;
    if (outLen > Math.max(20, inLen * 1.6)) return true;
  }

  // 异常膨胀（输入偏短却写成一篇）
  const inLen = inp.replace(/\s+/g, '').length;
  const outLen = out.replace(/\s+/g, '').length;
  if (inLen >= 6 && outLen > inLen * 2.5) return true;
  return false;
}

async function chatOnce(llm, sys, userText) {
  return chatCompletion(llm, ensureRedline(sys), userText);
}

// 对文本按模式整理（语音 / 选区 / 预览共用）
// 返回 { text, mode, degraded, note }
async function processText(raw, mode = 'default', onState = () => {}) {
  const cfg = config.load();
  const resolved = resolveMode(mode, cfg);
  if (resolved === 'none') {
    return { text: raw, mode: 'none', degraded: false, note: '' };
  }

  onState('polishing');
  const llm = findProvider('llm');

  if (resolved === 'structure') {
    try {
      const text = await chatOnce(llm, STRUCTURE_ONLY_PROMPT, raw);
      if (looksLikeDirectAnswer(raw, text)) {
        const retry = await chatOnce(
          llm,
          STRUCTURE_ONLY_PROMPT + '\n\n# 本次附加约束\n- 你刚才违规输出了非改写内容。本次只输出整理后的文本，禁止任何回答。',
          raw
        );
        if (!looksLikeDirectAnswer(raw, retry)) return { text: retry, mode: 'structure', degraded: false, note: '' };
        return { text: raw, mode: 'none', degraded: true, note: '已降级为原文' };
      }
      return { text, mode: 'structure', degraded: false, note: '' };
    } catch (e) {
      return { text: raw, mode: 'none', degraded: true, note: '结构化失败，已降级为原文' };
    }
  }

  // optimize
  let sys = cfg.promptText || DEFAULT_PROMPT;
  if (!cfg.enableStructure) {
    sys += '\n\n# 本次附加约束\n- 不强制分节与编号结构，可保持自然连贯；需要给 AI 用时仍可按需分节。';
  }
  try {
    let text = await chatOnce(llm, sys, raw);
    if (looksLikeDirectAnswer(raw, text)) {
      text = await chatOnce(
        llm,
        sys + '\n\n# 本次附加约束\n- 你刚才违规回答了问题。本次只输出改写后的提示词/文本本体，禁止任何答案。',
        raw
      );
    }
    if (looksLikeDirectAnswer(raw, text)) {
      // 降级仅结构化
      try {
        const s = await chatOnce(llm, STRUCTURE_ONLY_PROMPT, raw);
        if (!looksLikeDirectAnswer(raw, s)) {
          return { text: s, mode: 'structure', degraded: true, note: '优化跑偏，已降级为结构化' };
        }
      } catch { /* fall through */ }
      return { text: raw, mode: 'none', degraded: true, note: '已降级为原文' };
    }
    return { text, mode: 'optimize', degraded: false, note: '' };
  } catch (e) {
    try {
      const s = await chatOnce(llm, STRUCTURE_ONLY_PROMPT, raw);
      return { text: s, mode: 'structure', degraded: true, note: '优化失败，已降级为结构化' };
    } catch {
      return { text: raw, mode: 'none', degraded: true, note: '处理失败，已降级为原文' };
    }
  }
}

// state 回调：onState(stage) stage ∈ listening|transcribing|polishing|inserting|done|error
async function run(audioBuffer, mime, onState, options = {}) {
  const cfg = config.load();
  const tmpFile = path.join(os.tmpdir(), `v2p-${Date.now()}.${extForMime(mime)}`);
  fs.writeFileSync(tmpFile, audioBuffer);
  try {
    onState('transcribing');
    const asr = findProvider('asr');
    const raw = await transcribeSmart(asr, audioBuffer, path.basename(tmpFile), mime || 'audio/wav');
    if (!raw) throw new Error('没有识别到语音内容');

    // preview 模式：只返回转写，由预览卡决定后续 processText
    if (options.transcriptOnly) {
      return { raw, polished: raw, mode: 'none', inserted: false, copiedOnly: true, preview: true };
    }

    const mode = resolveMode(options.mode, cfg);
    const result = await processText(raw, mode, onState);

    onState('inserting');
    const { inserted, copiedOnly } = await insertText(result.text, cfg.insertMode);
    onState('done');
    return {
      raw,
      polished: result.text,
      mode: result.mode,
      degraded: result.degraded,
      note: result.note,
      inserted,
      copiedOnly
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

module.exports = { run, findProvider, processText, resolveMode, looksLikeDirectAnswer };
