# coding-accompany-pets 迁移与发布存档（压缩前）

日期：2026-10-29（Asia/Shanghai）
用途：上下文压缩前保存全部关键状态。压缩后先读本文件，再继续执行“改名 + 换图标 + 重写 README + 推送 GitHub”。

---

## 0. 用户最新指令（原文要点）

1. 处理好就推 GitHub。
2. README 写美观、有趣，教人怎么用、怎么下载。
3. 软件图标换成用户提供的图片（见下方路径）。
4. 软件改名为 **coding-accompany-pets**。
5. GitHub 仓库名也可以改，改成和软件同名。
6. 现在需要压缩，先写当前记录存档。

用户提供的图标原图：

```
C:\Users\17084\.zcode\cli\image-cache\sess_ecaa02bd-28bc-47b3-8b9b-aa653c47e9ec\image-03c98001bfe8658fe54a97245865c113.png
580 × 580 PNG，378,878 bytes，RGB
内容：蓝发动漫女仆角色，左上角对话气泡“正在思考....”
```

这是用户提供的素材；公开仓库使用前需确认版权/授权（见第 8 节风险项）。

---

## 1. 当前仓库状态（已完成、已合并）

- 主项目：`D:\MyVibeProj\My_Agent_Team\voice2prompt-open`
- 分支：`main`
- HEAD：`be0a31b build: vendor runtime deps and ship portable plus installer`
- 本存档提交后 main 会再前进一个 docs commit（即本文件）；工作区应为干净
- 工作区：干净
- 远端：`origin = https://github.com/Li-john1021/voice2prompt.git`
- 远端 main：`10b6045`（本机 main ahead 45，**尚未推送**）
- `.git` 约 **149MB**（release 里 V2.3 两个 exe 已入库）
- 凭据：`credential.helper=manager`；`git ls-remote origin` 可正常访问（GCM 有缓存凭据）
- `gh` 未安装；环境无 `GITHUB_TOKEN` / `GH_TOKEN`
- 其他 worktree（不要动）：
  - `voice2prompt-open-feedback` → `codex/screenshot-asr-feedback-v2` @ `be0a31b`（已合入 main）
  - `voice2prompt-open-screenshot-vision` → `codex/screenshot-vision-v1` @ `d979940`
  - `C:/Users/17084/.codex/worktrees/palette-trigger-fix/voice2prompt-open` → `codex/palette-input-sources` @ `86cc3db`
  - `codex/palette-trigger-fix` @ `5f11cd1`

最近提交：

```
be0a31b build: vendor runtime deps and ship portable plus installer
70c5c8f docs: record V2.2 vision settings delivery
0641d0b feat: separate vision model settings from text model
6fbe05b docs: record UI fix delivery and new portable build
95cd139 fix: restore pet input after screenshot and surface recognition feedback
```

---

## 2. 当前产品/运行状态

- 名称：**Voice2Prompt**（待改名）
- 版本：`1.0.0`
- Electron：`31.7.7`，Windows x64，`asar:false`
- 运行中的安装版：`D:\v2p\Voice2Prompt\Voice2Prompt.exe`
  - 桌面快捷方式 `Voice2Prompt.lnk` 指向该路径
  - 该目录已被 V2.3 Setup 静默安装升级（2026-10-29 01:22 左右）
  - 当前有 Electron 主/渲染进程在运行（PID 可能变化；如要重装/改名先关闭）
- 真实配置目录：`%APPDATA%\Voice2Prompt\config.json`
  - ASR：`mimo-v2.5-asr`
  - 文字模型：`mimo-v2.6-flash`
  - 识图模型：`MIMO（识图）` / `mimo-v2.6-flash` / `activeVisionId=vision-b52kdw0d`
  - 热键：语音 `Alt+X`，截图 `Alt+A`
  - `triggerMode=click`，`insertMode=paste`，`mouseRecord=true`
  - 文字模型上的 `multimodal` 字段已迁移删除
  - key 为 `b64:` 掩码；**不要打印、不要提交**
  - 备份：`config.json.bak-vision-1793184768201`（含 key，勿提交）
