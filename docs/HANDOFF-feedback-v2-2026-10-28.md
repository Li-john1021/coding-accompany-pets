# 首测反馈修复交接：截图、识图、长录音

交接时间：2026-10-28（Asia/Shanghai）。用户明确要求“停下，写交接文档，让其他 agent 接手”。已停止实施，不应自动继续改代码或测试。本文件仅交接；本轮修复尚未完成、尚未通过总审查、没有新版可交付包。

## 1. 从哪里接手

- 主项目：D:/MyVibeProj/My_Agent_Team/voice2prompt-open，main，HEAD d979940800a308a5379d42e83af9116bb149e9a3。这里仍是第一版已交付源码。
- **本轮实际工作区**：D:/MyVibeProj/My_Agent_Team/voice2prompt-open-feedback，分支 codex/screenshot-asr-feedback-v2。不要在 skill2Agent 里找软件代码。
- 本轮基线 d979940；规划冻结提交 4d8cb8a。除规划、交接文档外，本轮业务代码目前是未提交工作区改动及 untracked 新文件，必须保留。不要 reset/clean，也不要只 checkout 分支后误以为代码齐全。
- 之前第一版 worktree：../voice2prompt-open-screenshot-vision，保留作历史证据，当前修复不在那里。
- app/node_modules 是指向主项目依赖的 ignored junction；Cubism Core 是复用的 ignored 本地文件。**不要删除 junction 对应的原始依赖。**
- 没有 .codegraph，因此按用户 AGENTS 指令不使用 CodeGraph。
- 交接文档在修复 worktree 内保存，同时在主项目 docs 留同内容副本，方便找到。主项目副本是本次新建的交接文件，不是业务代码变更。

## 2. 用户反馈与授权

1. 截图启动约延迟两秒、全屏闪一下；希望接近微信快速冻结、直接框选。
2. 框选后希望画笔和文字标注。
3. 截图后识图不能点，要求实际复现跑通。
4. 三至五分钟录音只得到前30秒或一分钟；更长输入有时转录直接失败。

此前授权持续有效：Luna 子代理实施，干净 Luna 对照规划独立审查，失败修复，自动测试/Computer Use，完成后本地 Git 提交并交付试用。最新停止指令优先，接手需遵循用户的新指示。

本轮已冻结：docs/PLAN-feedback-v2.md、docs/SPEC-feedback-v2.json；状态见 docs/LEDGER-feedback-v2.md。旧 v1 Plan/Spec/audit 不修改。本轮明确扩展“标注编辑”，取代第一版“鼠标松开即复制”：现在松开进入编辑，完成/Enter才复制，取消不写剪贴板。

## 3. 已确认的原因，不能混淆为全部根因

- 主用户 profile 元数据：当前 LLM mimo-v2.6-flash 的 multimodal=false。因此按第一版门控会禁用识图，旧UI没有讲清原因。主用户配置**尚未修改**，也没有开启此标志。
- 原截图每次重新启动 PowerShell：显示器枚举一次、每屏捕获各一次，加上新建渲染窗口导致等待。
- 旧录音使用 ScriptProcessor，整段 WAV 一次发给模型；没有分段、恢复入口或 finish_reason 截断检查。
- 小米官方 ASR：Base64音频不超过10MB；mimo-v2.5-asr上下文8k/输出2k。16k/mono/PCM16五分钟WAV约9.6MB原始数据，Base64约12.8MB，超过接口上限。这能解释长输入失败风险，**尚未证明用户前30秒丢失只有这一原因**。
- 官方资料：
  - https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/Speech-Recognition
  - https://mimo.mi.com/docs/en-US/api/audio/Speech-Recognition
  - https://mimo.mi.com/docs/zh-CN/quick-start/summary/model

## 4. 已保存的实现

### U1 捕获速度/无黑闪

新增 app/main/screenshot-capture-worker.js（运行时生成临时 .ps1），常驻隐藏 PowerShell/GDI进程，启动预热，只在触发时抓屏，一次命令捕获各屏。保留实际物理屏身份验证，非Windows仍走原精确display ID路径。

main.js 已接入 worker、退出dispose、真实截图图像decode+ready IPC握手，再显示框选窗；宠物窗 backgroundThrottling:false。新测试 screenshot-capture-worker.unit.test.js、screenshot-capture-worker.runtime.test.js。

Luna原测两屏：初始化570ms，预热后第一次473ms、后续354ms。这只是捕获 worker 耗时，**尚无触发到可框选完整暖/冷耗时证据**。

