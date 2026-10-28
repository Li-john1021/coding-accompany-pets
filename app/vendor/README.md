# Vendored runtime code

这些目录是应用运行所需的第三方代码副本，随仓库一起分发，运行时不再依赖 `npm install` 或网络。只保留了 Windows x64 实际用到的文件，没有整仓复制。

| 目录 | 上游 | 版本 | 许可证 | 保留内容 |
|---|---|---|---|---|
| `electron-screenshots/` | https://github.com/nashaofu/screenshots | 0.6.2 | MIT | `lib/`、`package.json`、LICENSE |
| `electron-screenshots/node_modules/react-screenshots/` | 同上 monorepo | 0.6.1 | MIT | 预构建 `dist/electron.html` 等 UI |
| `electron-screenshots/node_modules/node-screenshots/` | 同上 monorepo | 0.2.8 | Apache-2.0 | JS 加载器 |
| `electron-screenshots/node_modules/node-screenshots-win32-x64-msvc/` | 同上 | 0.2.8 | Apache-2.0 | Windows x64 原生 `node-screenshots.win32-x64-msvc.node` |
| `electron-screenshots/node_modules/debug/`、`ms/` | https://github.com/debug-js/debug | 4.4.3 / 2.1.3 | MIT | 运行时依赖 |
| `electron-screenshots/node_modules/fs-extra/`、`graceful-fs/`、`jsonfile/`、`universalify/` | https://github.com/jprichardson/node-fs-extra | 8.1.0 / 4.2.11 / 4.0.0 / 0.1.2 | MIT / ISC / MIT / MIT | 运行时依赖 |
| `uiohook-napi/` | https://github.com/SnosMe/uiohook-napi | 1.5.5 | MIT | `dist/`、Windows x64 prebuild、LICENSE |
| `uiohook-napi/node_modules/node-gyp-build/` | https://github.com/prebuild/node-gyp-build | 4.8.4 | MIT | 原生绑定加载器 |
| `pixi/pixi.min.js` | https://github.com/pixijs/pixi.js | 7.4.2 | MIT | 仅 renderer 使用的 dist 文件 |
| `pixi/cubism4.min.js` | https://github.com/guansss/pixi-live2d-display | 0.4.0 | MIT | 仅 renderer 使用的 dist 文件 |

## 更新方式

1. 在 `app/` 下用 npm 安装目标版本；
2. 按上表复制实际需要的文件到 `app/vendor/`（Windows x64 只保留 `prebuilds/win32-x64` 与对应平台包）；
3. 运行全部单元/运行时测试，并确认没有代码再 require 裸包名；
4. 保留对应 LICENSE。

## Live2D Cubism Core（不在 vendor 内）

`app/renderer/lib/live2dcubismcore.min.js` 是 Live2D Inc. 的专有运行时，仓库有意不提交（见 `.gitignore`）。没有它时桌宠回退静态图片，其他功能不受影响；需要 Live2D 时请按 Live2D 许可自行从 cubism.live2d.com 获取。当前本机构建目录中存在该文件，因此本地构建的安装包会把它打进 `resources/app/renderer/lib/`；对外分发前请自行确认 Live2D 的再分发条款。

## Electron

应用运行时由 Electron 提供（`require('electron')` 是内置模块，不需要 `node_modules/electron`）。`app/node_modules/electron` 和 `electron-builder` 只是本机开发/打包用的 devDependencies；发布产物（便携包/安装包）已经自带 Electron 运行时。重新构建时才需要这两个 dev 依赖。