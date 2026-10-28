const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const skinPack = require('./skin-pack');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v2p-skin-test-'));

function pngHeader(width, height) {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function touch(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

try {
  // 1) GitHub 仓库常见的深层结构：repo/img/standard/cat_model/deepseek.model3.json
  const repo = path.join(tmp, 'Deepseek-standard-mode-main');
  const pkg = path.join(repo, 'img', 'standard', 'cat_model');
  touch(path.join(pkg, 'deepseek.model3.json'), JSON.stringify({
    Version: 3,
    FileReferences: {
      Moc: 'deepseek.moc3',
      Textures: ['deepseek.4096/texture_00.png'],
      Physics: 'deepseek.physics3.json'
    }
  }));
  touch(path.join(pkg, 'deepseek.moc3'));
  touch(path.join(pkg, 'deepseek.physics3.json'));
  touch(path.join(pkg, 'deepseek.4096', 'texture_00.png'), pngHeader(4096, 4096));
  touch(path.join(pkg, 'resources', 'left-keys', 'KeyA.png'));
  touch(path.join(pkg, 'resources', 'left-keys', 'Space.png'));
  touch(path.join(pkg, 'resources', 'cover.png'));

  const packs = skinPack.findPackages(repo);
  assert.strictEqual(packs.length, 1, '深层入口能被找到');
  assert.strictEqual(path.resolve(packs[0].dir), path.resolve(pkg), '选中的是 cat_model 包根');

  const info = skinPack.inspectDir(repo);
  assert(info, '仓库根目录可直接探测');
  assert.strictEqual(info.base, 'img/standard/cat_model', '嵌套包根以 base 暴露');
  assert.strictEqual(info.entry, 'deepseek.model3.json', '入口文件保持包内相对路径');
  assert.strictEqual(info.mode, 'keyboard', '有键帽按 keyboard 处理');
  assert.strictEqual(info.declaredMode, 'standard', '目录名给出包标注模式');
  assert.strictEqual(info.hasKeys, true);
  assert.strictEqual(info.hasBg, false, '大肥鱼没有 background');
  assert.strictEqual(info.keyCount, 2);
  assert.deepStrictEqual(info.textures, [{ path: 'deepseek.4096/texture_00.png', width: 4096, height: 4096 }]);
  assert(info.warnings.some((w) => /贴图较大/.test(w)), '4096 贴图给出警告');

  assert.strictEqual(skinPack.deriveName(pkg, 'deepseek.model3.json', path.join(repo, 'x.zip')), 'deepseek', '入口名优先作为皮肤名');

  // 同目录里的 min/test 副本不能抢主模型
  touch(path.join(pkg, 'deepseek-min.model3.json'), '{}');
  assert.strictEqual(skinPack.pickEntryInDir(pkg), 'deepseek.model3.json', '主模型优先于 min 副本');

  // cat.model3.json 是通用名，用上级目录作为皮肤名
  const lx = path.join(tmp, '罗小黑 · 标准模式', 'cat_model');
  touch(path.join(lx, 'cat.model3.json'), '{}');
  assert.strictEqual(skinPack.deriveName(lx, 'cat.model3.json', path.join(tmp, 'x.zip')), '罗小黑标准模式');

  // 2) 标准模型：没有 keys/resources
  const plain = path.join(tmp, 'plain');
  touch(path.join(plain, 'cat.model3.json'), JSON.stringify({
    FileReferences: { Moc: 'cat.moc3', Textures: ['texture_00.png'] }
  }));
  touch(path.join(plain, 'cat.moc3'));
  touch(path.join(plain, 'texture_00.png'), pngHeader(1024, 1024));
  const plainInfo = skinPack.inspectDir(plain);
  assert.strictEqual(plainInfo.mode, 'standard');
  assert.strictEqual(plainInfo.hasKeys, false);
  assert.strictEqual(plainInfo.hasBg, false);

  // 3) 手柄键名
  const pad = path.join(tmp, 'pad');
  touch(path.join(pad, 'cat.model3.json'), '{}');
  touch(path.join(pad, 'resources', 'right-keys', 'East.png'));
  assert.strictEqual(skinPack.detectMode(pad, {}), 'gamepad');

  // 4) zip 路径校验
  assert.deepStrictEqual(skinPack.validateZipEntries(['a/b.png', 'cat.model3.json']), { ok: true, bad: [] });
  for (const bad of ['../evil.png', '/abs/evil.png', 'C:/evil.png', 'a/../../evil.png']) {
    const r = skinPack.validateZipEntries([bad]);
    assert.strictEqual(r.ok, false, '拒绝越界路径 ' + bad);
    assert.deepStrictEqual(r.bad, [bad]);
  }

  // 5) 名字与 PNG 尺寸
  assert.strictEqual(skinPack.safeName('大肥鱼 · 标准模式'), '大肥鱼标准模式');
  assert.strictEqual(skinPack.safeName('CON'), 'CON_');
  assert.deepStrictEqual(skinPack.readPngSize(path.join(pkg, 'deepseek.4096', 'texture_00.png')), { width: 4096, height: 4096 });

  console.log('PASS skin-pack deep search, mode detection, metadata and path guards');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}