# Release artifacts · v1.1.0

两件产物都是自包含的：内置 Electron 运行时和 `app/vendor/` 下的全部第三方运行时代码，
不需要 `npm install`、Node.js 或网络。

| 文件 | 大小 | 用途 |
|---|---|---|
| `coding-accompany-pets-Setup-1.1.0.exe` | 74,696,207 bytes | NSIS 安装版；可选择安装目录，创建桌面快捷方式 |
| `coding-accompany-pets-1.1.0-Portable.exe` | 74,347,051 bytes | 便携版；双击直接运行，不写安装目录 |

校验值见 `SHA256SUMS.txt`。

## 安装/运行

- 安装版：双击 Setup，选择目录后安装；首次启动打开设置页。
- 便携版：双击 Portable；首次启动同样打开设置页。
- 配置、模型、录音恢复数据保存在 `%APPDATA%\Voice2Prompt`，与安装目录无关。
  这是改名前的配置目录，1.1.0 显式沿用，升级不会丢模型和皮肤。
- 旧版配置会自动迁移：原来勾选“多模态”的文字模型会成为独立识图模型。
- 安装版与旧版 `Voice2Prompt` 的 appId 不同，可以并存；确认新版可用后再卸载旧版。

## 验证记录（2026-10-29）

- 单元测试 43/43 通过。
- 关键运行时测试通过：
  - 截图冻结屏 + 浮条 + 文字点选 + 剪贴板 PNG
  - 桌宠截图前后真实鼠标拖拽（mousedown 不丢失）
  - 识图按钮门控、气泡“正在读取图片中…”、结果写入剪贴板
  - 设置页识图模型增删保存、旧配置迁移
- 打包内容：`resources/app` 下无 `node_modules`，`vendor/` 含 electron-screenshots、
  uiohook-napi、pixi 及两个 win32-x64 原生 `.node`。
- 便携版启动正常；主进程 inspector 查询到
  `app.getPath('userData') = %APPDATA%\Voice2Prompt`、`app name = coding-accompany-pets`、`version = 1.1.0`。
- 安装版静默安装到 `D:\v2p\coding-accompany-pets-test`：退出码 0；安装目录内容完整，
  启动后同样读取旧配置目录；随后静默卸载并删除测试目录，原 `D:\v2p\Voice2Prompt` 未受影响。

## 说明

- `app/vendor/README.md` 列出每个上游项目、版本、许可证和保留的文件。
- Live2D Cubism Core（`app/renderer/lib/live2dcubismcore.min.js`）是 Live2D 专有运行时。
  源码仓库不提交该文件；本机构建的 release 产物包含本机已下载的副本。
  对外再分发前请自行确认 Live2D 条款；没有该文件时桌宠回退静态图片，其他功能不受影响。
- 重新构建需要 Electron 与 electron-builder 两个开发依赖；运行时和最终产物不需要它们。
  构建命令见仓库根 README。