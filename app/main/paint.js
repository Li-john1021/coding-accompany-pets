// paint.js — 上色画板的文件读写 IPC（主进程侧）
//
// 为什么需要它：画板要读 skin-forge 产出的分层素材、要把上色结果写回磁盘给
// bake_paint.py 烘焙，而渲染层是 contextIsolation 的沙箱，只能走这里。
//
// 目录约定：
//   零件素材（只读）  skin-forge/base/keyboard_analysis/paint_kit/<part>/...
//                     打包后回退到 app/assets/paint_kit
//   作品（可写）      userData/paint-jobs/<job>/painted/<part>.png + job.json
const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const DEV_KIT = path.join(__dirname, '..', '..', 'skin-forge',
  'base', 'keyboard_analysis', 'paint_kit');
const BUNDLED_KIT = path.join(__dirname, '..', 'assets', 'paint_kit');
// 生成皮肤用的基座（完整可运行皮肤，烘焙=拷贝后改贴图页）
const DEV_BASE = path.join(__dirname, '..', '..', 'skin-forge', 'base', 'keyboard');
const BUNDLED_BASE = path.join(__dirname, '..', 'assets', 'skin-base', 'keyboard');

function kitRoot() {
  return fs.existsSync(DEV_KIT) ? DEV_KIT : BUNDLED_KIT;
}

function baseRoot() {
  return fs.existsSync(DEV_BASE) ? DEV_BASE : BUNDLED_BASE;
}

function modelsRoot() {
  return path.join(app.getPath('userData'), 'models');
}

function jobsRoot() {
  const dir = path.join(app.getPath('userData'), 'paint-jobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// job 名只允许安全字符，防目录穿越
function safeName(s) {
  return String(s || '').replace(/[^A-Za-z0-9_\-\u4e00-\u9fa5]/g, '').slice(0, 48);
}

function jobDir(job) {
  const name = safeName(job);
  if (!name) throw new Error('bad job name');
  return path.join(jobsRoot(), name);
}

function register() {
  ipcMain.handle('v2p:paint-manifest', () => {
    const root = kitRoot();
    try {
      const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
      return { ok: true, kitRoot: root, ...m };
    } catch (e) {
      return { ok: false, error: String(e.message || e), parts: [] };
    }
  });

  ipcMain.handle('v2p:paint-jobs', () => {
    try {
      const root = jobsRoot();
      return { ok: true, root, jobs: fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory()).map((d) => d.name).sort() };
    } catch (e) { return { ok: false, jobs: [], error: String(e.message || e) }; }
  });

  ipcMain.handle('v2p:paint-new-job', (_e, { name }) => {
    const dir = path.join(jobDir(name || ('job-' + Date.now())), 'painted');
    fs.mkdirSync(dir, { recursive: true });
    const meta = path.join(path.dirname(dir), 'job.json');
    if (!fs.existsSync(meta)) {
      fs.writeFileSync(meta, JSON.stringify({ name: path.basename(path.dirname(dir)), created: Date.now() }, null, 2));
    }
    return { ok: true, dir };
  });

  // 保存一个零件的上色层（dataURL → PNG）
  ipcMain.handle('v2p:paint-save-part', (_e, { job, part, dataUrl }) => {
    const dir = path.join(jobDir(job), 'painted');
    fs.mkdirSync(dir, { recursive: true });
    const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(path.join(dir, safeName(part) + '.png'), Buffer.from(b64, 'base64'));
    return { ok: true, file: path.join(dir, safeName(part) + '.png') };
  });

  // 读回已画的上色层（继续编辑）
  ipcMain.handle('v2p:paint-load-part', (_e, { job, part }) => {
    const fp = path.join(jobDir(job), 'painted', safeName(part) + '.png');
    if (!fs.existsSync(fp)) return { ok: true, dataUrl: '' };
    return { ok: true, dataUrl: 'data:image/png;base64,' + fs.readFileSync(fp).toString('base64') };
  });

  // 列出某作品已画了哪些零件（预览区用）
  ipcMain.handle('v2p:paint-job-parts', (_e, { job }) => {
    const dir = path.join(jobDir(job), 'painted');
    if (!fs.existsSync(dir)) return { ok: true, parts: [] };
    return { ok: true, parts: fs.readdirSync(dir).filter((f) => f.endsWith('.png'))
      .map((f) => f.replace(/\.png$/, '')) };
  });

  // 作品目录：给 bake_paint.py 用，直接在资源管理器里打开
  ipcMain.handle('v2p:paint-open-job', (_e, { job }) => {
    const dir = jobDir(job);
    if (!fs.existsSync(dir)) return { ok: false, error: '作品不存在' };
    require('electron').shell.openPath(dir);
    return { ok: true };
  });

  // ✨ 生成皮肤：渲染层已按 bake 规则合成好贴图页（含 alpha 校验），
  // 这里拷一份基座皮肤到 userData/models/<名字>/ 再覆盖贴图页，皮肤即刻可用。
  // 重名 = 覆盖更新（改完再生成一次即可）
  ipcMain.handle('v2p:paint-create-skin', (_e, { job, name, pages }) => {
    try {
      const skin = safeName(name);
      if (!skin) return { ok: false, error: '皮肤名不合法（仅限中英文/数字/下划线/横线）' };
      const base = baseRoot();
      if (!fs.existsSync(path.join(base, 'cat.model3.json'))) {
        return { ok: false, error: '找不到基座皮肤（skin-forge/base/keyboard）' };
      }
      // 皮肤↔作品 1:1 快照：之后「修改皮肤」按皮肤名打开对应涂装草稿
      const srcJob = jobDir(job);
      const dstJob = jobDir(skin);
      const out = path.join(modelsRoot(), skin);
      const existed = fs.existsSync(out);
      const hadJob = fs.existsSync(path.join(dstJob, 'painted'));
      if (path.resolve(srcJob) !== path.resolve(dstJob)) {
        fs.rmSync(dstJob, { recursive: true, force: true });
        fs.cpSync(srcJob, dstJob, { recursive: true });
      }
      // 覆盖一个不是本画板生成的皮肤（没有涂装记录）：先把它的现有贴图备份到
      // 作品目录 previous-textures/，防止当前草稿毁掉用户手工改过的皮肤
      let backedUp = false;
      if (existed && !hadJob) {
        const prevDir = path.join(dstJob, 'previous-textures', Date.now().toString(36));
        fs.mkdirSync(prevDir, { recursive: true });
        fs.cpSync(path.join(out, 'demomodel2.1024'), prevDir, { recursive: true });
        backedUp = true;
      }
      fs.rmSync(out, { recursive: true, force: true });
      fs.cpSync(base, out, { recursive: true });
      let written = 0;
      for (const [page, dataUrl] of Object.entries(pages || {})) {
        if (!/^[\w.\-]+\.png$/.test(page)) return { ok: false, error: '贴图页名不合法：' + page };
        const fp = path.join(out, 'demomodel2.1024', page);
        if (!fs.existsSync(path.dirname(fp))) return { ok: false, error: '基座缺贴图目录 demomodel2.1024' };
        fs.writeFileSync(fp, Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64'));
        written++;
      }
      // 设置页的皮肤下拉框即时刷新（无需重开设置）
      const { BrowserWindow } = require('electron');
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('v2p:pet-model-list-changed', {});
      }
      return { ok: true, name: skin, dir: out, pages: written, updated: existed, backedUp };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });
}

module.exports = { register, kitRoot, jobsRoot };
