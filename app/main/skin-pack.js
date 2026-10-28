// skin-pack.js — Live2D 皮肤包导入与探测
//
// 兼容两类目录：
//   1. 通用 Live2D：任意位置有 *.model3.json + moc3 + 贴图
//   2. BongoCat：模型目录下额外有 resources/background.png、
//      resources/left-keys|right-keys（与画布同尺寸的整页叠加图）
//
// BongoCat 的社区包经常套很多层（如 img/standard/cat_model），
// 因此入口搜索是递归的；导入时只复制真正含 model3.json 的包根。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const MODEL3 = '.model3.json';
const IGNORED_DIRS = new Set(['__MACOSX', '.git', 'node_modules', '.idea', '.vscode']);
const IGNORED_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const MAX_ZIP_BYTES = 256 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 768 * 1024 * 1024;
const MAX_ENTRIES = 8000;
const GENERIC_NAMES = new Set(['cat', 'cat_model', 'model', 'models', 'assets', 'resources', 'img', 'standard', 'keyboard', 'gamepad', 'main', 'skin']);

function isIgnoredDir(name) {
  return IGNORED_DIRS.has(name) || name.startsWith('.');
}

function isIgnoredFile(name) {
  return IGNORED_FILES.has(name.toLowerCase());
}

function safeName(s) {
  let out = String(s || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[^\w\u4e00-\u9fa5.\- ]/g, '')
    .replace(/\s+/g, '')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 64);
  if (!out) return '';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(out)) out += '_';
  return out;
}

function slash(p) {
  return String(p || '').split(path.sep).join('/');
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

function readPngSize(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(24);
    const n = fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (n < 24) return null;
    if (buf.readUInt32BE(0) !== 0x89504e47) return null; // PNG signature
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } catch {
    return null;
  }
}

function listModel3(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(MODEL3));
  } catch {
    return [];
  }
}

/** 递归收集 *.model3.json，返回 {file, dir, depth} */
function findModelCandidates(root, maxDepth = 8) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!isIgnoredDir(e.name)) walk(p, depth + 1);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(MODEL3)) {
        out.push({ file: p, dir, depth });
      }
    }
  };
  walk(root, 0);
  return out;
}

function pickEntryInDir(dir) {
  const files = listModel3(dir);
  if (!files.length) return null;
  // 包里常带 min/test/demo 等副本，优先真正的主模型
  const prefer = files.filter((f) => !/(^|[-_.])(min|test|demo|backup|copy|old)([-_.0-9]|$)/i.test(f));
  const pool = prefer.length ? prefer : files;
  const cat = pool.find((f) => f.toLowerCase() === 'cat.model3.json');
  if (cat) return cat;
  const withResources = pool.find((f) => isDir(path.join(dir, 'resources')));
  return withResources || pool[0];
}

function scorePackage(dir, depth) {
  let score = 100 - depth * 5;
  const base = path.basename(dir).toLowerCase();
  if (['cat_model', 'model', 'models'].includes(base)) score += 30;
  if (isDir(path.join(dir, 'resources'))) score += 25;
  if (isFile(path.join(dir, 'resources', 'background.png'))) score += 10;
  if (isDir(path.join(dir, 'resources', 'left-keys'))) score += 10;
  if (isDir(path.join(dir, 'resources', 'right-keys'))) score += 5;
  return score;
}

/**
 * 在一个可能套了很多层的目录里挑出“包根”。
 * 返回 [{ dir, entry, depth, score }]，按 score 降序。
 */
function findPackages(root) {
  const candidates = findModelCandidates(root);
  const byDir = new Map();
  for (const c of candidates) {
    const name = pickEntryInDir(c.dir);
    if (!name) continue;
    const entry = path.join(c.dir, name);
    const score = scorePackage(c.dir, c.depth);
    const prev = byDir.get(c.dir);
    if (!prev || score > prev.score) byDir.set(c.dir, { dir: c.dir, entry, depth: c.depth, score });
  }
  return [...byDir.values()].sort((a, b) => b.score - a.score || a.depth - b.depth || a.dir.length - b.dir.length);
}

