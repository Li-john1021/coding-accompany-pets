// paint.js — 创建皮肤：给零件上色 → 一键生成可用桌宠皮肤
//
// 设计要点（与 skin-forge 的 paint_common.py 判定完全对齐）：
//   三层画布：reference（灰底线稿，只读） / paint（你的上色层） / lineart（描边，压在顶上）
//   每一笔画先画到离屏 stroke 层，再用 paintable mask 做 destination-in 裁剪，
//   最后合成进 paint 层 —— 所以笔迹物理上不可能出现在零件边界或描边之外。
//   烘焙时还会再裁一次（bake_paint.py），双保险。
'use strict';

const $ = (s) => document.querySelector(s);
const board = $('#board');
const viewport = $('#viewport');
const cRef = $('#c-ref'), cPaint = $('#c-paint'), cLine = $('#c-line'), cCursor = $('#c-cursor');
const xRef = cRef.getContext('2d'), xLine = cLine.getContext('2d'), xCursor = cCursor.getContext('2d');
// 上色层要频繁 getImageData 做掩码裁剪与自检，开 willReadFrequently 避免每次读回警告/卡顿
const xPaint = cPaint.getContext('2d', { willReadFrequently: true });
// 离屏：当前笔触 + 可画区掩码 + 合成缓冲
const cStroke = document.createElement('canvas'), xStroke = cStroke.getContext('2d');
const cMask = document.createElement('canvas'), xMask = cMask.getContext('2d');
// 无缝模式的裁剪掩码:零件不透明足迹(含描边区)
const cMaskOp = document.createElement('canvas'), xMaskOp = cMaskOp.getContext('2d');

const state = {
  parts: [], byId: new Map(), cur: null, job: 'my-skin',
  tool: 'brush', color: '#e0902f', size: 18, opacity: 1, flow: 1,
  seamless: false,             // 无缝平涂:可覆盖描边、烘焙不加明暗——零件间无接缝
  optCircle: false,            // 生成时眼睛画成正圆
  zoom: 2, panX: 40, panY: 40, space: false,
  pages: new Map()               // texture_00.png 等原图，整页预览用
};

// 每个零件一份：上色层 canvas + 撤销/重做栈 + 是否已改
const layers = new Map();

const msg = (t) => { $('#st-msg').textContent = t; };

function loadImage(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';   // 必须，否则 canvas 被污染、取不到像素
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('加载失败 ' + src));
    im.src = src;
  });
}

function hexToRgba(hex, a = 1) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), a];
}

// ---------------- 初始化 ----------------
async function init() {
  const m = await window.v2p.paintManifest();
  if (!m.ok) { msg('读不到 paint_kit：' + m.error + '（先跑 tools/extract_lineart.py）'); return; }
  state.parts = m.parts;
  state.parts.forEach((p) => state.byId.set(p.id, p));
  for (const pg of (m.pages || [])) {
    try { state.pages.set(pg, await loadImage('kit://pages/' + pg)); } catch { /* 缺页忽略 */ }
  }
  renderPartList();
  await window.v2p.paintNewJob(state.job);   // 草稿目录（内部机制，UI 不暴露）
  // ?job=<皮肤名>：修改已生成的皮肤（每个生成皮肤都有一份同名涂装快照）
  const qJob = new URLSearchParams(location.search).get('job');
  if (qJob && qJob !== state.job) {
    state.job = qJob;
    await ensureJobPaintable(qJob);   // 老皮肤：从它自己的贴图反推涂装
    msg(`正在修改皮肤「${qJob}」的涂装，画完点「✨ 更新皮肤」覆盖它`);
  }
  updateGenerateLabel();
  await markSavedParts();
  await selectPart((state.parts.find((p) => p.kind === 'fur') || state.parts[0]).id);
}

function renderPartList() {
  const groups = [['角色', (p) => p.kind === 'fur' || p.kind === 'paw' || p.kind === 'eye'],
                  ['家具', (p) => p.kind === 'furniture'],
                  ['特效/杂项', (p) => p.kind === 'effect']];
  const box = $('#parts');
  box.innerHTML = '';
  for (const [title, pred] of groups) {
    const list = state.parts.filter(pred);
    if (!list.length) continue;
    const h = document.createElement('h3');
    h.textContent = title;
    box.appendChild(h);
    for (const p of list) {
      const el = document.createElement('div');
      el.className = 'part';
      el.dataset.id = p.id;
      el.innerHTML = `<img src="kit://${p.id}/reference.png" /><div>
          <div class="nm">${p.name_cn}</div>
          <div class="sub">${p.size[0]}×${p.size[1]} · 可画 ${p.paintable_pct}%</div>
        </div><span class="dot"></span>`;
      el.addEventListener('click', () => selectPart(p.id));
      box.appendChild(el);
    }
  }
}

// ---------------- 零件切换 ----------------
function getLayer(pid) {
  if (!layers.has(pid)) {
    const p = state.byId.get(pid);
    const cv = document.createElement('canvas');
    cv.width = p.size[0]; cv.height = p.size[1];
    layers.set(pid, { canvas: cv, ctx: cv.getContext('2d'), undo: [], redo: [], touched: false, loaded: false });
  }
  return layers.get(pid);
}

