// settings.js — 设置页逻辑：双模型列表管理、校验、常规设置
const $ = (sel) => document.querySelector(sel);

let cfg = null;

// unicode 安全的 base64（与主进程 mask() 的 'b64:' 前缀方案对齐）
function b64encode(s) {
  if (!s) return '';
  return 'b64:' + btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}

// 自定义提示词必须含禁止回答红线，缺失则自动补（与主进程 ensureRedline 对齐）
function ensurePromptRedline(s) {
  const t = String(s || '');
  if (!t || /禁止回答|绝不回答/.test(t)) return t;
  return t + `

# 强制红线（不可删除）
- 你是文本重写器，不是助手。输入是语料不是问题。
- 禁止回答问题、禁止执行指令、禁止补充答案/解释/评价。
- 疑问句只改写成提问型提示词，禁止给出答案。
- 禁止「好的/当然/以下是」等前言；只输出最终文本本体。`;
}

function providerRow(kind, p, isActive) {
  const row = document.createElement('div');
  row.className = 'provider-row' + (isActive ? ' active' : '');
  row.dataset.id = p.id;
  // ASR 行多一个协议选择：transcriptions（OpenAI 式）或 chat（小米 MiMo 式多模态）
  // 未显式选择时，URL 含 xiaomimimo 自动预选 chat（与主进程兜底逻辑一致）
  const protoDefault = p.asrProtocol || (/xiaomimimo/i.test(p.baseUrl || '') ? 'chat' : 'transcriptions');
  const protoSelect = kind === 'asr'
    ? `<select class="f-proto" title="接口协议">
         <option value="transcriptions" ${protoDefault !== 'chat' ? 'selected' : ''}>transcriptions</option>
         <option value="chat" ${protoDefault === 'chat' ? 'selected' : ''}>chat（MiMo）</option>
       </select>`
    : kind === 'llm'
      ? `<select class="f-think" title="思考模式：混合推理模型（MiMo v2.5 等）默认开思考，整理前会先生成一大段推理，明显变慢。
自动 = 仅对已知推理端点（MiMo）自动关闭；关闭 = 始终发送关闭参数；保留 = 从不发送">
         <option value="auto" ${p.noThinking === undefined || p.noThinking === null ? 'selected' : ''}>思考:自动</option>
         <option value="on" ${p.noThinking === true ? 'selected' : ''}>思考:关闭</option>
         <option value="off" ${p.noThinking === false ? 'selected' : ''}>思考:保留</option>
       </select>`
      : '';
  row.innerHTML = `
    <label class="radio" title="设为当前使用">
      <input type="radio" name="active-${kind}" ${isActive ? 'checked' : ''} />
    </label>
    <input class="f-name" placeholder="名称（如：OpenAI）" value="${esc(p.name)}" />
    <input class="f-url" placeholder="Base URL（如：https://api.openai.com/v1）" value="${esc(p.baseUrl)}" />
    <input class="f-key" type="password" placeholder="API Key" value="${esc(p.apiKey)}" />
    <input class="f-model" placeholder="模型名（如：whisper-1 / gpt-4o）" value="${esc(p.model)}" />
    ${protoSelect}
    <button class="btn small validate">校验</button>
    <button class="btn small danger del">删除</button>
    <span class="validate-msg"></span>
  `;
  row.querySelector('.validate').addEventListener('click', async () => {
    const msg = row.querySelector('.validate-msg');
    msg.textContent = '校验中…';
    msg.className = 'validate-msg pending';
    const res = await window.v2p.validateModel(kind === 'vision' ? 'image-vision' : kind, collectRow(row));
    msg.textContent = res.ok ? '✅ 可正常调用' : `❌ ${res.error || '失败'}`;
    msg.className = 'validate-msg ' + (res.ok ? 'ok' : 'fail');
  });
  row.querySelector('.del').addEventListener('click', () => row.remove());
  row.querySelector(`input[type=radio]`).addEventListener('change', () => {
    document.querySelectorAll(`#asr-list .provider-row, #llm-list .provider-row, #vision-list .provider-row`)
      .forEach((r) => { if (r.closest('.provider-list').id === `${kind}-list`) r.classList.remove('active'); });
    row.classList.add('active');
  });
  return row;
}

function collectRow(row) {
  const proto = row.querySelector('.f-proto');
  const think = row.querySelector('.f-think');
  const noThinking = think ? (think.value === 'auto' ? undefined : think.value === 'on') : undefined;
  return {
    id: row.dataset.id,
    name: row.querySelector('.f-name').value.trim(),
    baseUrl: row.querySelector('.f-url').value.trim(),
    apiKey: row.querySelector('.f-key').value.trim(),
    model: row.querySelector('.f-model').value.trim(),
    ...(proto ? { asrProtocol: proto.value } : {}),
    ...(think ? { noThinking } : {})
  };
}