主代理已修复两个整合问题：
- 副屏Electron物理换算1082高、OS真实1080高。worker最初捕获请求1082但回报1080，导致主进程拒绝；现改为用匹配OS屏幕真实宽高捕获。
- ready等待器的closed回调访问已销毁win.webContents，可能异常；现提前冻结senderId。
- worker旧进程close/data不再干扰新进程；dispose清理ready定时器。

### U2 框选后标注

修改 main/screenshot.js、screenshot-preload.js、renderer/screenshot.html/js；新增 renderer/screenshot-annotation.js 和 .unit.test.js。

鼠标松开→在鼠标释放屏幕打开裁剪预览面板，画笔/文字/撤销/完成/取消；按原图像素输出。保留token/mainFrame/PNG尺寸校验。renderer解码冻结图后rAF→ready，再由main显示遮罩。

已更新 screenshot-controller.unit.test.js、screenshot-p3.runtime.test.js 以适应显式完成。尚需原生UI验证画笔/文字/取消、跨屏与输出像素。

### U3 识图原因提示

image-workflow.js 新增 state.reason，区别忙碌、模型缺配置、未勾多模态、没有图片。

pet.js/HTML 新增可点击“点此设置”提示，不静默按模型名开启能力；识图按钮title提供原因，截图成功反馈是否可识图。main全局截图成功也提示条件。

**未在真实用户配置开启多模态，未以真实profile重启验证**。后续应先备份配置，只为已验证当前provider显式开启multimodal，保留所有其他字段；已有缓存进程要安全重启。不要为了跑通直接去掉门控。

### U4 长录音/分段/恢复

新增 main/audio-chunks.js（PCM16/mono WAV严格解析、连续<=30秒切片、附近静音边界），audio-recovery.js（userData/audio-recovery，UUID+WAV+raw元数据，保留最新、过期7天、大小限制）。

models.js：两ASR协议支持opts signal/timeout/fetchImpl，逐段有界顺序请求合并，拒绝length/content_filter。父代理已把合法空字符串静音段改为允许，不能因停顿让整段失败；缺字段/非字符串仍失败。

pipeline.js：ASR前保存录音、识别后保存raw，失败保留；deferDelivery时返回recoveryId，等main确认交付后清理。

renderer/audio-capture-worklet.js 与 pet.js音频部分：优先AudioWorklet，兼容ScriptProcessor回退，停止时flush尾帧，采集错误保留已接收内容。父代理已把flush超时改为标记captureFailed，而非无声成功。

main/preload已接恢复IPC：audioRecoverySave/Get/Clear/Text；新IPC核查pet主frame。audioRecoveryText(id)只复制保存的raw。恢复按钮调用submit(...,{recoveryCopyOnly:true,mode:'none'})，main强制clipboard，避免旧insertMode=paste导致自动粘贴。preview和普通交付成功后按recoveryId清理；失败保留。退出abort当前语音请求并增加epoch。ASR进度走onAsrProgress。

pet.html新增绝对定位恢复面板：audio-recovery、retry-recording、copy-recording-text；尚需检查在300×306桌宠内可见/点击、手势隔离。

## 5. 当前测试结果：不能宣称全部通过

