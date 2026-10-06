// preview.js — 语音预览卡：默认不开启；用户点选处理方式后写入
const $ = (s) => document.querySelector(s);
const rawEl = $('#raw');
const statusEl = $('#status');

let mode = 'none';
let lastResult = '';

function setMode(m) {
  mode = m;
  for (const id of ['btn-none', 'btn-structure', 'btn-optimize']) $(id).style.outline = '';
  const map = { none: 'btn-none', structure: 'btn-structure', optimize: 'btn-optimize' };
  if (map[m]) $(map[m]).style.outline = '2px solid #4f7cff';
  statusEl.textContent = m === 'none' ? '将使用上方原文' : `将进行：${m === 'structure' ? '结构化整理' : '提示词优化'}`;
}

$('#btn-none').addEventListener('click', () => { lastResult = rawEl.value; setMode('none'); });
$('#btn-structure').addEventListener('click', async () => {
  statusEl.textContent = '处理中…';
  const r = await window.v2p.processText(rawEl.value, 'structure');
  lastResult = r.text;
  rawEl.value = r.text;
  setMode('structure');
  statusEl.textContent = r.note || '完成';
});
$('#btn-optimize').addEventListener('click', async () => {
  statusEl.textContent = '处理中…';
  const r = await window.v2p.processText(rawEl.value, 'optimize');
  lastResult = r.text;
  rawEl.value = r.text;
  setMode('optimize');
  statusEl.textContent = r.note || '完成';
});

async function finish(copyOnly) {
  const text = lastResult || rawEl.value;
  const res = await window.v2p.previewInsert({ text, copyOnly });
  window.v2p.previewClose({ ok: true, text, ...res });
}

$('#btn-insert').addEventListener('click', () => finish(false));
$('#btn-copy').addEventListener('click', () => finish(true));
$('#btn-cancel').addEventListener('click', () => window.v2p.previewClose({ ok: false, cancelled: true }));

window.v2p.onPreviewShow((p) => {
  rawEl.value = (p && p.raw) || '';
  lastResult = rawEl.value;
  document.body.classList.toggle('result-only', !!(p && p.resultOnly));
  if (p && p.resultOnly) {
    mode = p.mode === 'structure' || p.mode === 'optimize' ? p.mode : 'none';
    $('#btn-copy').textContent = '复制结果';
    $('#btn-cancel').textContent = '关闭';
    statusEl.textContent = '剪贴板未更新，请检查结果后显式复制';
    for (const id of ['btn-none', 'btn-structure', 'btn-optimize']) $(id).hidden = true;
    $('#btn-insert').hidden = true;
    return;
  }
  $('#btn-copy').textContent = '仅复制';
  $('#btn-cancel').textContent = '取消';
  for (const id of ['btn-none', 'btn-structure', 'btn-optimize']) $(id).hidden = false;
  $('#btn-insert').hidden = false;
  setMode('none');
});