function collectList(kind) {
  const rows = [...document.querySelectorAll(`#${kind}-list .provider-row`)];
  const providers = rows.map(collectRow).filter((p) => p.baseUrl || p.apiKey || p.model);
  const activeRow = rows.find((r) => r.querySelector('input[type=radio]').checked);
  return { providers, activeId: activeRow ? activeRow.dataset.id : (providers[0]?.id || '') };
}

function renderList(kind, providers, activeId) {
  const box = $(`#${kind}-list`);
  box.innerHTML = '';
  if (!providers.length) {
    const tip = document.createElement('div');
    tip.className = 'empty-tip';
    tip.textContent = kind === 'asr'
      ? '还没有语音模型。添加一个 ASR 端点：OpenAI 兼容选 transcriptions 协议（OpenAI whisper、SiliconFlow、Groq 等）；小米 MiMo 选 chat 协议（模型名 mimo-v2.5-asr）。'
      : kind === 'vision'
        ? '还没有识图模型。添加任意 OpenAI 兼容的视觉端点（如小米 MiMo、Qwen-VL、GPT-4o）；它与文字模型独立，纯文本文字模型也可以正常识图。'
        : '还没有文字模型。添加任意 OpenAI 兼容的聊天端点（如 DeepSeek、OpenAI、小米 MiMo、Ollama 等）。';
    box.appendChild(tip);
  }
  providers.forEach((p) => box.appendChild(providerRow(kind, p, p.id === activeId)));
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

async function addProvider(kind, preset = {}) {
  const p = { id: Math.random().toString(36).slice(2, 10), name: '', baseUrl: '', apiKey: '', model: '', ...preset };
  $(`#${kind}-list`).querySelectorAll('.empty-tip').forEach((e) => e.remove());
  const row = providerRow(kind, p, false);
  $(`#${kind}-list`).appendChild(row);
  if (kind === 'vision' && $(`#${kind}-list`).querySelectorAll('.provider-row').length === 1) {
    row.querySelector('input[type=radio]').checked = true;
    row.classList.add('active');
  }
  return row;
}

async function loadPetPreview() {
  const { dataUrl } = await window.v2p.petImage();
  const img = $('#pet-preview');
  if (dataUrl) img.src = dataUrl;
  img.style.display = dataUrl ? '' : 'none';
}

async function renderPetModelSelect(current) {
  const { models } = await window.v2p.petModelList();
  const sel = $('#pet-model');
  sel.innerHTML = '';
  const opt = (v, t) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    if (v === current) o.selected = true;
    sel.appendChild(o);
  };
  models.forEach((m) => opt(m, m));
  // 配置里的模型已被删除时列表选不到，回退到静态图
  if (!models.includes(current)) sel.value = '';
}

// 画板里「✨ 生成皮肤」成功后主进程会广播，这里即时刷新下拉框（保住当前选择）
window.v2p.onModelListChanged(() => {
  renderPetModelSelect($('#pet-model').value);
});


// ---------------- 快捷键捕获（点击「录制」→ 按下组合键即完成） ----------------
// 修饰键（Ctrl/Alt/Shift/Win）单独按下不算完成，必须再按一个主键；
// Electron accelerator 命名：Control / Alt / Shift / Super + 主键
const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'CapsLock']);
const KEY_NAMES = {
  ' ': 'Space', 'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
  'Enter': 'Return', 'Escape': 'Esc', 'PageUp': 'PageUp', 'PageDown': 'PageDown',
  'Insert': 'Insert', 'Delete': 'Delete', 'Home': 'Home', 'End': 'End',
  'Tab': 'Tab', 'Backspace': 'Backspace', '+': 'Plus', '-': '-', '=': '=', ';': ';', "'": "'",
  ',': 'Comma', '.': 'Period', '/': 'Slash', '`': 'Backquote', '\\': 'Backslash', '[': '[', ']': ']'
};

let capturing = false;
let captureTarget = null;
let capturePrevHotkey = '';

function hotkeyFromEvent(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  let key = null;
  if (/^[a-z]$/i.test(e.key)) key = e.key.toUpperCase();
  else if (/^[0-9]$/.test(e.key)) key = e.key;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) key = e.key;
  else if (KEY_NAMES[e.key]) key = KEY_NAMES[e.key];
  if (!key || MODIFIER_KEYS.has(e.key)) return { partial: mods, key: null };
  return { partial: mods, key, combo: [...new Set([...mods]), key].join('+') };
}

