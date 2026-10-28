# Feedback v2 最终状态（compact 交接）

日期：2026-10-28（Asia/Shanghai）
用途：上下文压缩前保存当前关键状态；本文件取代 `docs/HANDOFF-feedback-v2-2026-10-28.md` 的“未完成”状态，但保留旧文件作历史。

## 1. 当前结论

本轮工作已完成、已合回主项目、已构建并冒烟最终便携包。没有必须继续的 blocker。

- 主项目：`D:/MyVibeProj/My_Agent_Team/voice2prompt-open`，分支 `main`，HEAD `6718bc7`（本状态文档提交后 main 会再前进一个 docs commit）。工作区干净，未推送远端（`origin/main` 本地 ahead 39，推送前先确认）。
- 修复 worktree：`D:/MyVibeProj/My_Agent_Team/voice2prompt-open-feedback`，分支 `codex/screenshot-asr-feedback-v2`，HEAD `6718bc7`。该分支已 fast-forward 合入 main。
- 最终交付包（主项目）：`app/dist-exe/Voice2Prompt-FeedbackV2-1.0.0-Portable.exe`
  - 75,721,706 bytes
  - SHA-256 `af079f1dd475e22a81837dbbca016530eb967ea0d22d61871c81100699bd55e9`
  - 旧 v1 的 `Voice2Prompt-Screenshot-Vision.exe` 仍在同目录，**不是本轮包**。
- 构建源包（feedback worktree）：`app/dist-exe/Voice2Prompt-1.0.0-Portable.exe`，同代码。
- 最终便携包已实际启动验证：桌宠截图 → 冻结屏 → 500×300 选区 → 小浮条 → 保存点击不锁死 → 右键取消恢复桌宠；测试实例已关闭。

## 2. 用户明确决定

- 截图交互采用**冻结屏 + 选区旁小浮条**，不要全屏深色 editor 页。
- **单屏截图即可**，不要求跨屏主路径；跨屏旧控制器只保留为回退。
- 标注 UI 要复用 MIT 开源，不要继续自研劣质轮子；文字必须能点哪里放哪里。
  - 已采用 `electron-screenshots@0.6.2`（MIT）+ `react-screenshots@0.6.1`（MIT，预构建 UI）+ `node-screenshots@0.2.8`（Apache-2.0，native；默认路径实际用 worker 供图）。
- 识图功能要实际跑通，不能只是显示原因；当前 provider 已显式开启多模态。
- ASR：用户怀疑 MiMo 平台侧约 1 分钟限制，**明确说不需要继续处理 ASR，后续自己处理**。不要再改 ASR 功能、不要新增真实 ASR 调用，除非用户重新授权。

## 3. 截图最终架构

### 默认路径（MIT UI）

- `app/main/screenshot-library.js`
  - 包装 `electron-screenshots`，`singleWindow:true`，中文 tooltip。
  - `captureImage` 注入：由 `app/main/main.js` 的 `captureLibraryDisplay()` 调用已验证的 `screenshotCaptureWorker` 抓当前鼠标所在显示器，返回 data URL。这样绕过 `node-screenshots` 在部分桌面会话的失败，也避免库自带 desktopCapturer 多屏 source 匹配问题。
  - 抓图前隐藏所有可见 app 窗口（除 title `screenshots`），捕获后恢复。
  - 处理 `ok`（preventDefault，写剪贴板，settle）、`cancel`、`save`（保存对话框 + PNG 写入 + settle；取消保存保持截图 UI 可用）、`windowCreated/closed/windowClosed`、60s 启动超时、2s UI 就绪检查、重复事件 settling 防抖。
  - UI 就绪后清除 60s 定时器，避免长标注被误中止。
  - `warm()` 在 app 启动时预创建库实例。
- `app/main/main.js::initializeScreenshotController()`
  - `createScreenshotLibrary({ captureImage })` + `warm()`；`screenshotCaptureWorker.warm()` 保留（默认路径用）。
  - `captureScreenshot()`：默认走库；库返回非 ok/cancelled 或抛错时回退旧控制器；`V2P_SCREENSHOT_LEGACY=1` 强制旧路径（只用于回归测试）。
- 文字点选：库的 `textarea` 按点击坐标定位。实测点击 (300,300)，textarea `left=300/top=300`；最终 400×300 剪贴板图片有 356 个文字像素。

### 回退路径（旧自研，仍保留）