- 当前已实现并验证：
  - 截图：默认 MIT `electron-screenshots` 冻结屏 + 小浮条；旧控制器保留为 `V2P_SCREENSHOT_LEGACY=1` 回退
  - 桌宠截图后 mousedown 丢失：`app/main/window-restore.js` 的 1px 高度 nudge 修复，真实 OS 拖拽回归通过
  - 识图：独立 `visionProviders` / `activeVisionId`，设置页独立“识图模型”列表；文字模型不再需要多模态勾选
  - 旧配置迁移：`multimodal===true` 的激活模型自动变成识图模型并删除旧字段
  - ASR 用户已冻结，不要改 ASR、不要新增真实 ASR 调用
- 发布产物（当前 `release/`，已入库）：
  - `Voice2Prompt-FeedbackV2.3-1.0.0-Portable.exe` — 74,057,544 bytes — SHA-256 `b487f54cdf0990938aa15eb2688f41984d01c8245c23be1a9796649cabdf58ca`
  - `Voice2Prompt-FeedbackV2.3-Setup-1.0.0.exe` — 74,305,527 bytes — SHA-256 `564674ba145dd86f17abef0fcaa6ddb7d9edfcb4a676d403f601b23dba868955`
  - 旧版本仍在 `app/dist-exe/`（V2.1/V2.2/V2.3），不参与新 release
- 依赖自包含：
  - 运行时第三方代码在 `app/vendor/`（约 2.6MB）
  - electron-screenshots 0.6.2 + react-screenshots 0.6.1 + node-screenshots 0.2.8 + win32-x64 原生
  - uiohook-napi 1.5.5（win32-x64 prebuild）+ node-gyp-build 4.8.4
  - pixi.js 7.4.2 `pixi.min.js` + pixi-live2d-display 0.4.0 `cubism4.min.js`
  - debug/ms/fs-extra/graceful-fs/jsonfile/universalify 均在 vendor 内
  - `app/package.json` 生产依赖已清空，只剩 electron/electron-builder 开发依赖
  - 无 `app/node_modules` 的源码副本已用 Electron 启动成功（日志 `[mouse] hook on`）
- Live2D：`app/renderer/lib/live2dcubismcore.min.js` 为专有组件，**gitignore 中不提交**；当前 release 二进制由本机构建，包含本机已下载的该文件

---

## 3. 改名方案（待执行）

### 3.1 命名决策（按字面执行）

- 仓库名：**`coding-accompany-pets`**
- `app/package.json` `name`：`coding-accompany-pets`
- `productName`：`coding-accompany-pets`（按用户原话；如果希望显示成 “Coding Accompany Pets”，只改显示名/README 标题，不影响仓库名）
- `appId`：`com.codingaccompanypets.app`
- 版本：建议 **1.1.0**（改名+图标+README+依赖自包含）
- 安装包/便携包：
  - `coding-accompany-pets-Setup-1.1.0.exe`
  - `coding-accompany-pets-1.1.0-Portable.exe`
- NSIS `shortcutName`：`coding-accompany-pets`
- 如用户希望显示名带空格，README 标题用 `Coding Accompany Pets`，但 exe/安装包/仓库保持 `coding-accompany-pets`。

### 3.2 必须改的文件/位置

- `package.json`（仓库根，electron-builder 配置）
  - `build.productName`
  - `build.appId`
  - `build.nsis.shortcutName`
  - `build.nsis.artifactName`
  - `build.portable.artifactName`
  - 如有 `executableName` 也改
- `app/package.json`
  - `name`、`productName`、`version`（1.1.0）、`description`
- `app/main/main.js`
  - `app.setAppUserModelId('voice2prompt.app')` → 新 id
  - 托盘 tooltip / “退出 Voice2Prompt” 菜单文案
  - **用户数据路径保护**：见 3.3
- `app/renderer/settings.html`
  - `<title>`、`<h1>`、副标题
- `app/renderer/palette.html` 等仍含旧名的窗口标题/文案
- `app/renderer/settings.js`、`pet.js` 等文案中的旧名（grep）
- `README.md`、`app/README.md`、`release/README.md`、`app/vendor/README.md`
- `app/build/icon.ico`、`app/assets/tray.png`
- `release/` 产物名、`SHA256SUMS.txt`
- 历史 docs 里的旧名可保留（历史记录）；README/发布文档必须更新

查找旧名：

```bash
grep -rIl "Voice2Prompt" --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=dist-exe --exclude-dir=vendor --exclude-dir=release .
```