function findPackageRoot(root) {
  const packs = findPackages(root);
  return packs.length ? packs[0] : null;
}

function keyNameOf(file) {
  return path.basename(file, path.extname(file));
}

const GAMEPAD_KEYS = new Set([
  'East', 'West', 'North', 'South',
  'DPadUp', 'DPadDown', 'DPadLeft', 'DPadRight',
  'LeftTrigger', 'RightTrigger', 'LeftTrigger2', 'RightTrigger2',
  'LeftShoulder', 'RightShoulder', 'LeftThumb', 'RightThumb',
  'Start', 'Select', 'Guide', 'Back'
]);

function isTypingKey(base) {
  return /^Key[A-Z]$/i.test(base) || /^[A-Z]$/.test(base) || /^Num[0-9]$/i.test(base) || /^Digit[0-9]$/i.test(base);
}

function scanKeys(pkgDir) {
  const all = [];
  const bySide = { left: [], right: [] };
  for (const side of ['left', 'right']) {
    const dir = path.join(pkgDir, 'resources', `${side}-keys`);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')); } catch { /* 皮肤可以没有键帽 */ }
    for (const f of files) {
      const rel = `resources/${side}-keys/${f}`;
      all.push(rel);
      bySide[side].push(rel);
    }
  }
  const letters = all.filter((rel) => isTypingKey(keyNameOf(rel)));
  const gamepad = all.filter((rel) => GAMEPAD_KEYS.has(keyNameOf(rel)));
  return { all, letters, left: bySide.left, right: bySide.right, gamepad };
}

function declaredModeFromPath(pkgDir) {
  const s = slash(pkgDir).toLowerCase();
  if (/gamepad|手柄|控制器/.test(s)) return 'gamepad';
  if (/keyboard|键盘/.test(s)) return 'keyboard';
  if (/standard|标准/.test(s)) return 'standard';
  return '';
}

function detectMode(pkgDir, meta) {
  if (meta && (meta.modeOverride || meta.mode)) return meta.modeOverride || meta.mode;
  const keys = scanKeys(pkgDir);
  if (keys.gamepad.length) return 'gamepad';
  if (keys.all.length) return 'keyboard';
  return 'standard';
}

function readMetaAt(dir) {
  return readJson(path.join(dir, 'v2p-skin.json'));
}

function listTexturePages(dir, base, entry) {
  const model = readJson(path.join(dir, base || '', entry || ''));
  const textures = model && model.FileReferences && model.FileReferences.Textures;
  if (!Array.isArray(textures)) return [];
  return textures.map((t) => slash(t));
}

function collectWarnings(pkgDir, model, textures) {
  const warnings = [];
  const refs = [];
  const fr = (model && model.FileReferences) || {};
  if (fr.Moc) refs.push(fr.Moc);
  if (Array.isArray(fr.Textures)) refs.push(...fr.Textures);
  if (fr.Physics) refs.push(fr.Physics);
  if (fr.DisplayInfo) refs.push(fr.DisplayInfo);
  for (const exp of fr.Expressions || []) if (exp && exp.File) refs.push(exp.File);
  for (const group of Object.values(fr.Motions || {})) {
    for (const motion of group || []) if (motion && motion.File) refs.push(motion.File);
  }
  const missing = [];
  for (const rel of refs) {
    if (typeof rel !== 'string' || !rel) continue;
    const p = path.join(pkgDir, rel.split('/').join(path.sep));
    if (!isFile(p)) missing.push(rel);
  }
  if (missing.length) warnings.push(`缺少文件：${missing.slice(0, 6).join('、')}${missing.length > 6 ? '…' : ''}`);
  const big = textures.filter((t) => t.width >= 4096 || t.height >= 4096);
  if (big.length) {
    warnings.push(`贴图较大（${big.map((t) => `${t.width}×${t.height}`).join('、')}），首次加载可能较慢`);
  }
  return { warnings, missing };
}

