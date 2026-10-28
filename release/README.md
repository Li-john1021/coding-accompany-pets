# Release artifacts

两件产物都是自包含的：内置 Electron 运行时和 `app/vendor/` 下的全部第三方运行时代码，不需要 `npm install`、Node.js 或网络。

| 文件 | 大小 | 用途 |
|---|---|---|
| `Voice2Prompt-FeedbackV2.3-Setup-1.0.0.exe` | 74,305,527 bytes | NSIS 安装版；可选择安装目录，创建桌面快捷方式 |
| `Voice2Prompt-FeedbackV2.3-1.0.0-Portable.exe` | 74,057,544 bytes | 便携版；双击直接运行，不写安装目录 |

校验值见 `SHA256SUMS.txt`。

## 安装/运行

- 安装版：双击 Setup，选择目录后安装；首次启动打开设置页。
- 便携版：双击 Portable；首次启动同样打开设置页。
- 配置、模型、录音恢复数据保存在 `%APPDATA%\Voice2Prompt`，与安装目录无关。
- 旧版配置会自动迁移：原来勾选“多模态”的文字模型会成为独立识图模型。

## 验证记录（2026-10-29）

- 便携版启动：Electron 主进程 + 渲染进程正常拉起。
- 安装版静默安装：退出码 0；NSIS 沿用了本机已有的安装位置 `D:\v2p\Voice2Prompt` 并升级，安装目录内 `resources/app/vendor` 与两个原生 `.node` 均存在；安装后的 `Voice2Prompt.exe` 启动正常。
- 无 `app/node_modules` 的源码副本：用 Electron 直接启动，日志仅 `[mouse] hook on`，无 `Cannot find module`；证明运行时第三方代码已全部随仓库提供。

## 说明

- `app/vendor/README.md` 列出每个上游项目、版本、许可证和保留的文件。
- Live2D Cubism Core（`app/renderer/lib/live2dcubismcore.min.js`）是 Live2D 专有运行时，源码仓库不提交；当前两个 release 产物由本机构建，包含本机已下载的该文件。对外分发前请自行确认 Live2D 的再分发条款；没有该文件时桌宠回退静态图片，其他功能不受影响。
- 重新构建需要 Electron 与 electron-builder 两个开发依赖；运行时和最终产物不需要它们。构建命令见仓库根 README。