注意：`app/vendor` 内第三方 README 可能提到 Voice2Prompt，可改可不改；我们的 `app/vendor/README.md` 建议改。

### 3.3 用户数据不能丢（关键）

改名后 Electron 的 `app.getName()` / `userData` 会从 `%APPDATA%\Voice2Prompt` 变成新名字的目录，导致现有配置、识图模型、录音恢复全部“消失”。

**方案：在 `app/main/main.js` 最顶部、任何 `config.load()` 之前固定旧 userData：**

```js
const { app } = require('electron');
const path = require('path');
app.setPath('userData', path.join(app.getPath('appData'), 'Voice2Prompt'));
```

- 这样新名字的安装版继续读旧配置，用户无感。
- 代价：数据目录仍叫 `Voice2Prompt`；如果以后想改成新目录，需要写一次性迁移（复制 config.json + audio-recovery），当前不做。
- 必须在 `config.load()` 之前执行；`config.js` 里 `configPath()` 是惰性调用，顶部设置即可。
- 安装版 appId 改变可能导致新旧安装共存；新安装会创建新快捷方式，旧 `D:\v2p\Voice2Prompt` 可手动卸载。

---

## 4. 图标方案（待执行）

工具：Python 3.14 + Pillow 12.2.0 可用（`python -c "import PIL"` 成功）；无 ImageMagick；PowerShell System.Drawing 可用。

步骤：

1. 复制用户原图到仓库（建议 `docs/assets/coding-accompany-pets.png`，用于 README hero）。
2. 生成多尺寸 ICO 到 `app/build/icon.ico`：
   - 尺寸：16、24、32、48、64、128、256
   - 可选：先裁一个正方形“头部特写”给 16/24/32 使用，避免整张图缩小后看不清；256 用完整图或特写均可。
   - Pillow 示例：
     ```python
     from PIL import Image
     im = Image.open(src).convert("RGBA")
     im.save("app/build/icon.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
     ```
3. `app/assets/tray.png`：用同一图裁头部/脸部，生成 32×32（或 64×64）PNG；托盘图标在 16px 下必须可辨认。
4. `app/build/icon.ico` 会被 electron-builder 用于 exe/安装包/快捷方式；`app/assets/tray.png` 用于系统托盘。
5. 验证：用 Pillow 重新打开 ICO 检查尺寸列表；构建后检查 exe 图标/安装包图标（至少构建无 icon 错误）。
6. README 用原图或裁图作为 hero（GitHub 相对路径 `docs/assets/...`）。

版权：用户提供的动漫图，公开仓库/README 使用前确认授权；如不能公开，改用自制/已授权图标。

---

## 5. README 方案（待执行）

目标：美观、有趣、实用，明确“怎么下载、怎么用”。建议结构：

1. **Hero**
   - `<div align="center">` + 图标/头部裁图（宽约 220）
   - 标题：`coding-accompany-pets`
   - 副标题：`一只会听写、会截图、会识图的编码搭子宠物`
   - 一句话：`按住说话 → 转写 → 结构化/优化 → 自动粘贴；截图 → 独立视觉模型识字。`
   - Badges：Windows / Electron / MIT / 运行时零依赖（不要写不存在的 CI）
2. **下载（最显眼）**
   - 表格：安装版 vs 便携版，哪个适合谁
   - 指向仓库 `release/` 的两个新文件（改名/重建后）
   - 说明：无需 Node/npm/网络；下载即用
   - 如果后续创建 GitHub Release，改成 Releases 链接
3. **30 秒上手**
   - 下载 → 安装/双击 → 打开设置 → 填 ASR/文字/识图三个模型 → 按 `Alt+X` 说话 / `Alt+A` 截图
   - 热键表：`Alt+X` 语音、`Alt+A` 截图；宠物滚轮缩放、拖动移动
4. **它能做什么**
   - 语音直出提示词（结构化/优化开关）
   - 截图冻结屏 + 小浮条 + 文字点选
   - 独立识图模型（纯文本模型也能用视觉）；结果进剪贴板
   - 桌宠/皮肤/Live2D 可选
5. **模型怎么配**
   - 三个独立列表：ASR / 文字模型 / 识图模型
   - 任意 OpenAI 兼容端点；识图模型与文字模型解耦
   - 旧版多模态配置自动迁移