function inspectDir(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  let pkgDir = dir;
  let base = '';
  const directEntry = pickEntryInDir(dir);
  let entry = directEntry ? path.join(dir, directEntry) : null;
  if (!entry) {
    const pkg = findPackageRoot(dir);
    if (!pkg) return null;
    pkgDir = pkg.dir;
    base = slash(path.relative(dir, pkg.dir));
    entry = pkg.entry;
  }
  const entryRel = slash(path.relative(pkgDir, entry));
  const meta = readMetaAt(pkgDir) || readMetaAt(dir) || {};
  const model = readJson(path.join(pkgDir, entryRel));
  const textures = listTexturePages(pkgDir, '', entryRel).map((rel) => {
    const size = readPngSize(path.join(pkgDir, rel.split('/').join(path.sep)));
    return { path: rel, ...(size || {}) };
  });
  const { warnings, missing } = collectWarnings(pkgDir, model, textures);
  const keys = scanKeys(pkgDir);
  const mode = detectMode(pkgDir, meta);
  const declaredMode = meta.declaredMode || declaredModeFromPath(pkgDir) || '';
  if (declaredMode && declaredMode !== mode) {
    warnings.push(`包标注为 ${declaredMode} 模式，但检测到 ${mode} 资源（按 ${mode} 处理）`);
  }
  return {
    name: path.basename(dir),
    base,
    entry: entryRel,
    mode,
    declaredMode,
    hasBg: isFile(path.join(pkgDir, 'resources', 'background.png')),
    hasKeys: keys.all.length > 0,
    keyCount: keys.all.length,
    textures,
    warnings,
    missing,
    scene: meta.scene || null,
    source: meta.source || '',
    licenseNote: meta.licenseNote || '',
  };
}

function validateZipEntries(entries) {
  const bad = [];
  for (const raw of entries) {
    const name = String(raw || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (!name) continue;
    if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
      bad.push(raw);
      continue;
    }
    const parts = name.split('/');
    if (parts.some((part) => part === '..')) bad.push(raw);
  }
  return { ok: bad.length === 0, bad };
}

async function listZipEntries(zipPath) {
  try {
    const { stdout } = await execFileAsync('tar', ['-tf', zipPath], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    return stdout.split(/\r?\n/).filter(Boolean);
  } catch {
    /* fall through to PowerShell */
  }
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    `$z=[IO.Compression.ZipFile]::OpenRead(${JSON.stringify(zipPath)})`,
    'try { $z.Entries | ForEach-Object { $_.FullName } } finally { $z.Dispose() }',
  ].join('; ');
  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return stdout.split(/\r?\n/).filter(Boolean);
}

async function extractZip(zipPath, destDir) {
  if (!isFile(zipPath)) throw new Error('zip 文件不存在');
  const stat = fs.statSync(zipPath);
  if (stat.size > MAX_ZIP_BYTES) throw new Error('zip 超过 256MB，暂不支持');
  const entries = await listZipEntries(zipPath);
  if (entries.length > MAX_ENTRIES) throw new Error(`zip 文件数过多（${entries.length}）`);
  const check = validateZipEntries(entries);
  if (!check.ok) throw new Error('zip 内含越界路径，已拒绝导入');
  fs.mkdirSync(destDir, { recursive: true });
  try {
    await execFileAsync('tar', ['-xf', zipPath, '-C', destDir], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  } catch {
    const ps = `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(destDir)} -Force`;
    await execFileAsync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  }
  const total = dirSize(destDir);
  if (total > MAX_EXTRACTED_BYTES) {
    fs.rmSync(destDir, { recursive: true, force: true });
    throw new Error('解压后超过 768MB，已拒绝导入');
  }
}

function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        try { total += fs.statSync(p).size; } catch { /* ignore */ }
      }
    }
  };
  walk(dir);
  return total;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, e.name);
    const dp = path.join(dst, e.name);
    if (e.isDirectory()) {
      if (isIgnoredDir(e.name)) continue;
      copyDir(sp, dp);
    } else if (e.isFile()) {
      if (isIgnoredFile(e.name)) continue;
      fs.copyFileSync(sp, dp);
    }
  }
}

