# Release artifacts · v1.2.0

两件产物都是自包含的：内置 Electron 运行时和 `app/vendor/` 下的全部第三方运行时代码，
不需要 `npm install`、Node.js 或网络。

| 文件 | 大小 | 用途 |
|---|---|---|
| `coding-accompany-pets-Setup-1.2.0.exe` | 77,352,948 bytes | NSIS 安装版；可选择安装目录，创建桌面快捷方式 |
| `coding-accompany-pets-1.2.0-Portable.exe` | 77,003,778 bytes | 便携版；双击直接运行，不写安装目录 |

校验值见 `SHA256SUMS.txt`。

## v1.2.0 主要变化

- 第三方 Live2D / BongoCat 皮肤导入：设置页支持 zip / 文件夹，包内任意层级有 `*.model3.json` 即可。
- 内置 DeepSeek 大肥鱼（MOC3 v6），打包产物已包含 Cubism Core 6.0.1。
- 渲染统一 `sceneRoot`、自动裁边、按皮肤比例调整宠物窗、参数能力探测（单/双手、鼠标、嘴、呼吸）。
- 设置页支持“复制到项目内置目录”，方便开发时把皮肤随仓库分发。
- 内置皮肤来源与 BongoCat 生态致谢见根 README。

## 安装/运行

- 安装版：双击 Setup，选择目录后安装；首次启动打开设置页。
- 便携版：双击 Portable；首次启动同样打开设置页。
- 配置、模型、录音恢复数据保存在 `%APPDATA%\Voice2Prompt`，与安装目录无关。
  这是改名前的配置目录，1.1.0 起显式沿用，升级不会丢模型和皮肤。
- 旧版配置会自动迁移：原来勾选“多模态”的文字模型会成为独立识图模型。
- 安装版与旧版 `Voice2Prompt` 的 appId 不同，可以并存；确认新版可用后再卸载旧版。

## 验证记录（2026-10-29）

- 单元测试通过：`skin-pack`、`pet-window-layout`、`pet-actions-ui`、`pet-status`。
- 皮肤渲染通过：大肥鱼、内置键盘猫、罗小黑、小熊猫昊昊、小键盘、乃琳、阮梅、逍遥散人。
- 打包内容：`resources/app` 下无 `node_modules`；`renderer/lib/live2dcubismcore.min.js` 228,042 bytes（Core 6.0.1）；`assets/models/deepseek` 3.1 MB。
- `win-unpacked` 与 Portable 版均启动成功，并加载大肥鱼（窗口 376×465，状态“点我开始听”）。

## 说明

- `app/vendor/README.md` 列出每个上游项目、版本、许可证和保留的文件。
- Live2D Cubism Core（`app/renderer/lib/live2dcubismcore.min.js`）是 Live2D 专有运行时。
  源码仓库不提交该文件；本机构建的 release 产物包含本机已下载的副本。
  对外再分发前请自行确认 Live2D 条款；没有该文件时桌宠回退静态图片，其他功能不受影响。
- 重新构建需要 Electron 与 electron-builder 两个开发依赖；运行时和最终产物不需要它们。
  构建命令见仓库根 README。