async function selectPart(pid) {
  if (state.cur === pid) return;
  if (state.cur) await saveCurrent();
  const p = state.byId.get(pid);
  state.cur = pid;

  // 三层尺寸统一到零件像素尺寸
  for (const cv of [cRef, cPaint, cLine, cCursor, cStroke, cMask]) { cv.width = p.size[0]; cv.height = p.size[1]; }
  board.style.width = p.size[0] + 'px';
  board.style.height = p.size[1] + 'px';

  const [ref, line, mask, src] = await Promise.all([
    loadImage(`kit://${pid}/reference.png`),
    loadImage(`kit://${pid}/lineart.png`),
    loadImage(`kit://${pid}/paintable.png`),
    loadImage(`kit://${pid}/source.png`)
  ]);
  xRef.clearRect(0, 0, p.size[0], p.size[1]); xRef.drawImage(ref, 0, 0);
  xLine.clearRect(0, 0, p.size[0], p.size[1]); xLine.drawImage(line, 0, 0);
  xMask.clearRect(0, 0, p.size[0], p.size[1]); xMask.drawImage(mask, 0, 0);
  state.maskData = xMask.getImageData(0, 0, p.size[0], p.size[1]);
  // 不透明足迹掩码(alpha>=20,与 paint_common.ALPHA_MIN 一致)
  for (const cv of [cMaskOp]) { cv.width = p.size[0]; cv.height = p.size[1]; }
  const opData = xMaskOp.createImageData(p.size[0], p.size[1]);
  xMaskOp.clearRect(0, 0, p.size[0], p.size[1]);
  xMaskOp.drawImage(src, 0, 0);
  const sd = xMaskOp.getImageData(0, 0, p.size[0], p.size[1]);
  for (let i = 0; i < p.size[0] * p.size[1]; i++) opData.data[i * 4 + 3] = sd.data[i * 4 + 3] >= 20 ? 255 : 0;
  xMaskOp.putImageData(opData, 0, 0);

  const L = getLayer(pid);
  // 首次选中该零件时从磁盘载入已保存的涂装。之前不载入：画板显示空白看不到
  // 原皮肤的画，而烘焙又会把磁盘旧图混进去——显示与结果对不上
  if (!L.loaded) {
    const r = await window.v2p.paintLoadPart(state.job, pid);
    if (r.dataUrl) {
      const im = await loadImage(r.dataUrl);
      L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
      L.ctx.drawImage(im, 0, 0);
    }
    L.loaded = true;
  }
  xPaint.clearRect(0, 0, p.size[0], p.size[1]);
  xPaint.drawImage(L.canvas, 0, 0);

  document.querySelectorAll('.part').forEach((e) => e.classList.toggle('on', e.dataset.id === pid));
  $('#st-part').textContent = `${p.name_cn} (${pid})`;
  $('#st-paint').textContent = p.paintable_pct + '%';
  if (!state.zoomFitDone) { fitView(); state.zoomFitDone = true; }
  updateTransform();
  refreshUndoButtons();
}

function fitView() {
  const p = state.byId.get(state.cur);
  const avail = [viewport.clientWidth - 60, viewport.clientHeight - 60];
  state.zoom = Math.max(1, Math.min(8, Math.min(avail[0] / p.size[0], avail[1] / p.size[1])));
  state.panX = (viewport.clientWidth - p.size[0] * state.zoom) / 2;
  state.panY = (viewport.clientHeight - p.size[1] * state.zoom) / 2;
}

function updateTransform() {
  board.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  $('#st-zoom').textContent = Math.round(state.zoom * 100) + '%';
}

// ---------------- 绘制 ----------------
function localPos(e) {
  const r = board.getBoundingClientRect();
  return [(e.clientX - r.left) / state.zoom, (e.clientY - r.top) / state.zoom];
}

let drawing = false, last = null, strokeBox = null;

function brushStamp(ctx, x, y, soft) {
  const r = state.size / 2;
  if (!soft) {
    ctx.fillStyle = state.color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    return;
  }
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  const [R, G, B] = hexToRgba(state.color);
  g.addColorStop(0, `rgba(${R},${G},${B},${state.flow})`);
  g.addColorStop(0.6, `rgba(${R},${G},${B},${state.flow * 0.55})`);
  g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
}

function strokeLine(ctx, a, b, soft) {
  if (soft) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let i = 0; i <= n; i++) {
      brushStamp(ctx, a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n, true);
    }
    return;
  }
  ctx.strokeStyle = state.color;
  ctx.globalAlpha = state.flow;
  ctx.lineWidth = state.size;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  ctx.globalAlpha = 1;
}

function growBox(pt) {
  const r = state.size / 2 + 2;
  strokeBox[0] = Math.min(strokeBox[0], pt[0] - r); strokeBox[1] = Math.min(strokeBox[1], pt[1] - r);
  strokeBox[2] = Math.max(strokeBox[2], pt[0] + r); strokeBox[3] = Math.max(strokeBox[3], pt[1] + r);
}

