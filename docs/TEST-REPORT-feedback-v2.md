# Feedback v2 测试报告

日期：2026-10-28（Asia/Shanghai）
基线：`d979940`；分支：`codex/screenshot-asr-feedback-v2`
范围：用户首测反馈 U1 截图速度/闪屏、U2 框选后标注、U3 识图、U4 长录音/分段/恢复。

## 结论

- 41/41 个单元测试文件通过。
- 截图默认使用 MIT 的 `electron-screenshots` 0.6.2（React UI 由 `react-screenshots` 0.6.1 MIT 提供，原生捕获为 Apache-2.0 的 `node-screenshots`）：冻结屏 + 选区 + 小浮条，文字工具点哪里就在哪里出现输入框。集成测试实测触发到窗口 956ms、UI 就绪 1044ms；文字框精确出现在点击坐标 (300,300)，最终剪贴板 400×300 图片在对应位置有 356 个文字像素。
- 旧的自研浮条路径保留为库不可用时的回退（`V2P_SCREENSHOT_LEGACY=1` 强制），其跨屏/混合 DPI runtime 和原生 OS 输入测试仍全部通过。
- 3 分钟隐藏窗 AudioWorklet 采集通过：真实 wall-clock 181.2s，首/中/尾音调标记完整；双初始化失败会停止麦克风 track 并清掉主进程 recording flag。
- 长音频 ASR 通过：3 分钟输入拆成 6 个 ≤30s 分段并完整重建；35s 录音中段 503 与 `finish_reason=length` 都整体失败、保留恢复、重试成功后才写剪贴板。
- 真实 ASR 通过：97.22s TTS 合成语音拆成 4 段，真实 `mimo-v2.5-asr` 10.3s 返回首/中/尾完整文本。用户已说明 MiMo 平台侧约 1 分钟限制由他后续处理，本轮不再继续 ASR 工作。
- 识图通过：未勾多模态时原因可见且不发请求；本地 mock 收到 260×72 PNG；真实 `mimo-v2.6-flash` 1.1s 返回 `V2P-7KQ2`，剪贴板一致。真实配置仅把当前 provider 的 `multimodal` 从 false 改为 true，其他字段未动，已有备份。
- 本轮真实调用计数：ASR 4/10，视觉 1/2；上一轮视觉 8 次不重复。未上传用户桌面或录音。

## 验收映射

| 验收 | 结果 | 证据 |
| --- | --- | --- |
| B01 暖截图耗时/绘制就绪 | 通过：默认 MIT 库触发→窗口 956ms、UI 就绪 1044ms；回退路径首/暖/跨屏 1574/1181/796ms。窗口在捕获完成后显示 | `docs/evidence/feedback-screenshot-library.txt`，`feedback-capture.txt` |
| B02 画笔/文字/撤销/完成/取消/像素 | 通过：默认 MIT 库文字框精确点在点击坐标、完成后 400×300 图片含文字像素；回退路径的画笔/文字/撤销/完成/取消与跨屏像素仍通过 | `docs/evidence/feedback-screenshot-library.txt`，`feedback-annotation.txt`，`feedback-recovery-panel.png` |
| B03 识图原因/开启后跑通 | 通过：gate 原因“请在设置中为当前文字模型勾选多模态”；真实配置开启后 1.1s 识图成功 | `docs/evidence/feedback-recognition.txt`，`vision-e2e.runtime.test.js` |
| B04 三/五分钟采集与尾帧 | 通过：180s 样本测试 + 181.2s 隐藏窗真实采集；flush 后不再收帧 | `docs/evidence/feedback-asr.txt`，`audio-capture.runtime.test.js` |
| B05 分段≤30s/完整覆盖/合并/失败路径 | 通过：5 分钟 10 段字节重建、3 分钟 6 段、真实 97s 4 段；打乱/截断/429/503/超时拒绝 | `docs/evidence/feedback-asr.txt`，`feedback-asr-live.txt` |
| B06 恢复/重试/不自动粘贴/清理 | 通过：失败保留恢复，重试成功后才写剪贴板；恢复面板 300×306 内可命中 | `docs/evidence/feedback-asr.txt`，`feedback-recovery-panel.png` |
| B07 原有回归 | 通过：41/41 单元测试文件；热键/录音/文字/Undo/剪贴板互斥保持 | 本报告 |
| B08 便携包运行 | 通过：`Voice2Prompt-1.0.0-Portable.exe` 实际启动；桌宠截图打开打包后的 MIT 冻结屏，500×300 选区显示小浮条，右键取消恢复桌宠；资源包含库与 native 模块 | `docs/evidence/feedback-portable.txt` |

## 真实调用预算

| 类别 | 本轮使用 | 上限 | 说明 |
| --- | --- | --- | --- |
| ASR | 4 | 10 | 97.22s 合成 TTS，4 个 30s 分段 |
| 视觉 | 1 | 2 | `app/main/vision-validation.png`，已知 `V2P-7KQ2` |
| 历史视觉 | 0 新增 | 8 已保留 | 不重复上一轮 8 次 |

所有请求只发送冻结的合成夹具；密钥未打印、未写入证据或提交。

## 关键测试命令

