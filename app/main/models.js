// models.js — OpenAI 兼容端点调用：LLM chat / ASR transcription / 模型校验
const crypto = require('crypto');
const { IMAGE_TRANSCRIPTION_PROMPT, IMAGE_VALIDATION_TOKEN } = require('./vision-prompts');
const { splitPcmWav } = require('./audio-chunks');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function requestSignal(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
  const abort = () => controller.abort(externalSignal.reason);
  if (externalSignal) {
    if (externalSignal.aborted) abort();
    else externalSignal.addEventListener('abort', abort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    }
  };
}

function assertPngBuffer(pngBuffer) {
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length < PNG_SIGNATURE.length + 25 || !pngBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('图片必须是非空 PNG');
  }
  let offset = PNG_SIGNATURE.length;
  let hasHeader = false;
  while (offset + 12 <= pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > pngBuffer.length) break;
    if (!hasHeader) {
      if (type !== 'IHDR' || length !== 13 || pngBuffer.readUInt32BE(offset + 8) === 0 || pngBuffer.readUInt32BE(offset + 12) === 0) break;
      hasHeader = true;
    }
    if (type === 'IEND') {
      if (length === 0 && hasHeader && end === pngBuffer.length) return;
      break;
    }
    offset = end;
  }
  throw new Error('图片必须是非空 PNG');
}

function finalMessageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => {
    if (typeof block === 'string') return block;
    if (block && (block.type === undefined || block.type === 'text' || block.type === 'output_text') && typeof block.text === 'string') return block.text;
    return '';
  }).join('');
}