// 当前生效的裁剪掩码:普通=可画区(描边锁定);无缝=整个不透明足迹
function maskCanvas() { return state.seamless ? cMaskOp : cMask; }
function maskData() { return state.seamless ? xMaskOp.getImageData(0, 0, cMaskOp.width, cMaskOp.height) : state.maskData; }

function beginStroke(pt) {
  xStroke.clearRect(0, 0, cStroke.width, cStroke.height);
  strokeBox = [cStroke.width, cStroke.height, 0, 0];
  growBox(pt);            // 起点必须纳入包围盒，否则短笔会算出负宽高
  drawing = true; last = pt;
}

function extendStroke(pt) {
  strokeLine(xStroke, last, pt, state.tool === 'soft');
  last = pt;
  growBox(pt);
}

function endStroke() {
  drawing = false;
  if (!strokeBox) return;
  // 钉到画布内：笔触常常探出零件边界，不减钉会把负尺寸传给 drawImage
  const x0 = Math.max(0, Math.floor(strokeBox[0]));
  const y0 = Math.max(0, Math.floor(strokeBox[1]));
  const x1 = Math.min(cStroke.width, Math.ceil(strokeBox[2]));
  const y1 = Math.min(cStroke.height, Math.ceil(strokeBox[3]));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  pushUndo();
  // 关键裁剪：笔触 ∩ 可画区，越界部分被削掉
  xStroke.save();
  xStroke.globalCompositeOperation = 'destination-in';
  xStroke.drawImage(maskCanvas(), x0, y0, w, h, x0, y0, w, h);
  xStroke.restore();
  xPaint.globalAlpha = state.opacity;
  xPaint.drawImage(cStroke, x0, y0, w, h, x0, y0, w, h);   // 传 canvas，不是 context
  xPaint.globalAlpha = 1;
  xStroke.clearRect(0, 0, cStroke.width, cStroke.height);
  markTouched();
  schedulePreview();
}

function erase(pt, prev) {
  pushUndoIfNeeded();
  xPaint.save();
  xPaint.globalCompositeOperation = 'destination-out';
  xPaint.strokeStyle = xPaint.fillStyle = '#000';
  xPaint.lineWidth = state.size; xPaint.lineCap = xPaint.lineJoin = 'round';
  xPaint.beginPath(); xPaint.moveTo(prev[0], prev[1]); xPaint.lineTo(pt[0], pt[1]); xPaint.stroke();
  xPaint.restore();
  markTouched();
}

// 一次笔画只推一次快照
let strokePushed = false;
function pushUndoIfNeeded() {
  if (!strokePushed) { pushUndo(); strokePushed = true; }
}

viewport.addEventListener('pointerdown', async (e) => {
  if (e.button === 1 || state.space) { startPan(e); return; }
  if (e.button !== 0) return;
  const pt = localPos(e);
  viewport.setPointerCapture(e.pointerId);
  if (state.tool === 'fill') { pushUndo(); floodFill(pt); markTouched(); schedulePreview(); return; }
  if (state.tool === 'pick') { pickColor(pt); return; }
  strokePushed = false;
  if (state.tool === 'eraser') {
    pushUndo(); strokePushed = true; erase(pt, pt); last = pt; drawing = true; return;
  }
  beginStroke(pt);
  brushStamp(xStroke, pt[0], pt[1], state.tool === 'soft');
});

viewport.addEventListener('pointermove', (e) => {
  const pt = localPos(e);
  drawCursor(pt);
  if (panning) { doPan(e); return; }
  if (!drawing) return;
  if (state.tool === 'eraser') erase(pt, last);
  else extendStroke(pt);
});

viewport.addEventListener('pointerup', (e) => {
  if (panning) { endPan(); return; }
  if (!drawing) return;
  if (state.tool === 'eraser') { drawing = false; strokePushed = false; schedulePreview(); }
  else endStroke();
  strokePushed = false;
});

function drawCursor(pt) {
  xCursor.clearRect(0, 0, cCursor.width, cCursor.height);
  xCursor.strokeStyle = state.tool === 'eraser' ? '#ff5b5b' : '#ffffff';
  xCursor.lineWidth = 1 / state.zoom;
  xCursor.beginPath(); xCursor.arc(pt[0], pt[1], state.size / 2, 0, 6.2832); xCursor.stroke();
}

// ---------------- 油漆桶（沿描边围合区填充） ----------------
function floodFill([sx, sy]) {
  const p = state.byId.get(state.cur);
  const W = p.size[0], H = p.size[1];
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
  const line = xLine.getImageData(0, 0, W, H).data;
  const mask = maskData().data;
  const start = sy * W + sx;
  if (!mask[start * 4 + 3]) { msg('这里不可填充（在描边或边界外）'); return; }

  const wall = (i) => !state.seamless && line[i * 4 + 3] > 40 || !mask[i * 4 + 3];
  const seen = new Uint8Array(W * H);
  const out = xPaint.getImageData(0, 0, W, H);
  const [R, G, B, A] = hexToRgba(state.color, state.opacity);
  const stack = [start];
  seen[start] = 1;
  let n = 0;
  while (stack.length) {
    const i = stack.pop();
    const x = i % W, y = (i / W) | 0;
    const o = i * 4;
    out.data[o] = R; out.data[o + 1] = G; out.data[o + 2] = B; out.data[o + 3] = A * 255;
    n++;
    if (x > 0 && !seen[i - 1] && !wall(i - 1)) { seen[i - 1] = 1; stack.push(i - 1); }
    if (x < W - 1 && !seen[i + 1] && !wall(i + 1)) { seen[i + 1] = 1; stack.push(i + 1); }
    if (y > 0 && !seen[i - W] && !wall(i - W)) { seen[i - W] = 1; stack.push(i - W); }
    if (y < H - 1 && !seen[i + W] && !wall(i + W)) { seen[i + W] = 1; stack.push(i + W); }
  }
  if (!n) { msg('填充区为空'); return; }
  xPaint.putImageData(out, 0, 0);
  msg(`填充 ${n} px`);
}