```bash
# 全部单元测试（41 个文件）
for f in app/main/*.unit.test.js app/renderer/*.unit.test.js; do node "$f" || exit 1; done

# 默认截图路径（MIT electron-screenshots：浮条 + 点选文字）
node app/main/screenshot-library.runtime.test.js

# 截图回退路径（旧控制器，强制 legacy）
V2P_SCREENSHOT_LEGACY=1 node app/main/screenshot-p3.runtime.test.js
V2P_SCREENSHOT_LEGACY=1 node app/main/screenshot-native.runtime.test.js

# 3 分钟隐藏窗 AudioWorklet + 失败启动清理
node app/main/audio-capture.runtime.test.js

# 生产 ASR 端到端（长音频/503/length/恢复）
node app/main/asr-e2e.runtime.test.js

# 真实 ASR 4 段验证（会产生 4 次真实调用；不加 env 会跳过）
V2P_ALLOW_REAL_ASR=1 node app/main/asr-live.runtime.test.js

# 识图 gate/mock/真实配置（真实步骤会产生 1 次视觉调用；不加 env 只跑 gate/mock）
V2P_ALLOW_REAL_CONFIG=1 node app/main/vision-e2e.runtime.test.js
```

`V2P_ALLOW_REAL_ASR=1` 和 `V2P_ALLOW_REAL_CONFIG=1` 是显式真实调用门禁；默认不读取真实 provider、不修改用户配置。原生截图证据默认写临时目录，设置 `V2P_EVIDENCE_DIR=docs/evidence` 才写仓库证据。

## 独立审查与修复（2026-10-28）

第一轮干净独立审查（`docs/audits/feedback-v2-1.json`）判 fail，指出两个 major，已修复：

- **Save 锁死**：MIT UI 的“保存”按钮原先只触发库的 save/endCapture，wrapper 不 settle，导致桌宠隐藏、`imageWorkflow.busy` 永久为 true。现在 wrapper 监听 `save`，`preventDefault` 后弹保存对话框、写 PNG、正常 `endCapture` 并 settle（取消保存则保持截图界面可用）。单测覆盖保存成功/取消。
- **无超时/窗口关闭兜底**：现在有 60s 上限、`windowClosed`/窗口 `closed` 监听，以及 2s 的 UI 绘制就绪检查；失败统一 settle 为 `capture-failed`，再由 main 回退到旧控制器。库 UI 静默空白不会再永久锁住 app。
- 其他修复：重复 ok/cancel 防抖；热键截图成功消息改为 info 级别，不再触发错误样式；启动时预创建库实例（warm），并增加第二次捕获的 warm 计时测试；识图 gate/mock 不再读取真实配置，真实步骤仍需 `V2P_ALLOW_REAL_CONFIG=1`；ASR 后交付异常仍保留 recoveryId；超时错误信息改为通用 “Request timed out”；文档 41/41 与 asar:false 表述已修正。默认库路径的抓屏改由已验证的快速 capture worker 供图，避免 `node-screenshots` 在当前桌面会话偶发失败。
- 残留风险：MIT 库窗口在冻结图送达前显示，理论上仍可能有短暂 live-desktop 闪烁；本轮未做高速摄像验证。`setOpacity` 在透明 kiosk 窗口上不可靠，已回退该方案。
- **屏幕 runtime 复跑阻塞**：审查修复期间 Windows 会话被锁定，`Graphics.CopyFromScreen` 报“句柄无效”，`node-screenshots` 报 desktop 错误；因此修复后的 `screenshot-library.runtime.test.js`、回退 runtime 与便携包冒烟需要在会话解锁后重跑。屏幕锁定前的证据（MIT 库文字点选、便携版小浮条）仍然有效，但不能替代修复后的最终 runtime。

## 环境与限制

- Windows 10.0.22631 x64；Electron 31.7.7；测试期间显示器扩展为 2560×1440 + 1536×865@1.25。
- 用户明确“基本不会跨屏截图，单屏即可”。默认截图路径使用 `electron-screenshots`（MIT），它按鼠标所在显示器单屏捕获；旧跨屏控制器保留为回退，仅由 `V2P_SCREENSHOT_LEGACY=1` 启用。
- 依赖：`app/package.json` 直接依赖 `electron-screenshots@0.6.2`（MIT）；`react-screenshots@0.6.1`（MIT，预构建 UI）与 `node-screenshots@0.2.8`（Apache-2.0，Windows 预构建 native 模块）是它的传递依赖。构建使用 `"asar": false`，资源位于 `resources/app/node_modules`，native 模块可加载；Electron 31 与便携版均已实测。
- 用户已说明 MiMo ASR 平台侧约 1 分钟限制由他后续处理；本轮保留 4 段真实 ASR 证据，不再继续 ASR 修改。
- 恢复面板的完整重试流程由生产 ASR e2e 的真实 renderer 点击覆盖；原生回退测试验证了 300×306 内布局、按钮可见和 `elementFromPoint` 命中 retry。
- “无黑闪”依据是默认库先捕获后显示窗口，以及回退路径 ready 握手后才 show 的代码路径；并非高速摄像观测。
- 真实 provider 调用只使用合成 TTS/验证图；没有上传用户桌面、录音或真实剪贴板内容。用户配置备份 `config.json.bak-vision-1793184768201` 保留在用户 profile 目录。
- 便携包已构建并实测：`app/dist-exe/Voice2Prompt-1.0.0-Portable.exe`（75,637,263 bytes）。为让 MIT 库的预构建 HTML/静态资源从 `file://` 正常加载，构建配置使用 `"asar": false`；资源在 `resources/app/node_modules/...`，native `node-screenshots` 与 `uiohook-napi` 均已包含。实测便携版：桌宠截图 → 冻结屏 → 500×300 选区 → 小浮条显示 → 右键取消恢复桌宠。旧 v1 `Voice2Prompt-Screenshot-Vision.exe` 不得作为本轮交付包。