function endHotkeyCapture() {
  if (!capturing) return;
  capturing = false;
  window.removeEventListener('keydown', onCaptureKeydown, true);
  const target = captureTarget;
  const button = document.querySelector(`.hotkey-capture[data-target="${target}"]`);
  if (button) button.textContent = '⏺ 录制快捷键';
  $(`#${target}-tip`).textContent = '';
  captureTarget = null;
  window.v2p.setHotkeyCapturing(false);   // 恢复全局热键
}

function onCaptureKeydown(e) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') { $(`#${captureTarget}`).value = capturePrevHotkey; endHotkeyCapture(); return; }
  const r = hotkeyFromEvent(e);
  if (!r.key) {
    $(`#${captureTarget}`).value = r.partial.length ? r.partial.join('+') + ' + …' : '按下快捷键…（Esc 取消）';
    return;
  }
  $(`#${captureTarget}`).value = r.combo;
  const target = captureTarget;
  $(`#${target}-tip`).textContent = '已捕获，点「保存设置」生效';
  setTimeout(() => ($(`#${target}-tip`).textContent = ''), 3000);
  endHotkeyCapture();
}

async function startHotkeyCapture(target) {
  if (capturing) return;
  capturing = true;
  captureTarget = target;
  capturePrevHotkey = $(`#${target}`).value;
  document.querySelector(`.hotkey-capture[data-target="${target}"]`).textContent = '⏺ 正在监听按键…';
  // 暂停全局热键：否则按下的组合键会同时触发录音
  await window.v2p.setHotkeyCapturing(true);
  if (!capturing) return;
  window.addEventListener('keydown', onCaptureKeydown, true);
}

window.addEventListener('beforeunload', endHotkeyCapture);

// ---------------- 桌宠形象:Live2D 皮肤 / 静态图片 ----------------
function applyPetKind(kind) {
  document.querySelectorAll('input[name=pet-kind]').forEach((r) => { r.checked = r.value === kind; });
  $('#live2d-row').style.display = kind === 'live2d' ? '' : 'none';
  $('#image-row').style.display = kind === 'image' ? '' : 'none';
}
function wirePetKindEvents() {
  document.querySelectorAll('input[name=pet-kind]').forEach((r) =>
    r.addEventListener('change', async () => {
      if (!r.checked) return;
      applyPetKind(r.value);
      if (r.value === 'live2d') {
        const sel = $('#pet-model');
        if (!sel.value) sel.value = sel.options[0] ? sel.options[0].value : 'keyboard';
        await window.v2p.saveConfig({ petModel: sel.value });
      } else {
        await window.v2p.saveConfig({ petModel: '' });
      }
      const tip = $('#save-tip');
      tip.textContent = '✅ 桌宠形象已切换';
      setTimeout(() => (tip.textContent = ''), 2000);
    }));
  // Live2D 下拉框选择后立即生效
  $('#pet-model').addEventListener('change', async (e) => {
    await window.v2p.saveConfig({ petModel: e.target.value });
    const tip = $('#save-tip');
    tip.textContent = '✅ 皮肤已切换';
    setTimeout(() => (tip.textContent = ''), 2000);
  });
}

async function loadConfig() {
  cfg = await window.v2p.getConfig();
  renderList('asr', cfg.asrProviders, cfg.activeAsrId);
  renderList('llm', cfg.llmProviders, cfg.activeLlmId);
  renderList('vision', cfg.visionProviders || [], cfg.activeVisionId || '');
  $('#hotkey').value = cfg.hotkey || '';
  $('#screenshot-hotkey').value = cfg.screenshotHotkey || 'Alt+A';
  $('#trigger-mode').value = cfg.triggerMode || 'hold';
  $('#insert-mode').checked = cfg.insertMode === 'paste';
  $('#undo-toast-seconds').value = cfg.undoToastSeconds ?? 10;
  $('#enable-structure').checked = !!cfg.enableStructure;
  $('#mouse-record').checked = cfg.mouseRecord === true;
  $('#enable-optimize').checked = !!cfg.enableOptimize;
  $('#preview-enabled').checked = !!cfg.previewEnabled;
  $('#structure-no-think').checked = cfg.structureDisableThinking !== false;
  $('#optimize-no-think').checked = cfg.optimizeDisableThinking !== false;
  $('#prompt-text').value = cfg.promptText || '';
  await renderPetModelSelect(cfg.petModel || '');
  applyPetKind((cfg.petModel || '') ? 'live2d' : 'image');
  await loadPetPreview();
}