function pickColor(pt) {
  const p = state.byId.get(state.cur);
  const x = Math.floor(pt[0]), y = Math.floor(pt[1]);
  if (x < 0 || y < 0 || x >= p.size[0] || y >= p.size[1]) return;
  const tmp = document.createElement('canvas');
  tmp.width = p.size[0]; tmp.height = p.size[1];
  const tt = tmp.getContext('2d');
  tt.drawImage(cRef, 0, 0); tt.drawImage(cPaint, 0, 0); tt.drawImage(cLine, 0, 0);
  const d = tt.getImageData(x, y, 1, 1).data;
  if (d[3] < 10) { msg('这里透明，无可取色'); return; }
  const hex = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
  state.color = hex; $('#color').value = hex;
  pushRecent(hex);
  msg('取色 ' + hex);
}

// ---------------- 撤销 / 重做 ----------------
const UNDO_MAX = 25;
function pushUndo() {
  const L = layers.get(state.cur) || getLayer(state.cur);
  const p = state.byId.get(state.cur);
  L.undo.push(xPaint.getImageData(0, 0, p.size[0], p.size[1]));
  if (L.undo.length > UNDO_MAX) L.undo.shift();
  L.redo.length = 0;
  refreshUndoButtons();
}

function restore(img) {
  xPaint.putImageData(img, 0, 0);
  const L = layers.get(state.cur);
  L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
  L.ctx.drawImage(cPaint, 0, 0);
  markTouched();
  schedulePreview();
}

$('#undo').addEventListener('click', () => {
  const L = layers.get(state.cur);
  if (!L || !L.undo.length) return;
  const p = state.byId.get(state.cur);
  L.redo.push(xPaint.getImageData(0, 0, p.size[0], p.size[1]));
  restore(L.undo.pop());
  refreshUndoButtons();
});

$('#redo').addEventListener('click', () => {
  const L = layers.get(state.cur);
  if (!L || !L.redo.length) return;
  const p = state.byId.get(state.cur);
  L.undo.push(xPaint.getImageData(0, 0, p.size[0], p.size[1]));
  restore(L.redo.pop());
  refreshUndoButtons();
});

function refreshUndoButtons() {
  const L = layers.get(state.cur);
  $('#undo').disabled = !L || !L.undo.length;
  $('#redo').disabled = !L || !L.redo.length;
}

$('#clear').addEventListener('click', () => {
  const p = state.byId.get(state.cur);
  pushUndo();
  xPaint.clearRect(0, 0, p.size[0], p.size[1]);
  markTouched(); schedulePreview();
  msg('已清空上色层');
});

$('#prefill').addEventListener('click', () => {
  const p = state.byId.get(state.cur);
  pushUndo();
  const tmp = document.createElement('canvas');
  tmp.width = p.size[0]; tmp.height = p.size[1];
  const tt = tmp.getContext('2d');
  tt.fillStyle = state.color;
  tt.globalAlpha = state.opacity;
  tt.fillRect(0, 0, p.size[0], p.size[1]);
  tt.globalCompositeOperation = 'destination-in';
  tt.drawImage(maskCanvas(), 0, 0);
  xPaint.drawImage(tmp, 0, 0);
  markTouched(); schedulePreview();
  msg('已用 ' + state.color + ' 铺底');
});

function markTouched() {
  const L = layers.get(state.cur);
  L.touched = true;
  L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
  L.ctx.drawImage(cPaint, 0, 0);
  const el = document.querySelector(`.part[data-id="${state.cur}"]`);
  if (el) el.classList.add('dirty');
}

// ---------------- 平移 / 缩放 ----------------
let panning = false, panLast = null;
function startPan(e) { panning = true; panLast = [e.clientX, e.clientY]; viewport.classList.add('pan'); }
function doPan(e) {
  state.panX += e.clientX - panLast[0]; state.panY += e.clientY - panLast[1];
  panLast = [e.clientX, e.clientY];
  updateTransform();
}
function endPan() { panning = false; viewport.classList.remove('pan'); }

viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  const before = localPos(e);
  state.zoom = Math.max(0.2, Math.min(24, state.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  const r = board.getBoundingClientRect();
  state.panX += e.clientX - (r.left + before[0] * state.zoom);
  state.panY += e.clientY - (r.top + before[1] * state.zoom);
  updateTransform();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !state.space) { state.space = true; viewport.classList.add('pan'); }
  if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); $('#undo').click(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); $('#redo').click(); }
  if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(true); }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === 'b') setTool('brush'); if (k === 'v') setTool('soft');
  if (k === 'e') setTool('eraser'); if (k === 'g') setTool('fill'); if (k === 'i') setTool('pick');
  if (k === 'f') { fitView(); updateTransform(); }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { state.space = false; if (!panning) viewport.classList.remove('pan'); }
});

