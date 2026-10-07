// pipeline.js — 核心管线：音频 → ASR → 按需整理 → 写入；文本整理可被选区/预览共用
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { chatCompletion, transcribeSmart } = require('./models');
const { insertText } = require('./insert');
const { STRUCTURE_ONLY_PROMPT, DEFAULT_PROMPT, ensureRedline } = config;
const { sourceMessage } = require('./text-prompts');

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

// 模型把思考/规则复述当成正文（英文 meta）
const FILLER_RE = /^(嗯+|啊+|哦+|噢+|呃+|额+|哎+|唉+|哈+|呵+|呐+|嘛+|吧+|啦+|[，,。.、\s])+$/;

function stripFillers(raw) {
  return String(raw || '')
    .split(/[\n。.！!？?；;]/)
    .map((x) => x.replace(/(嗯+|啊+|哦+|噢+|呃+|额+|哎+|唉+|那个|就是说|然后的话)/g, '').trim())
    .filter(Boolean)
    .join('。');
}

function looksLikeMetaReasoning(output) {
  const out = String(output || '').trim();
  if (!out) return true;
  if (/^(the user|the instruction|according to|reasoning:|thinking:|hmm,?|wait,?)/i.test(out)) return true;
  if (/filler (word|particle)|output empty|only output final text|remove filler/i.test(out)) return true;
  if (/^好的[，,]?\s*以下是(我的|这段)(思考|推理|分析)/.test(out)) return true;
  return false;
}

// 启发式：输出是否像「直接回答了问题」而非改写
// 优先级：元话语 → 代码块 → 问句+回答体（先于任务框豁免）→ 形态豁免 → 膨胀
function looksLikeDirectAnswer(input, output) {
  const inp = String(input || '').trim();
  const out = String(output || '').trim();
  if (!out) return true;
  if (looksLikeMetaReasoning(out)) return true;

  // 元话语：含裸形态（整段就叫「好的」）与无标点前缀
  if (/^(好的|当然|当然可以|没问题)([，,。：:\s！!]|$)/.test(out)) return true;
  if (/^(以下是|下面是)/.test(out)) return true;
  if (/^(答案是|简单来说|整理如下|请注意)/.test(out)) return true;

  // 整段被代码块包裹
  if (/^```[\s\S]*```$/.test(out)) return true;

  const isQuestion = /[?？]\s*$|^(什么是|为什么|如何|怎么|怎样|请问|是不是|能否|能不能|是什么)/.test(inp);
  const head = out.slice(0, 120);

  // 回答体（戴 # /「任务：」帽子也拦）：定义、原因、答案
  const answerBody =
    /指的是|是指|是一种|本质上|是由于|是因为|原因有|答案[:：]|可以通过以下|主要(原因|做法)/.test(head) ||
    /^(?!什么|为何|为什么|如何|怎么|怎样|请)[\u4e00-\u9fa5A-Za-z]{1,12}是[^指？?于]/.test(out.slice(0, 24));
  if (isQuestion && answerBody) return true;

  // 合法形态：仍是问句 / 祈使提示词口吻（动词表放宽，请+1~6 字）
  const stillQuestion = /[?？]\s*$/.test(out) || /^(什么是|为什么|如何|怎么|怎样|请问|是什么)/.test(out);
  const looksPrompt =
    /(^|\n)\s*#/.test(out) ||
    /请[\u4e00-\u9fa5]{1,8}/.test(out.slice(0, 40)) ||
    /请(解释|说明|回答|列出|比较|总结|实现|编写|生成|撰写|润色|起草|设计|整理|改写|翻译)/.test(out) ||
    /提示词|任务[:：]|问题[:：]|要求[:：]|输出格式|角色[:：]/.test(out);
  if (stillQuestion || looksPrompt) return false;

  const inLen = inp.replace(/\s+/g, '').length;
  const outLen = out.replace(/\s+/g, '').length;

  if (isQuestion) {
    if (outLen > Math.max(40, inLen * 3)) return true;
    return false;
  }

  // 非问句：无结构痕迹且异常膨胀才像发挥；编号/列表/小标题视为合法优化
  const hasStructure = /\n\s*#|\n\s*\d+[.、)]|\n\s*[（(][a-z][)）]|^[-*•]/m.test(out);
  if (!hasStructure && inLen >= 6 && outLen > inLen * 2.5) return true;
  return false;
}

async function chatOnce(llm, sys, userText, mode) {
  const cfg = config.load();
  return chatCompletion(llm, ensureRedline(sys), sourceMessage(userText), { mode, cfg });
}

// 对文本按模式整理（语音 / 选区 / 预览共用）
// 返回 { text, mode, degraded, note }
async function processText(raw, mode = 'default', onState = () => {}) {
  const cfg = config.load();
  const resolved = resolveMode(mode, cfg);
  // 纯语气词：不调模型
  if (!stripFillers(raw)) {
    return { text: '', mode: 'none', degraded: false, note: '仅语气词，无实质内容' };
  }
  if (resolved === 'none') {
    return { text: raw, mode: 'none', degraded: false, note: '' };
  }

  onState(resolved === 'structure' ? 'structuring' : 'optimizing');
  const llm = findProvider('llm');

  if (resolved === 'structure') {
    try {
      const text = await chatOnce(llm, STRUCTURE_ONLY_PROMPT, raw, 'structure');
      if (looksLikeDirectAnswer(raw, text)) {
        const retry = await chatOnce(
          llm,
          STRUCTURE_ONLY_PROMPT + '\n\n# 本次附加约束\n- 你刚才违规输出了非改写内容。本次只输出整理后的文本，禁止任何回答。',
          raw,
          'structure'
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
  try {
    let text = await chatOnce(llm, sys, raw, 'optimize');
    if (looksLikeDirectAnswer(raw, text)) {
      text = await chatOnce(
        llm,
        sys + '\n\n# 本次附加约束\n- 你刚才违规回答了问题。本次只输出改写后的提示词/文本本体，禁止任何答案。',
        raw,
        'optimize'
      );
    }
    if (looksLikeDirectAnswer(raw, text)) {
      // 降级仅结构化
      try {
        const s = await chatOnce(llm, STRUCTURE_ONLY_PROMPT, raw, 'structure');
        if (!looksLikeDirectAnswer(raw, s)) {
          return { text: s, mode: 'structure', degraded: true, note: '优化跑偏，已降级为结构化' };
        }
      } catch { /* fall through */ }
      return { text: raw, mode: 'none', degraded: true, note: '已降级为原文' };
    }
    return { text, mode: 'optimize', degraded: false, note: '' };
  } catch {
    try {
      const s = await chatOnce(llm, STRUCTURE_ONLY_PROMPT, raw, 'structure');
      if (!looksLikeDirectAnswer(raw, s)) {
        return { text: s, mode: 'structure', degraded: true, note: '优化失败，已降级为结构化' };
      }
    } catch { /* fall through */ }
    return { text: raw, mode: 'none', degraded: true, note: '处理失败，已降级为原文' };
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
    const { inserted, copiedOnly } = options.deferDelivery ? { inserted: false, copiedOnly: true } : await insertText(result.text, cfg.insertMode);
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

module.exports = { run, findProvider, processText, resolveMode, looksLikeDirectAnswer, looksLikeMetaReasoning, stripFillers };