- `app/main/screenshot.js`、`screenshot-capture-worker.js`、`screenshot-preload.js`、`app/renderer/screenshot.html/js`、`screenshot-annotation.js`、`screenshot-compose.js`、`screenshot-native-capture.js`、`screenshot-geometry.js`。
- 旧路径也是“冻结屏 + 小浮条 + 选区原位画布”，没有全屏 editor 页。
- 旧 runtime 测试通过，但只在 `V2P_SCREENSHOT_LEGACY=1` 下运行。
- 不要把它重新设为默认，除非用户明确要求回退。

### 依赖/打包

- `app/package.json` 直接依赖 `electron-screenshots`；`app/package-lock.json` 锁定版本和传递依赖。
- Git 仓库**不包含 node_modules**（.gitignore）。如果从主项目源码跑：在 `voice2prompt-open/app` 执行 `npm install`（或 `npm ci`）安装新依赖。
- feedback worktree 的 `app/node_modules` 已在 npm install 时从 junction 变成真实目录（约 137MB，ignored）；主项目原始 node_modules 未被删除。**不要删除主项目的 node_modules。**
- 构建配置（根 `package.json`）：
  - `"asar": false`：MIT 预构建 HTML/静态资源通过 file:// 加载，asar 下曾出现空白 UI。
  - `"electronDist": "app/node_modules/electron/dist"`：网络下载 Electron 不稳定时离线打包。
  - 构建命令：`./app/node_modules/.bin/electron-builder --win portable --publish never`
  - 资源在 `resources/app/node_modules/...`；asar 关闭，native `node-screenshots`/`uiohook-napi` 正常。

## 4. 识图最终状态

- 真实配置 `%APPDATA%/Voice2Prompt/config.json`：
  - active LLM：`b52kdw0d` / `mimo-v2.6-flash`；`multimodal` 已从 false 改为 **true**，其他字段未动。
  - 备份：`config.json.bak-vision-1793184768201`（同目录；含 key，勿提交/打印）。
  - active ASR：`rf7h18j2` / `mimo-v2.5-asr`，显式 `asrProtocol: chat`。
- 验证据 `docs/evidence/feedback-recognition.txt`：
  - gate：multimodal=false 时原因“请在设置中为当前文字模型勾选多模态”，recognize 直接失败、不发请求。
  - mock：本地请求体正确，收到 260×72 PNG，剪贴板匹配。
  - real：1 次视觉调用，1102ms，返回 `V2P-7KQ2`，剪贴板一致。
- 本轮真实调用预算：视觉 1/2，ASR 4/10；上一轮视觉 8 次保留不重复。未上传用户桌面/录音。
- 不要为了省事去掉多模态门控；不要静默按模型名开启。

## 5. ASR 状态（已冻结）

- 用户已明确 ASR 平台问题自己处理；不要再继续实现/真实调用。
- 已有改动已提交并合入 main：
  - `audio-chunks.js`/`audio-recovery.js`、worklet `audio-capture-worklet.js`、`models.transcribeSmart` 分段、`pipeline.run` 恢复、`pet.js` 采集/恢复面板、主进程恢复 IPC。
  - 3 分钟隐藏窗真实 wall-clock 采集 181.23s，首/中/尾标记完整；双初始化失败清理。
  - 生产 ASR e2e（localhost mock）：3 分钟 6 段、35s 录音中段 503/length 拒绝、恢复重试不自动粘贴。
  - 真实 ASR：97.22s TTS 4 段，10.3s 返回首/中/尾文本；证据 `docs/evidence/feedback-asr-live.txt`。
- 证据/报告：`docs/evidence/feedback-asr.txt`、`docs/evidence/feedback-asr-live.txt`。

## 6. 测试与审查（可复现命令）

工作目录：`D:/MyVibeProj/My_Agent_Team/voice2prompt-open-feedback`。

```bash
# 41 个单元测试
for f in app/main/*.unit.test.js app/renderer/*.unit.test.js; do node "$f" || exit 1; done

# 默认 MIT 截图路径（需要解锁的交互桌面；白窗夹具）
node app/main/screenshot-library.runtime.test.js

# 回退路径（测试自己设置 V2P_SCREENSHOT_LEGACY=1）
node app/main/screenshot-p3.runtime.test.js
node app/main/screenshot-native.runtime.test.js

# 识图 gate/mock（默认不含真实调用）
node app/main/vision-e2e.runtime.test.js

# 生产 ASR e2e（本地 mock）
node app/main/asr-e2e.runtime.test.js

# 真实调用门禁（用户已冻结 ASR，不要再跑；视觉也需要用户同意）
V2P_ALLOW_REAL_ASR=1 node app/main/asr-live.runtime.test.js
V2P_ALLOW_REAL_CONFIG=1 node app/main/vision-e2e.runtime.test.js
```

