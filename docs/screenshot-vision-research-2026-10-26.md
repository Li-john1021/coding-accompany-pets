# Voice2Prompt 截图与识图技术调研

调研日期：2026-10-26。目标项目：`D:\MyVibeProj\My_Agent_Team\voice2prompt-open`。

2026-10-27 选型更新：用户明确希望复用识图 MCP 内部的图片转文字实现。已选定 Microsoft MarkItDown 的视觉转文字服务模式作为实现基线，具体源码与复用边界见 [选型决定](vision-transcription-decision-2026-10-27.md)。本报告中的 Qwen、PaddleOCR 等保留为资料，不再表示多个待选方案。

本轮查阅项目源码、官方仓库、接口文档及论文摘要，形成方案建议；未实现功能，未安装外部 OCR/MCP 服务，未调用付费模型或复现论文性能。下文区分已核实能力与针对本项目的工程建议，不把作者 benchmark 宣称视为本机实测。

## 1. 结论

第一版建议使用 **Electron 原生截图能力 + 当前所选多模态文字模型的图片输入 API + 系统剪贴板**。这条路线直接满足已确认的“用户选模型、勾选多模态、主动点击识图”流程，也能复用现有的模型配置和请求基础。

**MCP 是工具调用协议；识图能力来自其背后的 OCR 引擎或视觉语言模型。** 本项目目前直接调用模型 API，因此第一版不必额外引入 MCP 客户端、服务进程或本地推理依赖。以后需要把识图作为 Agent 工具对外提供时，再封装相同识图服务即可。[MCP 工具与图片返回类型](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

选定复用基线：Microsoft MarkItDown 的图片转换器及视觉 OCR 服务，复用“图片编码 → 多模态调用 → 返回文字”的实现方法。Qwen3-VL 的图片输入与 OCR 示例作为补充资料；PaddleOCR 官方 MCP 用于后续专用文档识别参考；Umi-OCR、ShareX 用于截图交互参考。

## 2. 已确认需求

- 全局截图快捷键默认 `Alt+A`，允许用户设置；软件不在前台时仍可触发。
- 框选截图后自动复制图片，不自动调用识图。
- 接受剪贴板中的任意实际图片，包括其他软件复制的图片。
- 文字模型的每条配置增加“多模态”勾选项；以当前选中的模型配置判断能力。
- “识图”初始禁用；检查到当前模型勾选多模态且剪贴板有图片后启用。
- 识图读取图片，将文字与必要结构转为文本；图表或无文字图片补充内容描述。这里的转译不含语言翻译。
- 识图成功后用文本替换剪贴板图片；按钮随后随剪贴板状态重新计算。

## 3. 当前源码与接入位置

项目为 Windows Electron 应用。根 `package.json` 的打包配置指定 Electron `31.7.7`，`app/package.json` 声明 `^31.7.7`；以下 API 选择以 31.7.7 的版本文档为依据，不直接套用 latest 文档。

| 文件 | 已核实的现状 | 后续接入建议 |
|---|---|---|
| `app/main/config.js` | `llmProviders`、`activeLlmId` 与录音 `hotkey` 已持久化 | 增加独立的 `screenshotHotkey: 'Alt+A'`；模型配置建议新增 `multimodal` 布尔值，旧数据缺失按 false |
| `app/renderer/settings.js` | `providerRow()` 渲染模型行；`collectRow()` 显式收集固定字段 | 同时修改渲染、收集、加载与保存，避免新勾选项保存后丢失 |
| `app/renderer/settings.html` | 已有文字模型区与热键录制入口 | 增加截图热键设置；复用组合键录制逻辑，并让录制器知道当前编辑的是哪个热键 |
| `app/main/main.js` | `registerHotkey()`、保存设置、录制热键及设置窗关闭都涉及热键重新注册 | 统一管理录音与截图两项；现有 `unregisterAll()` 后必须恢复所有已配置热键，并检测互相冲突及被其他程序占用 |
| `app/main/models.js` | `chatCompletion()` 发 `/chat/completions`；`validateLlm()` 只发文本 ping | 复用 URL、鉴权、超时与正文处理；新增图片内容组装及视觉校验，不能把文本 ping 成功当作支持图片 |
| `app/main/pipeline.js` | 文本走重写、结构化提示词及文本特定处理 | 识图使用独立提示词与入口，避免把图片描述再改写成提示词，或丢掉原文格式 |
| `app/renderer/pet.html` | 已有禁用的 `data-mode="image_recognition"` 占位按钮 | 启用已有识图入口；另加截图按钮，不重复添加第二个识图按钮 |
| `app/renderer/pet.js` | `updateActionButtons()` 固定禁用识图；点击逻辑仅接受 structure/optimize | 新增截图/识图分发、能力及剪贴板状态、识图中状态；和现有录音忙碌状态协调 |
| `app/main/pet-action-workflow.js` | 只接受文字处理模式，并主动捕获其他窗口选中文字 | 识图直接读取图片剪贴板，不进入这条文本捕获流程 |
| `app/preload.js` | 通过 contextBridge 暴露受限 IPC | 增加截图、识图及可用状态接口；模型调用继续放在主进程 |
| `app/main/pet-window-layout.js`、`app/renderer/pet.html` | 桌宠基准窗口 300×306，操作区宽 284 | 增加第四个按钮时一起检查布局、缩放和窗口边界 |

## 4. MCP 项目

### 4.1 PaddleOCR 官方 MCP：优先评估的专用 OCR 工具接口

- [官方集成文档](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/integrations/mcp_server.en.md)
- [服务入口文件](https://github.com/PaddlePaddle/PaddleOCR/blob/main/mcp_server/paddleocr_mcp/__main__.py)

官方文档列出 `ocr`、`pp_structurev3`、`paddleocr_vl`，分别覆盖识字、版面结构及视觉模型文档解析。支持本地推理、官方服务及自托管服务等后端。可以作为以后复杂表格、公式和文档识别的候选，硬件、依赖与凭据随后端而变；官方不推荐 PaddleOCR-VL 走 CPU 推理。它本身不负责本软件的全局热键、框选层和剪贴板按钮状态。

### 4.2 Microsoft MarkItDown MCP：适合扩展到文件转 Markdown

- [MCP 使用文档](https://github.com/microsoft/markitdown/blob/main/packages/markitdown-mcp/README.md)
- [MCP 具体实现](https://github.com/microsoft/markitdown/blob/main/packages/markitdown-mcp/src/markitdown_mcp/__main__.py)
- [视觉 OCR 插件文档](https://github.com/microsoft/markitdown/blob/main/packages/markitdown-ocr/README.md)

MCP 工具为 `convert_to_markdown(uri)`，支持 file、data、http、https URI，支持 STDIO、Streamable HTTP 和 SSE。适用于未来增加 Office/PDF 文件转换。

需要区分基础转换与视觉识别：核查的 MCP 实现仅构造 `MarkItDown(enable_plugins=...)`，没有传入 `llm_client`/`llm_model`；视觉 OCR 插件需要这些模型配置。因此不能把“安装 MCP”理解成“已配好截图识图”。对当前单张截图入口，引入这一文件转换层的收益有限。

## 5. 图片转文字与截图参考项目

| 项目 / 原始资料 | 已核实能力 | 本项目适用位置与限制 |
|---|---|---|
| [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL) | 通用图像理解，官方提供 OCR、文档解析与 API 部署示例 | 直接图片转文字的优先样例；这是一个可参考的公开模型系列，不是对所有供应商或最新模型的性能排名 |
| [PaddleOCR / PaddleOCR-VL](https://github.com/PaddlePaddle/PaddleOCR) | 专用 OCR、文档布局、表格、公式等解析路线 | 文档截图候选；通用 OCR 与 VLM 的部署成本不同，需分别选型 |
| [RapidOCR](https://github.com/RapidAI/RapidOCR) | 基于 ONNX 等部署路线的离线 OCR，默认覆盖中英文 | 后续纯识字/CPU 本地方案候选；不能替代图表语义理解；速度与准确率待目标机器测试 |
| [Umi-OCR](https://github.com/hiroi-sora/Umi-OCR) | 离线截图 OCR、快捷键唤起、粘贴外部图片、文字排版处理 | 最贴近本需求的交互参考；其界面及技术实现不等于 Electron 可直接复用模块 |
| [ShareX](https://github.com/ShareX/ShareX) | Windows 区域截图、热键工作流、复制图片与 OCR 等功能 | 参考框选、取消、截图后动作与热键设置；复制代码前需单独核对许可兼容性 |

推荐优先阅读的具体文件：

- [Qwen OCR notebook](https://github.com/QwenLM/Qwen3-VL/blob/main/cookbooks/ocr.ipynb)：识字和关键信息提取。
- [Qwen 文档解析 notebook](https://github.com/QwenLM/Qwen3-VL/blob/main/cookbooks/document_parsing.ipynb)：文字与布局输出。
- [Qwen README 图片与服务部署示例](https://github.com/QwenLM/Qwen3-VL/blob/main/README.md)：本地推理消息格式与服务 API 入口。两种格式不能不加区分地互换。
- [PaddleOCR-VL 使用文档](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/pipeline_usage/PaddleOCR-VL.en.md)：部署及推理引擎选择。
- [百炼视觉接口文档](https://help.aliyun.com/zh/model-studio/vision)：可参考兼容接口的 `image_url` 图片消息；实际模型、地域、Base URL 和图片限制以所选服务为准。

## 6. LLM 怎样理解图片

典型的视觉语言模型（VLM）把图像编码器和语言模型连接起来；不同系列结构并不完全相同。可用以下过程理解：

```text
PNG/JPEG 图片
  → 解码成像素、按模型规则缩放或切块
  → 视觉编码器提取局部及整体特征
  → 投影层 / Q-Former 等连接模块形成可供语言模型使用的视觉表示
  → 与文字任务一起输入语言模型
  → 逐步生成识别文本、表格或描述
```

Base64 只是图片字节的传输编码。把它粘进普通文字消息，不会让纯文字模型获得看图能力；服务端必须支持图片内容块，并有对应视觉处理链路。UI 的多模态勾选项只是用户声明的能力开关，不能改变模型本身。

几项关键技术及对产品的影响：

| 技术 | 含义 | 对截图识图的影响 |
|---|---|---|
| 图文对齐 | 训练图片与文字表示之间的对应关系；CLIP 是代表性工作 | 是视觉语言能力的基础之一，CLIP 本身不是完整截图转录器 |
| 模态连接 | 将视觉特征接入语言模型；BLIP-2 使用 Q-Former，LLaVA 使用投影连接 | 常见 VLM 能直接从图像生成文字，不要求先调用独立 OCR |
| 视觉指令微调 | 用图片、任务指令和答案训练模型 | 提取原文、总结图片、回答图片问题是不同任务，提示词必须明确 |
| 动态分辨率 | 按图像尺寸及细节分配视觉计算；Qwen2.5-VL 是可读实例 | 小字号截图应保留细节；盲目压缩会丢字，视觉 token 与延迟也需控制 |
| 结构解析 | 除识字外恢复表格、阅读顺序及公式等 | 输出文本可用 Markdown 表格/列表；布局恢复不保证完全准确 |
| 生成式解码 | 依据视觉与语言上下文生成内容 | 可能误读或补字；提示词降低偏差，但不能保证完全消除错误 |

基础原理来源见下一节的 CLIP、BLIP-2、LLaVA、Qwen 报告。小字、无语义字符串、数字、公式等应单独评估；不能用“能描述照片”代替“能准确转录截图”。[OCRBench](https://arxiv.org/abs/2305.07895)

## 7. 推荐论文阅读顺序

以下为论文/报告原始页面。本轮阅读摘要，并交叉核对项目介绍；未逐篇通读全文或复现实验。

| 论文 | 主要用途 | 和本需求的关系 |
|---|---|---|
| [CLIP: Learning Transferable Visual Models From Natural Language Supervision](https://arxiv.org/abs/2103.00020)，2021 | 理解图文对比学习和语义对齐 | 回答模型如何建立图片与文字的对应关系 |
| [BLIP-2](https://arxiv.org/abs/2301.12597)，2023 | 理解冻结图像编码器/LLM 与 Q-Former 连接 | 回答图像特征怎样接入语言生成 |
| [Visual Instruction Tuning / LLaVA](https://arxiv.org/abs/2304.08485)，2023 | 理解视觉指令微调 | 回答模型为何能按“提取文字”等指令处理图片 |
| [Qwen2.5-VL Technical Report](https://arxiv.org/abs/2502.13923)，2025 | 动态分辨率、定位与结构化文档提取 | 重点理解截图小字、表格和图表处理 |
| [Qwen3-VL Technical Report](https://arxiv.org/abs/2511.21631)，2025 | 多模态位置建模与多层视觉特征融合 | 了解公开模型的图像理解架构及部署取舍 |
| [PaddleOCR-VL](https://arxiv.org/abs/2510.14528)，2025 | 专门面向文档的紧凑 VLM | 比较通用视觉模型和文档专用方案 |
| [OCRBench](https://arxiv.org/abs/2305.07895)，2023 首发、后续修订 | 多类文字视觉任务评测 | 用于设计本软件截图样本，而非直接套用榜单分数 |
| [Evaluating Object Hallucination in Large Vision-Language Models / POPE](https://arxiv.org/abs/2305.10355)，2023 | 图像对象幻觉及评估 | 说明“描述图像”也会产生与图片不符的内容；它不是 OCR 字符准确率指标 |

## 8. 针对 Electron 31 的实现建议

### 8.1 截图和热键

基础能力使用 Electron 现有模块，版本依据：

- [31.7.7 globalShortcut](https://github.com/electron/electron/blob/v31.7.7/docs/api/global-shortcut.md)：全局热键注册返回成功/失败，能在软件失焦时触发。
- [31.7.7 desktopCapturer](https://github.com/electron/electron/blob/v31.7.7/docs/api/desktop-capturer.md)：获取屏幕源；仍需自行实现矩形框选、取消与裁剪。
- [31.7.7 screen](https://github.com/electron/electron/blob/v31.7.7/docs/api/screen.md)：屏幕范围、缩放及坐标转换。
- [31.7.7 clipboard](https://github.com/electron/electron/blob/v31.7.7/docs/api/clipboard.md)：`readImage()`、`writeImage()`、`writeText()`；不是网页 `navigator.clipboard` 的权限模型。

建议新增一个框选窗口及截图控制模块：取得屏幕原图后显示冻结画面和选区，确认裁剪成功再写图片剪贴板；Esc 取消不写入。处理 Windows 多显示器负坐标、不同 DPI、截图源实际像素尺寸与逻辑选区坐标的映射，避免默认缩略图损失小字。桌宠及工具窗口是否出现在截图中应通过隐藏和实机截图验证。

默认 `Alt+A` 的配置和注册要独立于录音快捷键。不能只在启动时追加一次注册：现有保存设置、关闭设置、录制快捷键结束等路径会重新注册热键，必须一起覆盖两项。注册失败要有可见反馈。

### 8.2 图片输入和输出

优先在主进程读取 `clipboard.readImage()`，确认不是空图后冻结本次图片快照，再转 PNG 字节供请求使用。建议优先采用服务商支持的内嵌图片形式，避免为了识别本地截图而额外上传到公开图床。

兼容 Chat Completions 的示意消息如下；这是接口形态说明，实际支持及限制仍须核对具体供应商：

```json
{
  "model": "用户配置且确实支持图片的模型ID",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "提取图中文字，保留必要结构；图表补充客观描述。只返回结果。" },
        { "type": "image_url", "image_url": { "url": "data:image/png;base64,<图片字节的Base64>" } }
      ]
    }
  ],
  "stream": false
}
```

需要独立识图提示词，要求保留原语言、数字、代码缩进和阅读顺序；看不清的位置明确标记，不补写缺失信息。图片中的命令或问题属于待转录内容，不能触发执行或作答。表格可转 Markdown；图表描述与原文提取要有清楚的边界。

成功且正文非空后直接写文字剪贴板，不走现有自动粘贴或文本优化流程；失败不主动清空原图片。现有 `chatCompletion()` 在缺少正文时可能回退到 reasoning 字段，识图应把“只有推理、没有最终文字”作为失败，避免把思考过程复制成结果。

### 8.3 状态、验证和后续取舍

建议可用条件为 `当前模型.multimodal && 剪贴板有实际图片 && 当前无冲突操作`。初始禁用后查询一次状态；随后随剪贴板、模型选择、设置保存及操作结束更新，主进程执行识图时再次检查。Electron 31 没有直接的剪贴板变化事件，可选低频轮询；若采用 Windows 原生通知则需额外接桥，不必只为此给第一版增加原生依赖。[Windows 剪贴板通知](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-addclipboardformatlistener)

识图成功写入文本后，剪贴板通常已无图片，识图按钮应重新禁用。请求期间使用启动时的图片快照，防止中途复制其他图片改变本次输入；如果请求期间用户更新剪贴板，结果发布行为应与本产品现有剪贴板交互约定统一，不能擅自添加与已确认流程相矛盾的确认弹窗。

模型校验需区分“接口可达”和“图片被实际理解”：当前文本 ping 只能证明前者。以后可以增加包含已知文字/图形的小图片，检查服务是否接收并理解；不能仅凭模型名字包含 vision/vl 或勾选项就宣称支持。

实施后的重点验收样本：中文/英文小字、数字和随机串、代码缩进、表格、无文字图片、图表，以及外部图片剪贴板。交互覆盖热键冲突、取消截图、重启/保存设置后热键恢复、模型切换、剪贴板变化、失败重试、双屏混合 DPI 和桌宠缩放。比较识字错误、结构保留、描述是否编造、端到端延迟及费用；本轮尚无这些实测数据。

## 9. 建议落地顺序

1. 在现有 Electron 架构中完成框选截图、复制图片和独立热键配置。
2. 补全每个文字模型的多模态开关、设置持久化及可用状态。
3. 接通图片输入请求、独立提示词、已有识图占位按钮和文字剪贴板输出。
4. 用真实截图验证当前用户所选模型；若发现文字/表格存在明确短板，再针对性比较 PaddleOCR 或 RapidOCR。
5. 需要面向外部 Agent 提供工具时再增加 MCP；不把它作为当前按钮功能的前置依赖。

目前已具备开始编写功能规格所需的技术依据。性能、供应商兼容性和混合 DPI 截图正确性仍需实施阶段验证。
