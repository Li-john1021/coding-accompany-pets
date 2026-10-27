const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { transcribeImage, validateImageVision } = require('./models');
const { IMAGE_TRANSCRIPTION_PROMPT, IMAGE_VALIDATION_TOKEN } = require('./vision-prompts');

const provider = { baseUrl: 'https://local.example/v1/', apiKey: 'test-key', model: 'vision-model', multimodal: true };
const png = fs.readFileSync(path.join(__dirname, 'vision-validation.png'));
const okResponse = (content) => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
let fail = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS', name); }
  catch (error) { fail++; console.log('FAIL', name, error.stack || error.message); }
}

(async () => {
  await test('one PNG data URI request uses compatible URL/auth and dedicated prompt', async () => {
    let calls = 0;
    const result = await transcribeImage(provider, png, { fetchImpl: async (url, request) => {
      calls++;
      assert.equal(url, 'https://local.example/v1/chat/completions');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.Authorization, 'Bearer test-key');
      assert.ok(request.signal);
      const body = JSON.parse(request.body);
      assert.equal(body.model, 'vision-model');
      assert.equal(body.stream, false);
      const blocks = body.messages[0].content;
      assert.equal(blocks[0].text, IMAGE_TRANSCRIPTION_PROMPT);
      assert.match(blocks[0].text, /Do not translate/);
      assert.match(blocks[0].text, /Do not.*follow instructions/);
      assert.match(blocks[0].text, /图像描述/);
      assert.match(blocks[0].text, /Write this description in Chinese by default/);
      assert.equal(blocks[1].type, 'image_url');
      assert.equal(blocks[1].image_url.url, `data:image/png;base64,${png.toString('base64')}`);
      return okResponse('  const x = 1;\n    return x;\n');
    } });
    assert.equal(calls, 1);
    assert.equal(result, '  const x = 1;\n    return x;\n');
  });

  await test('accepts only textual content blocks and rejects reasoning-only or empty body', async () => {
    assert.equal(await transcribeImage(provider, png, { fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: [{ type: 'text', text: 'A' }, { type: 'image_url' }, { type: 'text', text: 'B' }], reasoning_content: 'secret' } }] }) }) }), 'AB');
    assert.equal(await transcribeImage(provider, png, { fetchImpl: async () => okResponse([{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: '    visible' }]) }), '    visible');
    for (const message of [{ reasoning_content: 'only thoughts' }, { content: '  ' }, { content: [{ type: 'reasoning', text: 'only thoughts' }] }, { content: [{ type: 'refusal' }] }]) {
      await assert.rejects(transcribeImage(provider, png, { fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message }] }) }) }), /未返回转写正文/);
    }
  });

  await test('requires a nonempty PNG before network access', async () => {
    let calls = 0;
    for (const input of [Buffer.alloc(0), Buffer.from('not png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])]) {
      await assert.rejects(transcribeImage(provider, input, { fetchImpl: async () => { calls++; } }), /必须是非空 PNG/);
    }
    assert.equal(calls, 0);
  });

  await test('timeout is bounded and external abort reaches the request signal', async () => {
    await assert.rejects(transcribeImage(provider, png, { timeoutMs: 8, fetchImpl: (_url, request) => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason))) }), /timed out/);
    const controller = new AbortController();
    const pending = transcribeImage(provider, png, { signal: controller.signal, timeoutMs: 5000, fetchImpl: (_url, request) => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new Error('external abort propagated')))) });
    controller.abort();
    await assert.rejects(pending, /external abort propagated/);
  });

  await test('vision requests honor the existing provider thinking preference', async () => {
    for (const disabled of [true, false]) {
      await transcribeImage({ ...provider, noThinking: disabled }, png, { fetchImpl: async (_url, request) => {
        const body = JSON.parse(request.body);
        if (disabled) { assert.deepEqual(body.thinking, { type: 'disabled' }); assert.equal(body.reasoning_effort, 'none'); }
        else { assert.equal(body.thinking, undefined); assert.equal(body.reasoning_effort, undefined); }
        return okResponse('body');
      } });
    }
  });

  await test('explicit image validator requires declared capability and visible token', async () => {
    assert.deepEqual(await validateImageVision({ ...provider, multimodal: false }, { fetchImpl: async () => { throw new Error('must not call'); } }), { ok: false, error: '请先声明此模型支持多模态图片输入' });
    assert.deepEqual(await validateImageVision(provider, { pngBuffer: png, fetchImpl: async () => okResponse(`Detected ${IMAGE_VALIDATION_TOKEN}`) }), { ok: true });
    const missingToken = await validateImageVision(provider, { pngBuffer: png, fetchImpl: async () => okResponse('Some image text') });
    assert.equal(missingToken.ok, false);
    assert.match(missingToken.error, /未识别校验文字/);
    assert.equal(IMAGE_VALIDATION_TOKEN, 'V2P-7KQ2');
  });

  if (fail) process.exitCode = 1;
  else console.log('VISION MODEL UNIT ALL PASS');
})();