// ---------------- 老皮肤涂装反推：从成品贴图提取上色层 ----------------
// 没有涂装快照的皮肤（快照机制前生成的），编辑时从它自己的贴图页反推：
// 烘焙时做过 明暗调制 shade=0.75+0.25*lum，这里做逆运算 art=baked/shade，
// 再按 paintable 掩码裁剪——提取的是"这层皮自己的画"，不是别的皮肤的替身。
// 重烘焙后 shade 再乘回来，数值上收敛（±1/255舍入），反复编辑不会越来越偏。
async function ensureJobPaintable(job) {
  const parts = ((await window.v2p.paintJobParts(job)).parts) || [];
  if (parts.length) return;                     // 已有涂装记录
  if (!window.v2p.petModelTextureBase) return;  // 旧宿主无反推接口，保持草稿
  const base = await window.v2p.petModelTextureBase(job);
  if (!base.ok) return;                          // 连皮肤都没有：保持草稿
  await window.v2p.paintNewJob(job);
  msg(`正在从皮肤「${job}」提取涂装…`);
  const pageCache = new Map();
  const pageOf = async (nm) => {
    if (!pageCache.has(nm)) pageCache.set(nm, await loadImage(`${base.base}/${nm}`));
    return pageCache.get(nm);
  };
  for (const p of state.parts) {
    const W = p.size[0], H = p.size[1];
    const tt = document.createElement('canvas');
    tt.width = W; tt.height = H;
    const x = tt.getContext('2d', { willReadFrequently: true });
    const page = await pageOf(p.page);
    x.drawImage(page, -p.bbox[0], -p.bbox[1]);
    const baked = x.getImageData(0, 0, W, H).data;
    x.clearRect(0, 0, W, H);
    x.drawImage(await loadImage(`kit://${p.id}/source.png`), 0, 0);
    const src = x.getImageData(0, 0, W, H).data;
    x.clearRect(0, 0, W, H);
    x.drawImage(await loadImage(`kit://${p.id}/paintable.png`), 0, 0);
    const msk = x.getImageData(0, 0, W, H).data;
    const out = x.createImageData(W, H);
    let n = 0;
    for (let i = 0; i < W * H; i++) {
      if (msk[i * 4 + 3] < 128 || baked[i * 4 + 3] <= 8) continue;
      const lum = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
      const shade = state.seamless ? 1 : 0.75 + 0.25 * (lum / 255);
      out.data[i * 4]     = Math.min(255, baked[i * 4] / shade);
      out.data[i * 4 + 1] = Math.min(255, baked[i * 4 + 1] / shade);
      out.data[i * 4 + 2] = Math.min(255, baked[i * 4 + 2] / shade);
      out.data[i * 4 + 3] = 255;
      n++;
    }
    if (!n) continue;
    x.putImageData(out, 0, 0);
    await window.v2p.paintSavePart(job, p.id, tt.toDataURL('image/png'));
  }
  document.querySelectorAll('.part.saved').forEach((e) => e.classList.remove('saved'));
  await markSavedParts();
  msg(`已从皮肤「${job}」提取涂装`);
}

// ---------------- 最近使用颜色（localStorage 持久化，重开画板也在） ----------------
const RECENT_KEY = 'v2p-recent-colors';
let recentColors = [];
try { recentColors = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { recentColors = []; }

function renderRecent() {
  const box = $('#recent');
  box.innerHTML = '';
  for (const c of recentColors) {
    const sp = document.createElement('span');
    sp.className = 'swatch';
    sp.style.background = c;
    sp.title = c;
    sp.addEventListener('click', () => { state.color = c; $('#color').value = c; });
    box.appendChild(sp);
  }
}
function pushRecent(hex) {
  recentColors = [hex, ...recentColors.filter((c) => c !== hex)].slice(0, 14);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentColors)); } catch { /* 隐私模式等忽略 */ }
  renderRecent();
}

// ---------------- 工具栏 ----------------
function setTool(t) {
  state.tool = t;
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
}
document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

// 无缝平涂开关
$('#seamless').addEventListener('click', () => {
  state.seamless = !state.seamless;
  $('#seamless').classList.toggle('on', state.seamless);
  try { localStorage.setItem('v2p-seamless', state.seamless ? '1' : '0'); } catch { }
  msg(state.seamless ? '无缝平涂:可以涂掉描边,零件拼接无接缝;烘焙为纯平色'
                     : '普通模式:描边锁定(防画散架),保留原明暗');
});
try { if (localStorage.getItem('v2p-seamless') === '1') { state.seamless = true; $('#seamless').classList.add('on'); } } catch { }
$('#size').addEventListener('input', (e) => { state.size = +e.target.value; $('#size-v').textContent = e.target.value; });
$('#opacity').addEventListener('input', (e) => { state.opacity = +e.target.value / 100; });
$('#flow').addEventListener('input', (e) => { state.flow = +e.target.value / 100; });
$('#color').addEventListener('input', (e) => { state.color = e.target.value; });
$('#color').addEventListener('change', (e) => pushRecent(e.target.value));
document.querySelectorAll('.swatch[data-c]').forEach((s) => s.addEventListener('click', () => {
  state.color = s.dataset.c; $('#color').value = s.dataset.c;
  pushRecent(s.dataset.c);
}));
renderRecent();

