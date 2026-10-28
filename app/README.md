# coding-accompany-pets（客户端）

> 按住宠物说话 → 语音转文字 → AI 整理/优化 → 直达光标；
> 按 `Alt+A` 框选截图 → 独立识图模型读字。
> 技术栈：Electron 31 + Node，运行时代码已 vendor，最终产物不需要 Node/npm。

面向用户的下载、安装和玩法说明在仓库根目录的 [README](../README.md)。

## 启动

```bash
cd app
npm install   # 只安装 electron / electron-builder 两个开发依赖
npm start
```

启动后：

- 屏幕角落出现宠物悬浮窗（可拖动、滚轮缩放）
- 托盘出现图标；关闭设置窗口不退出，托盘菜单可退出
- 首次启动未配置模型时会自动打开设置页

## 当前交互

| 操作 | 效果 |
|---|---|
| 长按宠物 / 单击宠物 | 取决于设置里的「宠物交互方式」：长按录音，或单击开始/结束 |
| 拖动宠物 | 移动悬浮窗（长按模式下拖动会取消录音） |
| 滚轮 | 缩放宠物 |
| 全局热键（默认 `Alt+X`） | 按一下开始录音，再按一下结束；可在设置中录制修改 |
| 截图热键（默认 `Alt+A`） | 框选屏幕区域，PNG 写入剪贴板 |
| 鼠标侧键（可选） | 开始/结束录音 |

## 模型配置

设置页有三个互相独立的模型列表，可各加多条、单选当前使用：

1. **语音模型（ASR）**：OpenAI 兼容 `transcriptions`，或小米 MiMo `chat` 音频协议。
2. **文字模型（LLM）**：任意 OpenAI 兼容 `/chat/completions` 端点。
3. **识图模型（Vision）**：任意 OpenAI 兼容视觉端点，与文字模型是否多模态无关。

旧配置里勾选过「多模态」的模型会自动迁移成独立识图模型。

## 配置存储

- 配置目录沿用改名前的 `%APPDATA%\Voice2Prompt`（`app.setPath('userData', ...)`），
  因此升级/改名不会丢模型、皮肤和录音恢复数据。
- API Key 仅 base64 混淆，不是加密；配置文件不要提交到公开仓库。

## 构建

在仓库根目录执行（产物在 `app/dist-exe/`）：

```bash
./app/node_modules/.bin/electron-builder --win portable nsis --publish never
```

## 运行时依赖

`app/vendor/` 存放随包分发的第三方运行时代码及许可证清单，详见
[`vendor/README.md`](vendor/README.md) 与根目录 [README](../README.md) 的 Credits 部分。