function deriveName(pkgDir, entryRel, srcPath) {
  const entryBase = path.basename(entryRel, MODEL3);
  if (entryBase && !GENERIC_NAMES.has(entryBase.toLowerCase())) return safeName(entryBase) || 'skin';
  let base = path.basename(pkgDir);
  let parent = path.dirname(pkgDir);
  if (GENERIC_NAMES.has(base.toLowerCase())) {
    base = path.basename(parent);
    parent = path.dirname(parent);
  }
  if (GENERIC_NAMES.has(base.toLowerCase())) base = path.basename(parent);
  if (GENERIC_NAMES.has(base.toLowerCase())) base = path.basename(srcPath, path.extname(srcPath));
  base = String(base || '').replace(/-main$/i, '');
  return safeName(base) || 'skin';
}

/**
 * 导入皮肤包。
 * @param {{zipPath?:string, folderPath?:string, name?:string, sourceNote?:string, overwrite?:boolean}} opts
 * @param {string} modelsRoot
 */
async function importPack(opts, modelsRoot) {
  const { zipPath, folderPath, name, sourceNote, overwrite } = opts || {};
  const srcPath = zipPath || folderPath;
  if (!srcPath || !fs.existsSync(srcPath)) return { ok: false, error: '皮肤包不存在' };
  const isZip = /\.zip$/i.test(srcPath);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-skin-'));
  try {
    let searchRoot = srcPath;
    if (isZip) {
      await extractZip(srcPath, tmp);
      searchRoot = tmp;
    }
    const packs = findPackages(searchRoot);
    if (!packs.length) {
      return { ok: false, error: '包内找不到 *.model3.json（不是 Live2D/Cubism 4 皮肤包）' };
    }
    const pkg = packs[0];
    const info = inspectDir(pkg.dir);
    if (!info) return { ok: false, error: '皮肤包结构无法识别' };
    const skin = safeName(name) || deriveName(pkg.dir, info.entry, srcPath);
    if (!skin) return { ok: false, error: '皮肤名不合法' };
    const dest = path.join(modelsRoot, skin);
    const existed = fs.existsSync(dest);
    if (existed && !overwrite) {
      return { ok: false, error: `同名皮肤「${skin}」已存在`, exists: true, name: skin };
    }
    if (existed) fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(modelsRoot, { recursive: true });
    copyDir(pkg.dir, dest);
    const meta = {
      name: skin,
      entry: info.entry,
      mode: info.mode,
      declaredMode: info.declaredMode,
      importedAt: new Date().toISOString(),
      source: sourceNote || (isZip ? path.basename(srcPath) : srcPath),
      licenseNote: '第三方皮肤包，版权归原作者；本项目仅自用导入，不主张权利。',
      textures: info.textures,
      warnings: info.warnings,
    };
    fs.writeFileSync(path.join(dest, 'v2p-skin.json'), JSON.stringify(meta, null, 2), 'utf8');
    return {
      ok: true,
      name: skin,
      mode: info.mode,
      declaredMode: info.declaredMode,
      entry: info.entry,
      updated: existed,
      source: meta.source,
      warnings: info.warnings,
      textureCount: info.textures.length,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 清理失败忽略 */ }
  }
}

function readMeta(dir) {
  if (!dir) return null;
  const direct = readMetaAt(dir);
  if (direct) return direct;
  const info = inspectDir(dir);
  if (!info) return null;
  const pkgDir = info.base ? path.join(dir, info.base.split('/').join(path.sep)) : dir;
  return readMetaAt(pkgDir);
}

function saveMeta(dir, patch) {
  const info = inspectDir(dir);
  if (!info) return null;
  const pkgDir = info.base ? path.join(dir, info.base.split('/').join(path.sep)) : dir;
  const current = readMetaAt(pkgDir) || readMetaAt(dir) || {};
  const next = { ...current, ...patch };
  fs.writeFileSync(path.join(pkgDir, 'v2p-skin.json'), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = {
  MODEL3,
  safeName,
  readPngSize,
  validateZipEntries,
  findModelCandidates,
  findPackages,
  findPackageRoot,
  pickEntryInDir,
  scanKeys,
  detectMode,
  inspectDir,
  importPack,
  readMeta,
  saveMeta,
  listTexturePages,
  deriveName,
};