已完成最后一次37个 app/main/*.unit.test.js 的逐文件顺序测试：**35通过、2失败**。新增renderer/screenshot-annotation.unit.test.js由Luna单独跑过，未计入37。

失败1：screenshot-independent.unit.test.js
- renderer VM旧夹具没有preview canvas，运行新renderer在canvas.getContext报undefined。
- 应扩展真实DOM/canvas夹具、保留跨selector/坐标断言，并加入编辑完成/取消，不应删旧保障来过测。

失败2：structure-prompt-v6-route-isolation.unit.test.js
- VM白名单require不认识pipeline新增 ./audio-recovery，unexpected dependency。
- 应为恢复依赖注入无副作用适配或合理懒加载，使文字路由不访问录音存储；保持原路由隔离断言，不修改历史冻结v6合同。

其余包括audio-chunks、worker、vision、voice-delivery、pipeline、热键、原生输入/PowerShell、Undo等单元文件均通过。

最近截图生产运行时：node app/main/screenshot-p3.runtime.test.js **仍失败**。
- 第一次准确暴露副屏1082/1080错配，父代理已修复。
- 第二次曾因ready销毁回调问题无JSON，父代理已冻结senderId修复。
- **最新失败 Timeout: cross-screen image，约第177行**。前面的取消、单屏标注/像素步骤已跑到后续，但整体不能算通过。
- 很可能是测试在右屏mouseup之后只wait overlayFor(rightMonitor)（已有窗口立即返回），未等异步compose/decode打开editor，就点击done-tool；finish因mode还不是edit而忽略。需先等待editor.classList.contains('open')后再点完成，并确认是否还有产品问题；此判断是代码推断，尚未修复/验证。
- 注：Luna早先把“缺前缀JSON+[mouse] hook on”解释为wrapper启动错误；父代理后续得到了fixture内具体失败，不宜沿用其解释当已确认根因。

已过局部检查：audio-chunks.unit.test.js验证五分钟4,800,000样本重构、两个ASR协议、48k worklet5分钟源帧及尾块、截断/HTTP429/中段503/超时/恢复ID；voice-delivery-ipc.unit.test.js、pipeline-delivery.unit.test.js、pet-action-renderer-epoch.unit.test.js、pet-actions-ui.unit.test.js。证据文件 feedback-asr.txt/feedback-capture.txt/feedback-annotation.txt 是阶段记录，部分描述早于父代理整合，需对照当前源代码。

## 6. 接手优先事项

1. 先保留当前worktree所有修改，检查git status；不要从main重复实现。阅读本轮Plan/Spec，再做修复。
2. 修复上述两个VM测试与截图跨屏runtime的editor等待；跑完整截图runtime，记录冷/暖端到端延迟、确认图像就绪后才显示且没有黑闪。
3. 审查ASR接入，重点：
   - getUserMedia成功后AudioWorklet和fallback都初始化失败时的资源/recording flag清理目前不完整。
   - flush消息后音频仍可能继续process；明确停止边界，保证尾帧且不在flush后留下未收到的新帧。
   - 短时/静音段合法，全部为空才应提示没有语音；不得返回部分成功。
   - recover成功不粘贴、preview成功正确清理、失败/退出保留；恢复存储写入失败错误必须真实，别说已保留却未保存。
   - recording中get/clear/copy/重试互斥，防止错误覆盖恢复录音或迟到写剪贴板。
   - 录音采集后台三至五分钟真实时长测试未做；5分钟样本测试不能冒充真实后台采集。
4. 增加生产Electron+localhost长音频/中段失败/恢复UI端到端测试，并做三分钟以上隐藏窗AudioWorklet实际wall-time连续采样。子代理测试任务已被中断，当前没有其新测试文件保存。
5. 实测当前真实配置从截图到识图；不上传用户桌面，只用冻结合成图；修正当前multimodal=false配置前备份。
6. 补真实模型/ASR有界验证（以下预算），补完整TEST-REPORT-feedback-v2.md和证据。
7. 形成候选提交，干净Luna独立审查，审查期间不改实现；失败保留、修复后换新reviewer。此轮尚未任何独立总审查。
8. 构建新便携版，实际运行验证，本地提交/合回主项目交付。**当前app/dist-exe/Voice2Prompt-Screenshot-Vision.exe仍是旧v1包，不能当本轮修复版。**

## 7. 模型访问与本地环境

- 上一轮视觉8次已消耗并保留，不重复。新Plan最多12次（ASR<=10、视觉<=2）合成数据请求。
- **本轮目前0次真实模型调用，未解密API Key。** 新访问门禁尚未打开；先冻结已知合成音频/图像、请求/提示词哈希、计数，失败不读取密钥。不能直接发用户长录音或当前桌面。
- 当前模型元数据：LLM mimo-v2.6-flash，active id b52kdw0d；ASR mimo-v2.5-asr，id rf7h18j2，旧配置无asrProtocol，按MiMo域名自动chat。不把密钥值写日志/文档/提交。
- 当前用户profile位于标准APPDATA/Voice2Prompt/config.json；未改配置。元数据默认截图Alt+A、录音Alt+X。
- 原用户运行的v1 Voice2Prompt主进程最后观察PID43208（portable父PID81772，临时解压目录3LHZ...），不要靠旧PID盲目终止；先重新检查当前进程/是否录音，再处理重复实例/全局热键冲突。
- 停下时未检测到electron.exe测试进程；单元测试已结束，截图runtime已结束并finally还原剪贴板。负责额外集成测试的Luna已interrupt，无已保存新测试/运行PID证据。
- Computer Use：Windows用node_repl里的@oai/sky，不用native被禁的cua_repl；read computer-use SKILL/docs。选择list_windows返回的唯一目标再操作。用户若按物理Esc停止CU，不在同回合继续输入。
- sky.drag限制不能拖出当前窗口。不要把双屏生产事件测试冒充实际OS跨屏拖动。

## 8. 已停任务

luna_feedback_capture完成；luna_feedback_annotations完成；luna_feedback_asr完成（期间多次stream/RPM限制）；luna_feedback_integration_tests在用户stop时已interrupt。不要等待它们自动继续。主代理没有在停止后修复代码或重跑测试，只收集现状并写本文。