6. **隐私**
   - 只调用你自己配置的 API；无遥测；截图/录音不上传第三方（除你配置的模型端点）
   - 配置在 `%APPDATA%\Voice2Prompt`；key 本地掩码
7. **常见问题**
   - 下载哪个？
   - 识图按钮灰/不可用？
   - Live2D 没显示？（Cubism Core 专有，需自行下载；静态宠物可用）
   - 杀毒误报？（未签名/自签名说明）
   - 为什么 Release 里有两个 exe？
8. **开发/构建**
   - 运行时已 vendor，`npm install` 只装 electron/electron-builder
   - 构建命令
   - 测试命令
9. **Credits / License**
   - electron-screenshots / react-screenshots / node-screenshots / uiohook-napi / pixi / BongoCat；Live2D 专有说明
   - 本项目 MIT
   - 图标来源/授权说明

语气：中文为主，轻松但不夸张；可以用“搭子”“电子宠物”“正在思考....”梗；避免虚假性能数字。

---

## 6. GitHub 推送方案（待执行）

### 6.1 远端事实

- `origin = https://github.com/Li-john1021/voice2prompt.git`
- 远端 main `10b6045`；本机 main ahead 45
- GCM 凭据可用（`git ls-remote` 成功）
- 无 `gh`；无 `GITHUB_TOKEN`/`GH_TOKEN` 环境变量
- `.git` 149MB；新 release 产物还会增加约 150MB（如果继续入库）

### 6.2 仓库改名

首选：GitHub API 改名（保留历史/issue/star）：

```bash
# 从 GCM 取凭据但绝不回显 token
creds=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill)
token=$(printf '%s\n' "$creds" | sed -n 's/^password=//p')
# 先确认目标名可用（404 表示可用）
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $token" \
  https://api.github.com/repos/Li-john1021/coding-accompany-pets
# 改名
curl -s -X PATCH \
  -H "Authorization: Bearer $token" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/Li-john1021/voice2prompt \
  -d '{"name":"coding-accompany-pets"}'
```

- 不要在终端 `echo $token`；不要把 token 写入文件/日志。
- 若 API 返回 401/403（token 无 repo 权限），回退：让用户在 GitHub 网页 Settings → Repository name 改名，然后执行 `git remote set-url`。
- 改名后：
  ```bash
  git remote set-url origin https://github.com/Li-john1021/coding-accompany-pets.git
  git remote -v
  ```
- 不要删除旧仓库；GitHub 会重定向旧 URL。

### 6.3 推送

```bash
cd /d/MyVibeProj/My_Agent_Team/voice2prompt-open
git push -u origin main
```

- 推送 45 个提交 + 大文件（V2.3 两个 exe，约 148MB；新增 1.1.0 产物后再加约 150MB）。
- 可能耗时数分钟；`GIT_TERMINAL_PROMPT=0` 可避免卡在终端，但 GCM 可能需要交互。
- 不要 force push；不要删远端历史。
- 如果 GitHub 因体积/超时拒绝：
  1. 备选 A：把 `release/` 大文件从 Git 工作树移除（历史仍在），用 GitHub Releases 上传资产；README 改 Releases 链接。
  2. 备选 B：为改名后的项目建一个**全新历史**（只保留当前树），推新仓库，避免旧大文件历史；会失去历史，需用户同意。
  3. 备选 C：使用 Git LFS（需要安装/配置，当前未用）。
- 推送后核对：`git status`、远端 main、README 渲染、release 文件可下载。

### 6.4 发布产物命名（新）

- `release/coding-accompany-pets-1.1.0-Portable.exe`
- `release/coding-accompany-pets-Setup-1.1.0.exe`
- 更新 `release/SHA256SUMS.txt` / `release/README.md`
- 旧 `Voice2Prompt-*` 产物可保留为历史，但 README 只指向新文件；如要控制仓库体积，提交时删除旧 `release/` 文件（Git 历史仍保留）。

---

## 7. 构建/验证命令

开发依赖（已存在 `app/node_modules`）：

```bash
cd app && npm install   # 只会拉 electron/electron-builder；runtime 已在 vendor
```

构建（仓库根目录）：

```bash
./app/node_modules/.bin/electron-builder --win portable nsis --publish never
```

测试：

