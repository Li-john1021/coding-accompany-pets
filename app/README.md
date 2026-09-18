# Voice2Prompt 客户端（阶段四 4.1~4.4）

> 独立桌面应用：按住宠物说话 → 语音转文字 → AI 整理+优化 → 直达光标。
> 技术栈：Electron 31 + Node（零第三方运行时依赖，全部原生实现）。

## 启动

```powershell
cd voice2prompt\app
npm start        # 依赖已安装；若换机器先 npm install
```

启动后：
- 屏幕角落出现**宠物悬浮窗**（可拖到任意位置）
- 托盘出现图标（右键可退出；应用常驻后台，关窗口不退出）
- 首次启动因未配置模型会自动打开设置页

## 使用

| 操作 | 效果 |
|---|---|
| **长按宠物** | 开始录音（红点闪烁），松开结束并自动跑管线 |
| **拖动宠物** | 移动悬浮窗位置（拖动会取消录音） |
| **单击宠物** | 打开设置窗口 |
| **全局热键** `Ctrl+Shift+Space` | 按一下开始录音，再按一下结束（可在设置中改） |
| 托盘 → 设置 | 打开模型管理 |

管线状态会显示在宠物下方的状态条：聆听 → 语音转文字 → 整理优化 → 写入光标 → 完成。
结果自动粘贴到当前光标处（若目标应用拦截模拟粘贴，会兜底为仅复制到剪贴板）。

## 模型配置（重点）

设置页有两个**互相独立**的模型列表，可各加多个、随时切换（单选按钮 = 当前使用）：

1. **🔊 语音模型（ASR）**：Base URL + API Key + 模型名，支持两种协议（行内下拉选择）：
   - **transcriptions**（OpenAI 兼容 `/audio/transcriptions`）：OpenAI（whisper-1）、Groq、SiliconFlow 等。
   - **chat（MiMo）**（音频走 `/chat/completions` 多模态，仅收 wav）：小米 MiMo，配置见下表。
2. **✨ 文字模型（LLM）**：Base URL + API Key + 模型名，调用 `/chat/completions`。
   兼容：OpenAI、DeepSeek、Moonshot、小米 MiMo（mimo 系列）、Ollama（`http://localhost:11434/v1`）等。

**小米 MiMo 配置参考**（按官方文档）：

| 项 | 值 |
|---|---|
| 协议 | chat（MiMo） |
| Base URL | `https://api.xiaomimimo.com/v1` |
| 模型名（ASR） | `mimo-v2.5-asr` |
| API Key | MiMo 控制台获取 |

每条模型旁的 **"校验"按钮**：发一个最小探测请求验证认证/模型名/网络是否真的能调通
（ASR 用 0.3 秒静音音频探测），✅ 才建议使用，防止配了个无法调用的模型。

Base URL 填到 `/v1` 即可（如 `https://api.deepseek.com/v1`）；填全路径也兼容。

## 宠物自定义

- 设置页 → 宠物形象 → "选择图片…"，挑任意 png/jpg/gif/webp 即可（把喜欢的图发给我也行，我帮你放进代码）
- 当前默认形象：`assets/pet.png`
- 状态动画：待机呼吸 / 录音红圈 / 处理蓝圈 / 完成绿圈

## 配置存储

- 配置文件：`%APPDATA%\voice2prompt\config.json`（API Key 仅 base64 混淆，非加密，个人使用）
- 设置页"打开配置目录"可直达

## 已知限制

- 录音统一输出 16k 单声道 WAV（兼容 transcriptions 与 MiMo chat 两种协议）
- ASR 为"录完整段后一次性转写"，非边说边转写的流式模式
- 模拟粘贴（SendKeys）在个别高权限应用中可能被拦截 → 自动降级为剪贴板
- 未做打包安装器（个人使用，`npm start` 即可）；需要时再加 electron-builder
