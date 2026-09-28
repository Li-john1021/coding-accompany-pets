// palette.js — 选中浮条：竖排极简，仅展示与点选，绝不自动调模型
const $ = (s) => document.querySelector(s);
const hint = $('#hint');
const status = $('#status');
const moreMenu = $('#more-menu');

function hideMenu() {
  moreMenu.style.display = 'none';
}

function showMenu() {
  moreMenu.style.display = 'block';
}

$('#btn-more').addEventListener('click', (e) => {
  e.stopPropagation();
  if (moreMenu.style.display === 'block') hideMenu();
  else showMenu();
});

function setBusy(busy, text, activeId) {
  for (const id of ['btn-optimize', 'btn-structure', 'btn-close', 'btn-more']) {
    const el = $('#' + id);
    if (!el) throw new Error('missing #' + id);
    el.disabled = busy;
    if (busy && id === activeId) {
      if (!el.dataset.html) el.dataset.html = el.innerHTML;
      const label = id === 'btn-structure' ? '结构化中' : '优化中';
      el.innerHTML = '<span class="spinner"></span><span class="dots">' + label + '</span>';
    } else if (!busy && el.dataset.html) {
      el.innerHTML = el.dataset.html;
      delete el.dataset.html;
    }
  }
  status.style.display = text ? 'block' : 'none';
  status.textContent = text || '';
}

async function runMode(mode) {
  const activeId = mode === 'structure' ? 'btn-structure' : 'btn-optimize';
  setBusy(true, mode === 'structure' ? '结构化处理中…' : '提示词优化中…', activeId);
  try {
    const res = await window.v2p.paletteRun(mode);
    if (res && res.ok) {
      setBusy(false, res.note || (res.degraded ? '已降级处理' : '完成'));
      setTimeout(() => window.v2p.paletteDismiss('done'), 700);
    } else {
      setBusy(false, (res && res.error) || '失败，未改动文本');
    }
  } catch (e) {
    setBusy(false, String(e.message || e).slice(0, 80));
  }
}

$('#btn-optimize').addEventListener('click', () => runMode('optimize'));
$('#btn-structure').addEventListener('click', () => runMode('structure'));
$('#btn-close').addEventListener('click', () => window.v2p.paletteDismiss('close'));

$('#btn-copy-raw').addEventListener('click', async () => {
  await window.v2p.paletteCopyRaw();
  setBusy(false, '已复制原文');
  hideMenu();
  setTimeout(() => window.v2p.paletteDismiss('copy'), 400);
});

$('#btn-open-app').addEventListener('click', () => {
  window.v2p.openSettings();
  window.v2p.paletteDismiss('open');
});

$('#btn-feedback').addEventListener('click', () => {
  setBusy(false, '感谢反馈：可在仓库 Issues 留言');
  hideMenu();
});

window.v2p.onPaletteShow((p) => {
  hint.style.display = p && p.long ? 'block' : 'none';
  hint.textContent = p && p.long ? '较长，建议进 App 处理' : '';
  setBusy(false, '');
  hideMenu();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.v2p.paletteDismiss('esc');
});