```bash
# 单元（当前 43/43）
for f in app/main/*.unit.test.js app/renderer/*.unit.test.js; do node "$f" || exit 1; done

# 关键 runtime（需要已解锁桌面）
node app/main/screenshot-library.runtime.test.js
node app/main/pet-restore-ui.runtime.test.js
node app/main/pet-actions-v5-settings.e2e.test.js
node app/main/screenshot-vision-p5.e2e.test.js
```

- 截图默认路径用 `electron-screenshots`；旧控制器 `V2P_SCREENSHOT_LEGACY=1` 只用于回退测试。
- 真实 provider 调用仍需显式 env；ASR 已冻结；不要新增真实调用。
- 便携版/安装版测试前先关闭正在运行的 `D:\v2p\Voice2Prompt`（单实例锁）。

---

## 8. 风险/需确认项（公开推送前）

1. **Live2D 专有 core**：`app/renderer/lib/live2dcubismcore.min.js` 不提交源码，但当前 release 二进制包含它。公开 GitHub 分发前确认 Live2D 许可；若不能分发，构建时删除该文件（桌宠回退静态图）再打包。
2. **用户提供的动漫图标**：公开仓库/README 使用需确认版权/授权；若不确定，改用自制图标。
3. **大文件**：两个 exe 各约 74MB（<100MB GitHub 单文件限制），但仓库会增大；注意推送时间/流量。
4. **API key**：配置在 `%APPDATA%`，不在仓库；推送前执行 secret 扫描（`git grep -I "sk-\|b64:"` 检查误提交），不要打印 key。
5. **改名后的 userData**：必须保留旧路径（第 3.3 节），否则用户配置/识图模型丢失。
6. **安装版共存**：appId/产品名改变后，新安装可能与 `D:\v2p\Voice2Prompt` 旧安装共存；先关闭旧实例，必要时卸载旧版。
7. **GitHub 改名权限**：无 gh/token env，GCM 凭据可能只有 git 权限没有 repo API 权限；失败则让用户在网页改名。
8. **不要改 ASR**：用户已冻结；本轮只做改名/图标/README/打包/推送。

---

## 9. 压缩后执行顺序（建议）

1. 读本文件 + 用户最新消息。
2. 生成图标（Pillow），复制原图到 `docs/assets/`；更新 `app/build/icon.ico`、`app/assets/tray.png`。
3. 全局改名：package.json（root + app）、main.js（appId/tray/userData 保护）、settings/palette 标题、README/release/vendor 文档；grep 旧名。
4. 版本 1.1.0；更新 release 产物名/README/SHA256。
5. 重写根 README（第 5 节结构）。
6. 构建 portable + nsis；验证：
   - 启动便携版；
   - 静默安装/启动安装版；
   - 确认 `resources/app/vendor` 和 `.node`；
   - 确认 userData 仍是旧配置（识图模型存在）。
7. 跑单元 43/43 + 关键 runtime。
8. secret 扫描；`git status`；提交（建议 commit message: `feat: rename to coding-accompany-pets with new icon and storefront README`）。
9. 改名 GitHub 仓库（API 或网页）→ `git remote set-url` → `git push -u origin main`。
10. 推送后核对远端 README/Release 下载链接；向用户报告新仓库 URL、产物哈希、测试结果。

---

## 10. 关键文件索引

- 构建配置：`package.json`（root build）、`app/package.json`
- 主进程：`app/main/main.js`（appId/tray/userData）、`app/main/config.js`（配置/迁移）、`app/main/vision-target.js`、`app/main/image-workflow.js`
- 截图：`app/main/screenshot-library.js`、`app/main/window-restore.js`、`app/main/screenshot.js`（回退）
- 设置/桌宠：`app/renderer/settings.html/js`、`app/renderer/pet.html/js`
- 图标：`app/build/icon.ico`、`app/assets/tray.png`、`docs/assets/`（待建）
- vendor：`app/vendor/README.md`、`app/vendor/electron-screenshots/`、`app/vendor/uiohook-napi/`、`app/vendor/pixi/`
- 发布：`release/README.md`、`release/SHA256SUMS.txt`、`release/*.exe`
- 现有状态/证据：`docs/STATE-feedback-v2-final-2026-10-28.md`、`docs/evidence/*`、`docs/TEST-REPORT-feedback-v2.md`
- 本存档：`docs/STATE-coding-accompany-pets-pre-compaction-2026-10-29.md`