async function transcribeImage(provider, pngBuffer, opts = {}) {
  assertPngBuffer(pngBuffer);
  const url = joinUrl(provider.baseUrl, '/chat/completions');
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Math.max(1, opts.timeoutMs) : 120_000;
  const request = requestSignal(timeoutMs, opts.signal);
  const body = {
    model: provider.model,
    messages: [{ role: 'user', content: [
      { type: 'text', text: IMAGE_TRANSCRIPTION_PROMPT },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${pngBuffer.toString('base64')}` } }
    ] }],
    stream: false
  };
  if (shouldDisableThinking(provider)) {
    body.thinking = { type: 'disabled' };
    body.reasoning_effort = 'none';
  }
  try {
    const resp = await (opts.fetchImpl || fetch)(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify(body),
      signal: request.signal
    });
    if (!resp.ok) throw new Error(`视觉转写失败 HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const data = await resp.json();
    const text = finalMessageText(data?.choices?.[0]?.message);
    if (!text.trim()) throw new Error('视觉模型未返回转写正文');
    return text;
  } finally {
    request.cleanup();
  }
}

async function validateImageVision(provider, opts = {}) {
  if (!provider || !String(provider.baseUrl || '').trim() || !String(provider.model || '').trim()) {
    return { ok: false, error: '请先填写识图模型的 Base URL 和模型名' };
  }
  try {
    const pngBuffer = opts.pngBuffer || require('fs').readFileSync(require('path').join(__dirname, 'vision-validation.png'));
    const text = await transcribeImage(provider, pngBuffer, opts);
    if (!text.includes(IMAGE_VALIDATION_TOKEN)) {
      return { ok: false, error: `图片接口已响应，但未识别校验文字 ${IMAGE_VALIDATION_TOKEN}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message || error).slice(0, 200) };
  }
}

function joinUrl(baseUrl, suffix) {
  const b = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!b) throw new Error('Base URL 为空');
  // 允许用户直接填到 /chat/completions，避免重复拼接
  if (suffix === '/chat/completions' && b.endsWith('/chat/completions')) return b;
  if (suffix === '/audio/transcriptions' && b.endsWith('/audio/transcriptions')) return b;
  return b + suffix;
}

// ---------- LLM：chat completions（一次性，返回全文） ----------
// 思考模式控制:混合推理模型(MiMo v2.5 等)默认开思考,每次整理先烧
// 一两百个 reasoning tokens(实测 4~8s)。noThinking: true=强制关,
// false=保留, undefined=自动(仅 MiMo 域名自动关)。
function shouldDisableThinking(provider, mode, cfg) {
  // 模式级强制关思考（结构化/优化各自 checkbox，默认开=关思考优先速度）
  if (mode === 'structure' && cfg && cfg.structureDisableThinking === true) return true;
  if (mode === 'optimize' && cfg && cfg.optimizeDisableThinking === true) return true;
  if (provider && provider.noThinking === true) return true;
  if (provider && provider.noThinking === false) return false;
  return /xiaomimimo/i.test((provider && provider.baseUrl) || '');
}

async function chatCompletion(provider, systemPrompt, userText, opts) {
  const mode = opts && opts.mode;
  const cfg = opts && opts.cfg;
  const url = joinUrl(provider.baseUrl, '/chat/completions');
  const body = {
    model: provider.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ],
    stream: false
  };
  if (shouldDisableThinking(provider, mode, cfg)) {
    // GLM 式与 OpenAI 式各带一份,兼容多厂商;不认识的字段会被大多数兼容端点忽略
    body.thinking = { type: 'disabled' };
    body.reasoning_effort = 'none';
  }
  const t0 = Date.now();
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  });
  if (!resp.ok) {
    throw new Error(`LLM 调用失败 HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data = await resp.json();
  const msg = data?.choices?.[0]?.message || {};
  // 有的端点把思考写进 reasoning_content / thinking，content 才是正文；都拼进 content 时剥掉
  let text = msg.content;
  if (typeof text !== 'string') {
    if (Array.isArray(text)) {
      text = text.map((p) => (p && (p.text || p.content)) || '').join('');
    } else {
      text = msg.reasoning_content || msg.thinking || '';
    }
  }
  if (!text || !String(text).trim()) throw new Error('LLM 返回为空');
  console.log(`[llm] ${Date.now() - t0}ms completion_tokens=${data?.usage?.completion_tokens ?? '?'} reasoning=${data?.usage?.completion_tokens_details?.reasoning_tokens ?? 0}`);
  return String(text).trim();
}

// ---------- ASR：OpenAI 兼容 /audio/transcriptions（multipart 手写，无第三方依赖） ----------
async function transcribe(provider, audioBuffer, filename, mime, opts = {}) {
  const url = joinUrl(provider.baseUrl, '/audio/transcriptions');
  const boundary = '----v2p' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${provider.model}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([head, audioBuffer, tail]);
  const request = requestSignal(Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 120_000, opts.signal);
  let data;
  try {
    const resp = await (opts.fetchImpl || fetch)(url, {
      method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Authorization: `Bearer ${provider.apiKey}` },
      body, signal: request.signal
    });
    if (!resp.ok) throw new Error(`ASR 调用失败 HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    data = await resp.json();
  } finally { request.cleanup(); }
  const finishReason = data?.finish_reason || data?.choices?.[0]?.finish_reason;
  if (finishReason === 'length' || finishReason === 'content_filter') throw new Error(`ASR 返回不完整内容 (${finishReason})`);
  if (typeof data?.text !== 'string') throw new Error('ASR 返回为空');
  return data.text.trim();
}

// ---------- ASR 协议二：chat 多模态（小米 MiMo 等，音频走 /chat/completions 的 input_audio） ----------
async function transcribeViaChat(provider, audioBuffer, mime, opts = {}) {
  const url = joinUrl(provider.baseUrl, '/chat/completions');
  const b64 = audioBuffer.toString('base64');
  const request = requestSignal(Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 120_000, opts.signal);
  let data;
  try {
    const resp = await (opts.fetchImpl || fetch)(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({ model: provider.model, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:${mime};base64,${b64}` } }] }], stream: false }),
      signal: request.signal
    });
    if (!resp.ok) throw new Error(`ASR(chat) 调用失败 HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    data = await resp.json();
  } finally { request.cleanup(); }
  const finishReason = data?.choices?.[0]?.finish_reason;
  if (finishReason === 'length' || finishReason === 'content_filter') throw new Error(`ASR(chat) 返回不完整内容 (${finishReason})`);
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('ASR 返回为空');
  return String(text).trim();
}

// 统一入口：按 provider.asrProtocol 分发（默认 transcriptions；'chat' 为 MiMo 式）
// 智能兜底：未显式选择协议但 Base URL 是小米 MiMo 域名时，自动走 chat 协议，
// 避免旧配置缺少 asrProtocol 字段时仍打不存在的 /audio/transcriptions。
function effectiveAsrProtocol(provider) {
  if (provider.asrProtocol) return provider.asrProtocol;
  if (/xiaomimimo/i.test(provider.baseUrl || '')) return 'chat';
  return 'transcriptions';
}

async function transcribeSmart(provider, audioBuffer, filename, mime, opts = {}) {
  const audioMime = mime || 'audio/wav';
  const chunks = audioMime === 'audio/wav' ? splitPcmWav(audioBuffer, opts.chunking) : [{ index: 0, wav: audioBuffer }];
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    if (opts.signal?.aborted) throw opts.signal.reason || new Error('ASR 已取消');
    const chunk = chunks[i];
    opts.onProgress?.({ completed: i, total: chunks.length, index: i });
    const callOptions = { ...opts, timeoutMs: opts.timeoutMs ?? 120_000 };
    const text = effectiveAsrProtocol(provider) === 'chat'
      ? await transcribeViaChat(provider, chunk.wav, audioMime, callOptions)
      : await transcribe(provider, chunk.wav, chunks.length > 1 ? `part-${i + 1}.wav` : filename, audioMime, callOptions);
    const part = String(text).trim();
    if (part) parts.push(part); // A valid empty string can represent a silent segment.
    opts.onProgress?.({ completed: i + 1, total: chunks.length, index: i });
  }
  if (!parts.length) throw new Error('没有识别到语音内容');
  return parts.join('\n').trim();
}

// ---------- 模型校验（防止配置了无法调用的模型） ----------
async function validateLlm(provider) {
  // 用极小的 ping 请求验证：能打通认证、模型名、网络
  const url = joinUrl(provider.baseUrl, '/chat/completions');
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5
    }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 200);
    return { ok: false, error: `HTTP ${resp.status}：${detail || '认证或模型名可能错误'}` };
  }
  const data = await resp.json();
  if (data?.choices?.length) return { ok: true };
  return { ok: false, error: '接口可达但返回格式异常（非 OpenAI 兼容？）' };
}

// 生成 0.3 秒静音 WAV（16k/16bit/mono），用于探测 ASR 端点是否可用
function silentWav() {
  const sampleRate = 16000;
  const samples = Math.floor(sampleRate * 0.3);
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  return buf;
}

async function validateAsr(provider) {
  try {
    if (effectiveAsrProtocol(provider) === 'chat') {
      await transcribeViaChat(provider, silentWav(), 'audio/wav');
    } else {
      await transcribe(provider, silentWav(), 'ping.wav', 'audio/wav');
    }
    return { ok: true };
  } catch (e) {
    // 静音识别返回空文本也算打通；只有网络/认证/格式错误才失败
    const msg = String(e.message || e);
    if (/返回为空/.test(msg)) return { ok: true };
    return { ok: false, error: msg.slice(0, 200) };
  }
}

module.exports = { chatCompletion, transcribe, transcribeSmart, transcribeImage, validateImageVision, validateLlm, validateAsr, shouldDisableThinking };