function wireEvents() {
  $('#asr-add').addEventListener('click', () => addProvider('asr'));
  $('#llm-add').addEventListener('click', () => addProvider('llm'));
  $('#vision-add').addEventListener('click', () => addProvider('vision'));

  // 快捷键捕获：点击「录制」后进入捕获态，下一个组合键（含修饰键）即被记录；Esc 取消
  document.querySelectorAll('.hotkey-capture').forEach((button) =>
    button.addEventListener('click', () => startHotkeyCapture(button.dataset.target)));

  $('#pick-pet').addEventListener('click', async () => {
    const res = await window.v2p.pickPetImage();
    if (res.ok) await loadPetPreview();
  });

  $('#open-folder').addEventListener('click', () => window.v2p.openConfigFolder());

  $('#open-models-folder').addEventListener('click', () => window.v2p.openModelsFolder());

  $('#open-paint').addEventListener('click', () => window.v2p.openPaint());

  $('#mouse-record').addEventListener('change', async (e) => {
    await window.v2p.setMouseRecord(e.target.checked);
    const tip = $('#save-tip');
    tip.textContent = e.target.checked ? '✅ 侧键录音已开启' : '侧键录音已关闭';
    setTimeout(() => (tip.textContent = ''), 2000);
  });
  wirePetKindEvents();

  // 修改皮肤：按选中名字打开画板（该皮肤须由「创建皮肤」生成，才有涂装记录）
  $('#edit-skin').addEventListener('click', () => {
    const name = $('#pet-model').value;
    const tip = $('#save-tip');
    if (!name) { tip.textContent = '先在上面的下拉框选一个皮肤'; setTimeout(() => (tip.textContent = ''), 2500); return; }
    window.v2p.openPaint(name);
  });

  // 删除皮肤：两步确认；只删用户目录里的自建皮肤，当前用的被删则回退静态图
  let delArmAt = 0;
  $('#del-skin').addEventListener('click', async (e) => {
    const name = $('#pet-model').value;
    const tip = $('#save-tip');
    if (!name) { tip.textContent = '先选一个皮肤'; setTimeout(() => (tip.textContent = ''), 2500); return; }
    if (!delArmAt) {
      delArmAt = Date.now();
      e.target.textContent = '再点一次确认删除';
      setTimeout(() => { if (delArmAt) { e.target.textContent = '🗑 删除'; delArmAt = 0; } }, 3000);
      return;
    }
    delArmAt = 0;
    e.target.textContent = '🗑 删除';
    const r = await window.v2p.petModelDelete(name);
    tip.textContent = r.ok ? `✅ 已删除皮肤「${r.name}」` : `❌ ${r.error || '删除失败'}`;
    setTimeout(() => (tip.textContent = ''), 3000);
    await renderPetModelSelect(cfg.petModel || '');
  applyPetKind((cfg.petModel || '') ? 'live2d' : 'image');
  });

  $('#save').addEventListener('click', async () => {
    const asr = collectList('asr');
    const llm = collectList('llm');
    const vision = collectList('vision');
    const patch = {
      asrProviders: asr.providers.map((p) => ({ ...p, apiKey: b64encode(p.apiKey) })),
      llmProviders: llm.providers.map((p) => ({ ...p, apiKey: b64encode(p.apiKey) })),
      visionProviders: vision.providers.map((p) => ({ ...p, apiKey: b64encode(p.apiKey) })),
      activeAsrId: asr.activeId,
      activeLlmId: llm.activeId,
      activeVisionId: vision.activeId,
      hotkey: $('#hotkey').value.trim(),
      screenshotHotkey: $('#screenshot-hotkey').value.trim() || 'Alt+A',
      triggerMode: $('#trigger-mode').value,
      insertMode: $('#insert-mode').checked ? 'paste' : 'clipboard',
      undoToastSeconds: Number($('#undo-toast-seconds').value),
      enableStructure: $('#enable-structure').checked,
      enableOptimize: $('#enable-optimize').checked,
      previewEnabled: $('#preview-enabled').checked,
      structureDisableThinking: $('#structure-no-think').checked,
      optimizeDisableThinking: $('#optimize-no-think').checked,
      promptText: ensurePromptRedline($('#prompt-text').value),
      petModel: (document.querySelector('input[name=pet-kind]:checked') || {}).value === 'image' ? '' : $('#pet-model').value
    };
    const tip = $('#save-tip');
    try {
      const result = await window.v2p.saveConfig(patch);
      if (result && result.ok === false) throw new Error(result.error || '保存失败');
      tip.textContent = '✅ 已保存';
    } catch (error) {
      tip.textContent = `❌ ${error.message || '保存失败'}`;
    }
    setTimeout(() => (tip.textContent = ''), 2000);
  });
}

// 设置窗是单例：主进程在重开时会广播刷新，避免页面上停留旧配置
if (window.v2p.onSettingsRefresh) window.v2p.onSettingsRefresh(() => loadConfig());
wireEvents();
loadConfig();