async function loadPartIntoLayer(pid, L) {
  const r = await window.v2p.paintLoadPart(state.job, pid);
  if (!r.dataUrl) return;
  const im = await loadImage(r.dataUrl);
  L.ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
  L.ctx.drawImage(im, 0, 0);
  if (pid === state.cur) {
    xPaint.clearRect(0, 0, cPaint.width, cPaint.height);
    xPaint.drawImage(L.canvas, 0, 0);
    schedulePreview();
  }
}

async function saveCurrent(force) {
  if (!state.cur) return;
  const L = layers.get(state.cur);
  if (!L || (!L.touched && !force)) return;
  const r = await window.v2p.paintSavePart(state.job, state.cur, L.canvas.toDataURL('image/png'));
  if (r.ok) { L.touched = false; msg('已保存 ' + state.cur + ' → ' + state.job); }
  else msg('保存失败：' + (r.error || '未知'));
}

$('#save').addEventListener('click', saveAllTouched);

async function saveAllTouched() {
  // 保存全部已改零件，不只当前这一个
  for (const [pid, L] of layers) {
    if (!L.touched) continue;
    const keep = state.cur; state.cur = pid;
    await saveCurrent(true);
    state.cur = keep;
  }
  await markSavedParts();
  msg('草稿已保存，随时回来继续画');
}

// 标记磁盘上已有涂装的零件（蓝点），让"原皮肤的画"看得见
async function markSavedParts() {
  let parts = [];
  try { parts = ((await window.v2p.paintJobParts(state.job)).parts) || []; } catch { return; }
  for (const pid of parts) {
    if (pid.includes('_selftest')) continue;
    const el = document.querySelector(`.part[data-id="${pid}"]`);
    if (el) el.classList.add('saved');
  }
}

// ---------------- 整页预览（模拟 bake 结果） ----------------
let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 120);
}

async function renderPreview() {
  const cv = $('#page-prev');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  // 只叠当前零件所属那一页（三页叠在一起会糊成一团）
  const cur = state.byId.get(state.cur);
  const pageName = cur ? cur.page : 'texture_00.png';
  const pg = state.pages.get(pageName);
  if (pg) ctx.drawImage(pg, 0, 0);
  for (const [pid, L] of layers) {
    const p = state.byId.get(pid);
    if (!p || !L || p.page !== pageName || !L.canvas.width) continue;
    if (pid === state.cur) { ctx.drawImage(cPaint, p.bbox[0], p.bbox[1]); continue; }
    ctx.drawImage(L.canvas, p.bbox[0], p.bbox[1]);
  }
}


