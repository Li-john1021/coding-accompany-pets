# Voice2Prompt

> 按快捷键(或鼠标侧键)说话 → 语音转写 → AI 整理优化 → **自动粘贴进光标**。
> 配一只会替你"听写打字"的 BongoCat 键盘猫,和一个把猫随便换装的皮肤工坊。

Windows 桌面工具,基于 Electron,完全本地运行,仅调用你自己配置的云端模型 API。

## 功能

- **语音直出**:全局热键 / 鼠标侧键 / 长按猫 / 单击猫 触发录音,说完自动把整理结果写进光标
- **三模型配置**:ASR、文字模型、识图模型分离;识图模型独立于文字模型,纯文本文字模型也能配任意 OpenAI 兼容视觉模型识图
- **BongoCat 桌宠**:Live2D 键盘猫,听写时戴耳机/敲键盘,录音气泡台词;滚轮缩放、置顶保活
- **创建皮肤**:19 零件上色画板(描边锁定画不成型)→ 起名一键生成皮肤;支持无缝平涂、正圆眼睛、修改/删除皮肤,无需重启实时切换
- **快捷键捕获**:点击「录制」后按任意组合键即完成,无需手打
- **截图识图**:按 `Alt+A` 或点击截图框选并复制 PNG;点击识图用独立配置的识图模型转写,只把文字写入剪贴板

## 直接使用（无需安装依赖）

仓库的 `release/` 目录已提供两个自包含产物,内置 Electron 与全部运行时代码,不需要 `npm install`:

- `release/Voice2Prompt-FeedbackV2.3-Setup-1.0.0.exe` — 安装版(NSIS,可选择安装目录)
- `release/Voice2Prompt-FeedbackV2.3-1.0.0-Portable.exe` — 便携版(双击运行)

首次启动会打开设置页:填入 ASR、文字模型与识图模型的 Base URL + API Key + 模型名即可。旧版配置会自动迁移:原来勾选多模态的模型会成为识图模型。

## 从源码运行/开发

运行时第三方代码已经 vendor 到 `app/vendor/`,不再需要 `npm install electron-screenshots/uiohook-napi/pixi`;`npm install` 只装 Electron 与 electron-builder 两个开发依赖:

```bash
cd app
npm install
npm start
```

打包(在仓库根目录执行,产物在 `app/dist-exe/`):

```bash
./app/node_modules/.bin/electron-builder --win portable nsis --publish never
```

## 截图与识图

- 默认截图快捷键为 `Alt+A`;在设置页录制器中可更改截图快捷键,并与录音快捷键分别保存。
- 按截图快捷键或点击桌宠的截图按钮,拖动框选屏幕区域并确认。成功后 PNG 图片会复制到系统剪贴板;按 `Esc` 取消。
- 设置页的「识图模型（Vision）」是独立列表:添加任意 OpenAI 兼容视觉端点并设为当前即可识图,与文字模型是否多模态无关。识图按钮仅在该模型配置完整、剪贴板含有实际图片且没有冲突操作时启用。
- 图片也可从其他应用复制后识别。点击「识图」后，结果文字只写入剪贴板，不会自动粘贴或继续优化；随后可将文字交给常规文本操作。
- 识图模型的「校验」会向该端点发送一张内置校验图,不会在启动或后台轮询时自动调用模型。
- 第三方运行时代码及许可证清单见 `app/vendor/README.md`;`app/node_modules` 不随仓库分发,只有重新构建时才需要。

> **Live2D 运行时**:Cubism Core(`app/renderer/lib/live2dcubismcore.min.js`)为
> Live2D 专有组件,源码仓库不提交,需从 [Live2D 官网](https://www.live2d.com/sdk/download/web/)
> 下载 Cubism SDK for Web 并将 `live2dcubismcore.min.js` 放到上述路径。当前 `release/`
> 产物由本机构建,包含本机已下载的该文件;对外分发前请确认 Live2D 的再分发条款。

## 目录

```
app/            Electron 客户端(语音管线 / 桌宠 / 画板 / 设置)
  assets/models/keyboard    内置 BongoCat 键盘猫皮肤(来自 ayangweb/BongoCat,MIT)
  assets/paint_kit          画板零件素材(描边/可画区掩码)
  assets/skin-base/keyboard 生成皮肤的基座皮肤
docs/skin-guide.md            自定义皮肤指南
```

## 许可

- 本项目代码:MIT(见 LICENSE)
- Live2D Cubism SDK 运行时:Live2D Proprietary(自行下载,不分发)
- 内置键盘猫模型:来自 [ayangweb/BongoCat](https://github.com/ayangweb/BongoCat)(其模型文件以该仓库为准)