最近结果：
- 单元：41/41 PASS。
- 主动截图最终 runtime：首次 1054ms 到窗口、1114ms UI；第二次 warm 773ms；textarea 300/300；356 文字像素；最终 400×300；warm 取消正常。
- 回退 p3：1007/938/817ms；40×30 crop、80×30 跨屏像素；native 80×30、画笔/撤销/文字/完成/取消、恢复面板命中。
- 识图 gate/mock：PASS；真实 1102ms 证据保留。
- 审查：
  - `docs/audits/feedback-v2-1.json`：FAIL（F-001 Save 锁死、F-002 无超时/窗口关闭兜底）。
  - `docs/audits/feedback-v2-2.json`：PASS（无 blocker/major）。R2-01/R2-03 已修；R2-02 save dialog 永不返回是 minor residual；flash 是 residual。
- 最终便携包 75,721,706 bytes，hash `af079f1d...`，冒烟通过。

## 7. 环境坑/注意事项

- 屏幕 runtime/便携包冒烟需要**已解锁的交互式 Windows 桌面**。会话锁定时 `Graphics.CopyFromScreen` 报“句柄无效”、`node-screenshots` 报 desktop 错误；解锁后已复跑通过。遇到同类错误先检查会话是否锁定，不要误判为代码回归。
- `app/node_modules`：feedback worktree 是 npm 生成的真实目录；主项目原依赖未删；不要 reset/clean 或删除 junction 目标。
- 构建 Electron 下载不稳定时用 `electronDist` 本地 dist；不要反复依赖 GitHub。
- asar:false 是有意为之，用于 MIT 预构建 UI 的 file:// 资源；重新启用 asar 需要重新验证 UI 加载，否则可能复现空白窗口/锁死。
- 便携包内资源已自包含；主项目源码运行需在 `app` 下 `npm install`。
- 不要推送 origin/main；用户只授权本地提交/交付。

## 8. 如果没有新指示，不要做

- 不要再改 ASR（用户已冻结）。
- 不要把截图默认路径改回旧自研控制器；不要恢复全屏深色 editor。
- 不要去掉识图多模态门控，不要把当前 provider 的 multimodal 改回 false。
- 不要做新的真实 provider 调用、不要上传用户桌面/录音、不要打印密钥。
- 不要删除旧 worktree/历史证据；不要 reset/clean 工作区。
- 不要在未解锁桌面时把屏幕 runtime 失败当成产品失败。

## 9. 关键文件索引

- 截图默认：`app/main/screenshot-library.js`、`app/main/main.js`
- 截图回退：`app/main/screenshot.js`、`app/renderer/screenshot.html`、`app/renderer/screenshot.js`
- 截图 worker：`app/main/screenshot-capture-worker.js`
- 识图：`app/main/image-workflow.js`、`app/main/models.js`（`transcribeImage`）、`app/main/vision-prompts.js`
- ASR：`app/main/audio-chunks.js`、`app/main/audio-recovery.js`、`app/renderer/audio-capture-worklet.js`、`app/main/pipeline.js`、`app/renderer/pet.js`
- 报告/证据：`docs/TEST-REPORT-feedback-v2.md`、`docs/evidence/*`
- 审查：`docs/audits/feedback-v2-1.json`、`docs/audits/feedback-v2-2.json`
- 旧交接（历史）：`docs/HANDOFF-feedback-v2-2026-10-28.md`
## 10. 用户真实测试后的增量修复（2026-10-28 晚）

用户实际使用后报告两个问题，已修复并交付新便携包；本节覆盖前面的“无待办”结论。

### 10.1 桌宠截图后拖不动/无法交互

- 根因（原生 OS 输入探针复现）：`focusable:false` 的桌宠窗口在 `hide()`→`show()` 后，Windows/Electron 不再投递 **mousedown**（mousemove、mouseup、wheel 仍到达）。可聚焦窗口不受影响；真实改变一次窗口尺寸即可恢复，这解释了用户“滚轮后就能拖”。
- 修复：`app/main/window-restore.js::showAndStabilize()`——show 后对非可聚焦窗口高度 +1px，160ms 后恢复；保留 settle 期间用户移动的位置；用户缩放/改尺寸则放弃恢复；重复 show 先结算上一次。接入 MIT 截图恢复、旧控制器恢复、托盘重新显示。
- 回归：`app/main/window-restore.unit.test.js`；`app/main/pet-restore-ui.runtime.test.js`（生产 Electron + 真实 OS 拖拽 + 真实 MIT 截图 + mock 识图）截图前后拖拽均 60×40、down=1。

