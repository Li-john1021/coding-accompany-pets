// palette.js — 选中浮条：仅展示与点选，绝不自动调模型
const $ = (s) => document.querySelector(s);
const bar = $('#bar');
const hint = $('#hint');
const status = $('#status');
const moreMenu = $('#more-menu');

let lastPreview = '';

function hideMenu() {
  moreMenu.style.display = 'none';
}

function showMenu() {
  moreMenu.style.display = 'flex';
  moreMenu.style.gap = '6px';
  moreMenu.style.position = 'absolute';
  moreMenu.style.top = '100%';
  moreMenu.style.left = '8px';
  moreMenu.style.marginTop = '6px';
  moreMenu.style.padding = '6px';
  moreMenu.style.background = '#2c2e34';
  moreMenu.style.borderRadius = '8px';
  moreMenu.style.flexDirection = 'column';
  moreMenu.style.alignItems = 'stretch';
}

$('#btn-more').addEventListener('click', (e) => {
  e.stopPropagation();
  if (moreMenu.style.display === 'none' || !moreMenu.style.display) showMenu();
  else hideMenu();
});

function setBusy(busy, text) {
  for (const id of ['btn-optimize', 'btn-structure', 'btn-close', 'btn-more']) {
    const el = $(id);
    el.disabled = busy;
    if (!busy && el.dataset.html) {
      el.innerHTML = el.dataset.html;
      delete el.dataset.html;
    } else if (busy && !el.dataset.html && (id === 'btn-optimize' || id === 'btn-structure')) {
      el.dataset.html = el.innerHTML;
      el.innerHTML = '<span class="spinner"></span>处理中';
    }
  }
  status.style.display = text ? 'block' : 'none';
  status.textContent = text || '';
}

async function runMode(mode) {
  setBusy(true, '处理中…');
  try {
    const res = await window.v2p.paletteRun(mode);
    if (res && res.ok) {
      setBusy(false, res.note || (res.degraded ? '已降级处理' : '完成'));
      setTimeout(() => window.v2p.paletteDismiss('done'), 600);
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

// 主进程推送：show({ preview, long }) / reset
window.v2p.onPaletteShow((p) => {
  lastPreview = (p && p.preview) || '';
  hint.style.display = p && p.long ? 'block' : 'none';
  hint.textContent = p && p.long ? '较长，建议进 App 处理（仍可点上面按钮）' : '';
  setBusy(false, '');
  hideMenu();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.v2p.paletteDismiss('esc');
});
