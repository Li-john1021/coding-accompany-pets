# 第三方 Live2D 皮肤导入

设置 → 桌宠形象 → **📦 导入 zip…** 或 **📁 导入文件夹…**，选中后立即切换；默认皮肤文件在 `%APPDATA%\Voice2Prompt\models\<皮肤名>\`。

勾选 **“复制到项目内置目录”** 后，皮肤会写入仓库的 `app/assets/models/<皮肤名>/`，和内置键盘猫、大肥鱼一样随仓库分发。该选项只适合开发版；安装版的内置目录通常只读。内置目录已有同名皮肤时不会覆盖。

## 支持范围

- BongoCat 资源包：`*.model3.json` + `resources/background.png`（可选）+ `resources/left-keys|right-keys/*.png`（可选）。
- 通用 Live2D Cubism 3/4/5 模型：只要有 `*.model3.json` + `moc3` + 贴图即可；没有背景、没有键帽也能显示，只做形象/头眼/呼吸/鼠标跟随。
- 包内任意层级有入口都能找到（例如 `img/standard/cat_model/deepseek.model3.json`），GitHub 仓库直接下载的 zip 可以原样导入。
- 键帽图是“和画布同尺寸的整页透明图”，导入时会自动筛选，不再依赖固定 612×354 尺寸。

## 运行时版本要求

MOC3 v6 皮肤（DeepSeek 大肥鱼等新模型）需要 **Cubism SDK for Web R5 / Core 6.0.1 或更高**：

1. 下载 `https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.5.zip`；
2. 解压后把 `CubismSdkForWeb-5-r.5/Core/live2dcubismcore.min.js` 放到 `app/renderer/lib/live2dcubismcore.min.js`；
3. 重启应用。

旧版 Core 5.1 会提示“MOC3 v6 / Core 太旧”。Core 文件是 Live2D 专有组件，不提交到 git；发布包由构建机放入本机副本。

## 模式与降级

- **keyboard**：有键帽 + `CatParamLeftHandDown` / `CatParamRightHandDown`；听写时随机亮键、对应手下压。
- **standard**：只做头/眼/嘴/呼吸/鼠标跟随；没有手参数就不硬写手，没有键帽就不亮键。
- **gamepad**：当前按展示处理，不驱动手柄参数。
- 单只手模型（例如大肥鱼只有 `CatParamLeftHandDown`）也能正常敲击。

## 自动裁边与窗口

加载时会量出模型、背景、键帽的可见包围盒，裁掉大片透明边（可用 `v2p-skin.json` 的 `scene` 覆盖），再按场景比例调整宠物窗高度。导入的 `v2p-skin.json` 记录 `entry/mode/source/textures/warnings/scene`。

## 来源与致谢

- 最早的 Bongo Cat C++ overlay：[MMmmmoko/Bongo-Cat-Mver](https://github.com/MMmmmoko/Bongo-Cat-Mver)（MIT）。
- 现代桌面版与皮肤约定：[ayangweb/BongoCat](https://github.com/ayangweb/BongoCat)。
- 第三方皮肤索引：[ayangweb/Awesome-BongoCat](https://github.com/ayangweb/Awesome-BongoCat)；测试用的乃琳、罗小黑、阮梅等皮肤均来自该列表，版权归各作者。
- 内置大肥鱼：[mefist-asuka/Deepseek-standard-mode](https://github.com/mefist-asuka/Deepseek-standard-mode)；角色/贴图版权归 赤风RED、EmoteLab，工程参考与 `psd2live` 工具由 阿特ers、常日缠 开源。
- 老资源转换：[Bongo-Cat-Mver 转换站](https://bongocat.vteamer.cc)。

## 已知限制

- Cubism 2（`.model.json` + `.moc`）不支持，需要先转成 `.model3.json`。
- 8192×8192 贴图的皮肤（如阮梅）首次加载较慢、显存占用高，导入时会提示。
- 皮肤版权归原作者；本项目只做本地导入，不内置、不再分发第三方皮肤。