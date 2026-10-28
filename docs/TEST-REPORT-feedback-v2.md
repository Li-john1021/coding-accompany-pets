# Feedback v2 测试报告

日期：2026-10-28（Asia/Shanghai）
基线：`d979940`；分支：`codex/screenshot-asr-feedback-v2`
范围：用户首测反馈 U1 截图速度/闪屏、U2 框选后标注、U3 识图、U4 长录音/分段/恢复。

## 结论

- 40/40 个单元测试文件通过。
- 截图生产 runtime 通过：跨屏/混合 DPI 合成像素正确；冷启动 853ms、预热 858ms、跨屏触发 841ms。
- 截图原生单屏验证通过：真实 OS 鼠标完成框选、画笔、文字、撤销、完成、取消；标注画布保持在 80×30 源像素；工具条为选区旁的 438×44 浮条，不再出现全屏深色 editor 页。
- 3 分钟隐藏窗 AudioWorklet 采集通过：真实 wall-clock 181.2s，首/中/尾音调标记完整；双初始化失败会停止麦克风 track 并清掉主进程 recording flag。
- 长音频 ASR 通过：3 分钟输入拆成 6 个 ≤30s 分段并完整重建；35s 录音中段 503 与 `finish_reason=length` 都整体失败、保留恢复、重试成功后才写剪贴板。
- 真实 ASR 通过：97.22s TTS 合成语音拆成 4 段，真实 `mimo-v2.5-asr` 10.3s 返回首/中/尾完整文本。
- 识图通过：未勾多模态时原因可见且不发请求；本地 mock 收到 260×72 PNG；真实 `mimo-v2.6-flash` 1.1s 返回 `V2P-7KQ2`，剪贴板一致。真实配置仅把当前 provider 的 `multimodal` 从 false 改为 true，其他字段未动，已有备份。
- 本轮真实调用计数：ASR 4/10，视觉 1/2；上一轮视觉 8 次不重复。未上传用户桌面或录音。

## 验收映射

| 验收 | 结果 | 证据 |
| --- | --- | --- |
| B01 暖截图耗时/绘制就绪 | 通过：预热 858ms，冷启动 853ms，跨屏 841ms；窗口在 ready 握手后才显示 | `docs/evidence/feedback-capture.txt`，`screenshot-p3.runtime.test.js` |
| B02 画笔/文字/撤销/完成/取消/像素 | 通过：DOM runtime 与真实 OS 输入双覆盖；取消零剪贴板写入；浮条不再占满全屏 | `docs/evidence/feedback-annotation.txt`，`feedback-recovery-panel.png`，`screenshot-native.runtime.test.js` |
| B03 识图原因/开启后跑通 | 通过：gate 原因“请在设置中为当前文字模型勾选多模态”；真实配置开启后 1.1s 识图成功 | `docs/evidence/feedback-recognition.txt`，`vision-e2e.runtime.test.js` |
| B04 三/五分钟采集与尾帧 | 通过：180s 样本测试 + 181.2s 隐藏窗真实采集；flush 后不再收帧 | `docs/evidence/feedback-asr.txt`，`audio-capture.runtime.test.js` |
| B05 分段≤30s/完整覆盖/合并/失败路径 | 通过：5 分钟 10 段字节重建、3 分钟 6 段、真实 97s 4 段；打乱/截断/429/503/超时拒绝 | `docs/evidence/feedback-asr.txt`，`feedback-asr-live.txt` |
| B06 恢复/重试/不自动粘贴/清理 | 通过：失败保留恢复，重试成功后才写剪贴板；恢复面板 300×306 内可命中 | `docs/evidence/feedback-asr.txt`，`feedback-recovery-panel.png` |
| B07 原有回归 | 通过：40/40 单元测试文件；热键/录音/文字/Undo/剪贴板互斥保持 | 本报告 |
| B08 便携包运行 | 构建后补充 | `docs/TEST-REPORT-feedback-v2.md`（构建记录） |

## 真实调用预算

| 类别 | 本轮使用 | 上限 | 说明 |
| --- | --- | --- | --- |
| ASR | 4 | 10 | 97.22s 合成 TTS，4 个 30s 分段 |
| 视觉 | 1 | 2 | `app/main/vision-validation.png`，已知 `V2P-7KQ2` |
| 历史视觉 | 0 新增 | 8 已保留 | 不重复上一轮 8 次 |

所有请求只发送冻结的合成夹具；密钥未打印、未写入证据或提交。

## 关键测试命令

```bash
# 全部单元测试（40 个文件）
for f in app/main/*.unit.test.js app/renderer/*.unit.test.js; do node "$f" || exit 1; done

# 截图生产 runtime（真实 Electron，跨屏/混合 DPI）
node app/main/screenshot-p3.runtime.test.js

# 截图原生单屏验证（真实 OS 鼠标/键盘）
node app/main/screenshot-native.runtime.test.js

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

## 环境与限制

- Windows 10.0.22631 x64；Electron 31.7.7；测试期间显示器扩展为 2560×1440 + 1536×865@1.25。
- 用户明确“基本不会跨屏截图，单屏即可”。原生验收按单屏完成；跨屏合成 runtime 仍保留并通过，但不作为主要验收路径。
- 截图 editor 已按用户选择改为“冻结屏 + 选区原位画布 + 小浮条”。框选时全屏冻结是截图工具通用行为；框选后不再出现全屏深色 editor。
- 恢复面板的完整重试流程由生产 ASR e2e 的真实 renderer 点击覆盖；原生测试验证了 300×306 内布局、按钮可见和 `elementFromPoint` 命中 retry，未再重复 OS 级点击。
- “无黑闪”依据是 ready 握手后才 show 的代码路径和 runtime 可见时 `#screen` 已解码，并非高速摄像观测。
- 真实 provider 调用只使用合成 TTS/验证图；没有上传用户桌面、录音或真实剪贴板内容。用户配置备份 `config.json.bak-vision-1793184768201` 保留在用户 profile 目录。
- 便携包构建与实际启动验证在审查通过后补充；旧 v1 `Voice2Prompt-Screenshot-Vision.exe` 不得作为本轮交付包。