// ---------------- ✨ 生成皮肤：渲染层烘焙 + 主进程落盘 ----------------
// 规则与 skin-forge/tools/bake_paint.py 完全同源：
//   可画区 = kit 预生成的 paintable 掩码（画板用同一张，画板让你画的地方才会被写入）
//   明暗调制 shade = 0.75 + 0.25*lum，保留白毛柔和阴影避免"死色块"
//   alpha 逐位不动 —— 零件边界/骨架足迹绝不被改，生成前逐页校验
async function bakeSkin(name, optCircle) {
  msg('正在生成皮肤…');
  await saveAllTouched();

  // 参与烘焙的零件 = 内存里的层 ∪ 磁盘草稿（含历史会话画的）
  const disk = ((await window.v2p.paintJobParts(state.job)).parts) || [];
  const pids = [...new Set([...layers.keys(), ...disk])];
  const pageW = $('#page-prev').width, pageH = $('#page-prev').height;
  const pages = new Map();                       // page -> {cv, ctx}
  const pageOf = (nm) => {
    if (!pages.has(nm)) {
      const cv = document.createElement('canvas');
      cv.width = pageW; cv.height = pageH;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(state.pages.get(nm), 0, 0);  // 基座整页打底
      pages.set(nm, { cv, ctx });
    }
    return pages.get(nm);
  };

  let count = 0;
  for (const pid of pids) {
    const p = state.byId.get(pid);
    if (!p) continue;                            // 自检产物等不在清单里的跳过
    const tmp = document.createElement('canvas');
    tmp.width = p.size[0]; tmp.height = p.size[1];
    const tt = tmp.getContext('2d', { willReadFrequently: true });

    // 上色层：优先内存，其次磁盘
    let art = null;
    const L = layers.get(pid);
    if (L && L.canvas.width) art = L.ctx.getImageData(0, 0, p.size[0], p.size[1]).data;
    if (!art) {
      const r = await window.v2p.paintLoadPart(state.job, pid);
      if (!r.dataUrl) continue;
      tt.drawImage(await loadImage(r.dataUrl), 0, 0);
      art = tt.getImageData(0, 0, p.size[0], p.size[1]).data;
    }
    let painted = 0;
    for (let i = 3; i < art.length; i += 4) if (art[i] > 8) { painted = 1; break; }
    if (!painted) continue;

    // 零件原图（取明暗/足迹）与可画区掩码;无缝模式足迹即可写区、且不加明暗
    tt.clearRect(0, 0, tmp.width, tmp.height);
    tt.drawImage(await loadImage(`kit://${pid}/source.png`), 0, 0);
    const src = tt.getImageData(0, 0, p.size[0], p.size[1]).data;
    let msk;
    if (state.seamless) {
      msk = tt.createImageData(p.size[0], p.size[1]);
      for (let i = 0; i < p.size[0] * p.size[1]; i++) msk.data[i * 4 + 3] = src[i * 4 + 3] >= 20 ? 255 : 0;
    } else {
      tt.clearRect(0, 0, tmp.width, tmp.height);
      tt.drawImage(await loadImage(`kit://${pid}/paintable.png`), 0, 0);
      msk = tt.getImageData(0, 0, p.size[0], p.size[1]).data;
    }

    // 正圆眼睛:以足迹等效半径画主色正圆+高光,裁在原足迹内(网格安全)
    if (optCircle && p.kind === 'eye') {
      const W = p.size[0], H = p.size[1];
      let n = 0, sx = 0, sy = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (src[(y * W + x) * 4 + 3] >= 20) { n++; sx += x; sy += y; }
      }
      if (n > 16) {
        const cx = sx / n, cy = sy / n, r = Math.sqrt(n / Math.PI);
        const buckets = new Map();
        for (let i = 0; i < W * H; i++) {
          if (art[i * 4 + 3] <= 128) continue;
          const key = ((art[i * 4] >> 4) << 8) | ((art[i * 4 + 1] >> 4) << 4) | (art[i * 4 + 2] >> 4);
          const b = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
          b.n++; b.r += art[i * 4]; b.g += art[i * 4 + 1]; b.b += art[i * 4 + 2];
          buckets.set(key, b);
        }
        let best = null;
        for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
        if (best) {
          const col = [best.r / best.n, best.g / best.n, best.b / best.n];
          const hx = cx - r * 0.32, hy = cy - r * 0.34, hr = r * 0.26;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
            if (d2 > r * r) continue;
            const o = (y * W + x) * 4;
            const hd2 = (x - hx) * (x - hx) + (y - hy) * (y - hy);
            if (hd2 <= hr * hr) { art[o] = 255; art[o + 1] = 255; art[o + 2] = 255; }
            else { art[o] = col[0]; art[o + 1] = col[1]; art[o + 2] = col[2]; }
            art[o + 3] = 255;
          }
        }
      }
    }

    const pg = pageOf(p.page);
    const px = pg.ctx.getImageData(p.bbox[0], p.bbox[1], p.size[0], p.size[1]);
    const W = p.size[0], H = p.size[1];
    for (let i = 0; i < W * H; i++) {
      if (msk[i * 4 + 3] < 128 || art[i * 4 + 3] <= 8) continue;   // 越界双保险
      const lum = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
      const shade = state.seamless ? 1 : 0.75 + 0.25 * (lum / 255);
      const a = art[i * 4 + 3] / 255;
      for (let ch = 0; ch < 3; ch++) {
        px.data[i * 4 + ch] = px.data[i * 4 + ch] * (1 - a) + (art[i * 4 + ch] * shade) * a;
      }
      // alpha 故意不写：边界是骨架的足迹
    }
    pg.ctx.putImageData(px, p.bbox[0], p.bbox[1]);
    count++;
    msg(`正在生成皮肤… 已烘焙 ${count} 个零件`);
  }
  if (!count) { msg('还没有画任何内容：左边挑个零件，或者直接「底色预填」'); return; }
  if (!window.v2p.paintCreateSkin) { msg('宿主版本过旧，请重启应用后再生成'); return; }

  // alpha 逐位校验，并导出改动页
  const out = {};
  for (const [nm, pg] of pages) {
    const comp = pg.ctx.getImageData(0, 0, pageW, pageH);
    const bt = document.createElement('canvas');
    bt.width = pageW; bt.height = pageH;
    const bx = bt.getContext('2d', { willReadFrequently: true });
    bx.drawImage(state.pages.get(nm), 0, 0);
    const base = bx.getImageData(0, 0, pageW, pageH).data;
    let diff = 0;
    for (let i = 3; i < comp.data.length; i += 4) if (comp.data[i] !== base[i]) diff++;
    if (diff) { msg(`校验失败：${nm} 的 alpha 被改动了 ${diff} px，已中止（不会写出坏皮肤）`); return; }
    out[nm] = pg.cv.toDataURL('image/png');
  }

  const r = await window.v2p.paintCreateSkin({ job: state.job, name, pages: out });
  if (!r.ok) { msg('生成失败：' + (r.error || '未知')); return; }
  state.job = r.name;            // 生成后进入该皮肤的涂装上下文，再画再更新就是它
  updateGenerateLabel();
  layers.clear();                // 内存层还挂着旧作品的笔迹，重载新上下文
  {
    const L = getLayer(state.cur);
    await loadPartIntoLayer(state.cur, L);
  }
  msg(`✅ 皮肤「${r.name}」已${r.updated ? '更新' : '创建'}（${count} 个零件、${r.pages} 页贴图）`
    + (r.backedUp ? '，原贴图已备份到作品目录' : '') + '，去 设置 → 桌宠皮肤 选择即可');
}

