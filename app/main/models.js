// models.js — OpenAI 兼容端点调用：LLM chat / ASR transcription / 模型校验
const crypto = require('crypto');

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
async function transcribe(provider, audioBuffer, filename, mime) {
  const url = joinUrl(provider.baseUrl, '/audio/transcriptions');
  const boundary = '----v2p' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${provider.model}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const body = Buffer.concat([head, audioBuffer, tail]);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      Authorization: `Bearer ${provider.apiKey}`
    },
    body,
    signal: AbortSignal.timeout(120_000)
  });
  if (!resp.ok) {
    throw new Error(`ASR 调用失败 HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data = await resp.json();
  if (!data?.text && data?.text !== '') throw new Error('ASR 返回为空');
  return data.text.trim();
}

// ---------- ASR 协议二：chat 多模态（小米 MiMo 等，音频走 /chat/completions 的 input_audio） ----------
async function transcribeViaChat(provider, audioBuffer, mime) {
  const url = joinUrl(provider.baseUrl, '/chat/completions');
  const b64 = audioBuffer.toString('base64');
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: { data: `data:${mime};base64,${b64}` }
            }
          ]
        }
      ],
      stream: false
    }),
    signal: AbortSignal.timeout(120_000)
  });
  if (!resp.ok) {
    throw new Error(`ASR(chat) 调用失败 HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text && text !== '') throw new Error('ASR 返回为空');
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

async function transcribeSmart(provider, audioBuffer, filename, mime) {
  if (effectiveAsrProtocol(provider) === 'chat') {
    return transcribeViaChat(provider, audioBuffer, mime || 'audio/wav');
  }
  return transcribe(provider, audioBuffer, filename, mime);
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

module.exports = { chatCompletion, transcribe, transcribeSmart, validateLlm, validateAsr, shouldDisableThinking };