### 10.2 识图不可用/无反馈

- 链路确认正常：按钮 → `v2p:recognize-image` → `imageWorkflow.recognize()` → 剪贴板 PNG → 多模态门控 → `models.transcribeImage` → 结果写剪贴板。真实 `mimo-v2.6-flash` 对 900×560 合成图 3649ms 正确转写。
- 用户侧无法使用的主要原因是不可识图时按钮 disabled，点击无任何反馈。现在：不可用时按钮可点击（`.is-disabled` 视觉 + `aria-disabled`）并弹原因气泡；可用时点击立即弹“正在读取图片中…”，成功“识图完成，文字已复制”，失败展示真实错误。
- 回归：`pet-restore-ui.runtime.test.js` 校验气泡时序、mock 请求含 `image_url`、剪贴板结果。

### 10.3 测试与交付

- 单元 42/42 PASS；默认截图+识图 UI runtime PASS；旧控制器 p3/native runtime PASS。
- 新便携包（主项目）：`app/dist-exe/Voice2Prompt-FeedbackV2.1-1.0.0-Portable.exe`
  - 75,726,454 bytes
  - SHA-256 `99ddc840d9f1cbb380164823f13377c33a074d425dd4fb4260c8d8983a0a3599`
  - 已实际启动；旧 `Voice2Prompt-FeedbackV2-1.0.0-Portable.exe` 仍是上一版，勿混用。
- 证据：`docs/evidence/feedback-ui-fixes.txt`；报告追加段落见 `docs/TEST-REPORT-feedback-v2.md`。
- ASR 仍未改动。识图真实调用只用了合成图；未上传用户桌面/录音。

## 11. 识图模型独立设置（2026-10-29）

用户要求把识图模型与文字模型彻底分开，并去掉文字模型上的“多模态”勾选。

### 11.1 新结构

- 配置新增 `visionProviders: [{id,name,baseUrl,apiKey,model}]` 和 `activeVisionId`，与 `llmProviders`/`activeLlmId` 完全独立。
- 设置页新增“🖼️ 识图模型（Vision）”卡片：添加/删除/设为当前/独立校验（内置 V2P-7KQ2 图）。
- 文字模型行不再有多模态勾选；识图门控只要求识图模型有 baseUrl + model。
- 纯文本文字模型（DeepSeek/GLM 等）现在可以配任意 OpenAI 兼容视觉模型来识图；识图结果仍只写剪贴板。

### 11.2 迁移

- 首次加载旧配置时，若 `visionProviders` 为空且存在 `multimodal === true` 的文字模型（优先当前激活），自动复制为识图模型（id `vision-<原id>`，名称加“（识图）”，保留 endpoint/model/key），随后删除所有文字模型上的 `multimodal` 并立即保存。
- 用户当前 MiMo 配置已验证：迁移后 `visionProviders` 1 条、`activeVisionId` 有效、模型 `mimo-v2.6-flash`、key 仍为 `b64:` 掩码；文字模型仍是 MiMo。
- 如果用户删除识图模型，识图按钮提示“请先在设置中配置识图模型”。
- 注意：配置迁移后，旧 V2.1 包不会再识别识图（它只认 multimodal），请使用 V2.2。

### 11.3 回归

- 单元 **43/43 PASS**（新增 `vision-target.unit.test.js`；更新 config/vision IPC/validator 用例）。
- vision gate/mock PASS；settings E2E 四场景 PASS；P5 vision E2E PASS；pet-restore-ui PASS；p3/native PASS。
- 本轮无真实 provider 调用；迁移探针只读真实配置临时副本，未上传内容、未打印密钥。
- 证据：`docs/evidence/feedback-vision-settings.txt`。

### 11.4 交付

- 新包（主项目）：`app/dist-exe/Voice2Prompt-FeedbackV2.2-1.0.0-Portable.exe`
  - 75,728,005 bytes
  - SHA-256 `9c1a693d683b628445037f2cd6ec3163dd20e7db7948e63b5f9a406a723ddc8a`
- 旧 V2.1 保留；V2.2 首次启动自动迁移配置。ASR 未改动。