// 起名弹窗（Electron 不支持 window.prompt，必须用页内弹窗）
const modal = $('#modal');
function openModal() {
  $('#skin-name').value = '';
  modal.classList.add('show');
  $('#skin-name').focus();
}
function closeModal() { modal.classList.remove('show'); }

// 主进程通知切换涂装上下文（画板窗口是单例，点「修改皮肤」时窗口可能已开着）
if (window.v2p.onPaintSwitchJob) window.v2p.onPaintSwitchJob(async (job) => {
  if (!job || job === state.job) return;
  await saveAllTouched();            // 当前上下文的笔迹先落盘，不丢
  state.job = job;
  await ensureJobPaintable(job);     // 老皮肤：从它自己的贴图反推涂装
  layers.clear();                    // 关键：旧作品的上色层全部清掉，防止串味
  const L = getLayer(state.cur);
  await loadPartIntoLayer(state.cur, L);
  updateGenerateLabel();
  document.querySelectorAll('.part.saved').forEach((e) => e.classList.remove('saved'));
  await markSavedParts();
  msg(job !== 'my-skin' ? `正在修改皮肤「${job}」的涂装，画完点「✨ 更新皮肤」覆盖它`
                        : '新皮肤模式：画完点「✨ 生成皮肤」');
});

function updateGenerateLabel() {
  $('#generate').textContent = state.job === 'my-skin' ? '✨ 生成皮肤' : `✨ 更新皮肤「${state.job}」`;
}
function updateGenerateLabel() {
  $('#generate').textContent = state.job === 'my-skin' ? '✨ 生成皮肤' : `✨ 更新皮肤「${state.job}」`;
}
$('#generate').addEventListener('click', () => {
  try { $('#opt-circle').checked = localStorage.getItem('v2p-opt-circle') === '1'; } catch { }
  openModal();
});
$('#skin-cancel').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
$('#skin-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#skin-ok').click();
  if (e.key === 'Escape') closeModal();
  e.stopPropagation();
});
$('#skin-ok').addEventListener('click', async () => {
  const name = $('#skin-name').value.trim();
  if (!name) { $('#skin-name').focus(); return; }
  const optCircle = $('#opt-circle').checked;
  try { localStorage.setItem('v2p-opt-circle', optCircle ? '1' : '0'); } catch { }
  closeModal();
  await bakeSkin(name, optCircle);
});

console.log('[paint] boot');
init()
  .then(() => console.log('[paint] ready, parts=' + state.parts.length + ' pages=' + state.pages.size))
  .then(() => { if (location.search.includes('selftest')) return selfTest(); })
  .catch((e) => { console.error('[paint] init fail: ' + (e && e.stack || e)); msg('初始化失败：' + e.message); });

// 自检：故意往边界外乱画，验证导出的上色层仍严格落在可画区内。
// 这是整个“手工上色不会把零件画散架”承诺的不变量，比目检可靠。
async function selfTest() {
  const pid = 't00_p01';
  state.cur = null;        // 绕过同零件短路，强制把三层画布与 mask 重新装载到位
  await selectPart(pid);
  const p = state.byId.get(pid);
  const W = p.size[0], H = p.size[1];
  state.color = '#e0902f'; state.size = 40; state.opacity = 1; state.flow = 1;
  // 预填 + 故意在四个角与边界外大量下笔
  $('#prefill').click();
  for (let i = 0; i < 60; i++) {
    const a = [Math.random() * W * 1.6 - W * 0.3, Math.random() * H * 1.6 - H * 0.3];
    const b = [a[0] + 60, a[1] + 40];
    beginStroke(a); extendStroke(b); endStroke();
  }
  const out = xPaint.getImageData(0, 0, W, H);
  const msk = state.seamless ? xMaskOp.getImageData(0, 0, W, H) : state.maskData;
  const src = await loadImage(`kit://${pid}/source.png`);
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
  const tt = tmp.getContext('2d'); tt.drawImage(src, 0, 0);
  const orig = tt.getImageData(0, 0, W, H);

  let outside = 0, onOutline = 0, painted = 0;
  for (let i = 0; i < W * H; i++) {
    const a = out.data[i * 4 + 3];
    if (a < 8) continue;
    painted++;
    if (!msk.data[i * 4 + 3]) { outside++; continue; }      // 落在可画区之外（mask 走 alpha 通道）
    if (orig.data[i * 4] < 70 && orig.data[i * 4 + 3] > 20) onOutline++;
  }
  const verdict = (outside === 0) ? 'PASS' : 'FAIL';
  console.log(`[selftest] ${verdict} painted=${painted} outside=${outside} onOutline=${onOutline}`);
  await window.v2p.paintSavePart(state.job, pid + '_selftest', cPaint.toDataURL('image/png'));
  msg(`自检 ${verdict}：上色 ${painted}px，越界 ${outside}px`);
}
