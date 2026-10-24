# WebUI 排版、SVG 与 composer 焦点

## 候选与范围

产品候选：`005544b096a62dacc5c0e7b6920320416ad89156`，基线为 `4ad5c92dc48afbabe25f5c6814247ab2a6d19436`。测试补正候选为 `75e0c97ebf6880785938d87bf36247536875167b`；后者只将 3 个旧测试中的 5 行标题/焦点定位与已采用呈现对齐，产品文件没有变化。候选保持独立 worktree，未合并 main。

用户在实际预览中报告 model/profile 贴连、凭据表单粘连、固定标题大小写、Dictate 文本占位及首页直角蓝框，并要求主动巡查同类问题。本批覆盖 model picker、Conversation/Fork、Team、People、公共组件消费者、Memory、Webhooks、Scheduled Inputs、Files/Git、快捷键、工具卡折叠图标及 MAS 方向图标。状态/变更入口为 [frontend state](../state/frontend.md)、[设计 §6.2](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#62-2026-10-24-主次文字表单与-svg-图标整检)、[delta](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md#requirement-compound-labels-and-forms-retain-typographic-separation)、[tasks §4.2](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#42-主次文字表单与-svg-图标整检2026-10-24) 和 [形成记录](../changes/webui-navigation-and-local-recovery.md)。

## 实测与修正

| 问题                 | 真实观察及结果                                                                                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| model/profile 连读   | 原产物两段没有布局间距且同色；修正为独立主/次文本行与选择标记，长 ID 可换行且保持完整原文                                                                                                                                                           |
| 表单粘连             | 凭据 form、Fork 相邻字段、Team 版本/动作缺布局；补独立字段、动作组及窄屏换行，password 语义和仅写凭据流程保留                                                                                                                                       |
| 公共原语/扩展        | 用公开 extension slot 挂载 Button/Field/Notice/Stack 实际消费者；修复 Memory 标签/核对操作、Webhook 操作组、Scheduled Inputs 默认控件与 `1/1admitted` 连读                                                                                          |
| Files/Git 文字和边框 | 原产物缺主题变量导致 input 边框为 none，部分字段不随阅读偏好缩放；补主题映射和相对字号，保持真实文件/Git 操作                                                                                                                                       |
| SVG 与标题           | 固定页面/分区/导航采用 Title Case；快捷键、disclosure 和关系方向使用 SVG，用户内容、后端语义值和第三方自定义标题保留原文                                                                                                                            |
| Dictate              | SVG microphone/stop 取代可见文字；实测图标 24×24、控件至少 44×44，保留 aria/action/state、识别生命周期和只改草稿/明确 Send                                                                                                                          |
| composer 焦点        | 用户截图中的框来自内部 `.composer-surface:has(textarea:focus-visible)`；该节点没有首页卡片圆角。文本输入经 pointer 也可匹配 focus-visible。改在外层 `.composer-card` 描边，实测 pointer、Tab/Shift+Tab 均有完整圆角焦点，内部和 textarea 不重复描框 |

本地确定性 provider、真实 Runtime/HTTP/SSE 与 `ownedBrowser` 用于功能和布局检查。没有伪造 HTTP DTO、安装包修改、读取用户凭据或付费模型测试。语音测试通过浏览器公开识别边界控制事件，并核对真实明确 Send 的 provider 请求；它不构成真实麦克风硬件或浏览器语音服务质量证明。

检查矩阵为 1440×900、360×600、390×650、390×844，及实际 20px 阅读偏好；焦点另在 1440/390 宽度以 pointer 和原生 Tab/Shift+Tab 验证。截图直接实读；这些范围不能外推到所有第三方页面、字体、浏览器或未测状态。

## 开发检查

- `npm run build`、`npm run check`、本 change 的 OpenSpec strict 和目标格式检查通过。最初用不存在的本地 `openspec.cmd` 路径调用失败，已用实际安装的 `openspec` 重新执行并保留成功输出，未以该错误调用计通过。
- 首次固定产品候选全量：638 tests / 632 pass / 4 fail / 2 skip，exit 1。两条旧测试仍定位 `Commands and extensions`；旧 a11y 子测试只查 textarea/内部 surface，漏查已采用的外层卡片，连同父测试计 2 fail。原始失败保留。
- 最小测试补正只改上述名称/容器；焦点必须可见、至少 2px、草稿保留、模型请求数和对话功能断言保留。6 个文件的定向复跑 27 tests / 27 pass / 0 fail。
- `75e0c97` 完整套件复跑：638 tests / 636 pass / 0 fail / 2 skip，exit 0，432007.7093ms。两条 skip 为 Windows 上既有的 POSIX CDP 用例。原失败和测试补正 diff 同时保存，未以删除或降低断言取得通过。
- active LSP probe：4 文件中 3 clean、1 未确认，没有把静默未确认记作 clean；完整 TypeScript 检查另行执行。

## 独立门禁

指定 workflow 为 `D:/Pi/extensions/pi-adversarial-review/workflows/adversarial-review.js`，运行 `b6e7361d-3bb7-4dc8-8321-443ccdcf921c`，对固定产品候选只读评审。A 子任务 `041e4e82-77ee-4ef3-9317-e259a4a136f2` 已完成，原文结论为 `OK with notes`；B 启动失败：`Unknown subagent model 'Mapleluv-ChatCompletions/deepseek-flash:high' in the active Pi model registry.` 因而指定双评为 **BLOCKED**，没有双方收敛结论，也未更换模型或流程。

[逐项处置与争议](evidence/webui-typography-svg/review-disposition.md)保留 A 原文、workflow 失败回执及监督者的核验。A-1 的旧 selector 问题已由上述测试补正解决；其余三项分别涉及未采用的独立 MAS 嵌入、错误的 CSS 优先级比较和对 `class: className` 解构的误读。经真实公开扩展入口实测，消费者的 class 保留、外部 CSS 可覆盖默认值，宿主辅助文字被裁为 1×1px；[结果](evidence/webui-typography-svg/review-probe.json)与失败/成功探针均保存。监督者处置不替代缺失的第二评审意见。

指定 `agent-workspace-linux` 独立桌面工具仍不可发现，GUI acceptance 为 **BLOCKED**。上述真实浏览器功能、数值与截图检查不能替代它。

## 证据与预览

最小耐久证据在 [evidence/webui-typography-svg](evidence/webui-typography-svg/)，包含前后图、用户焦点截图、有效焦点几何 JSON、RED/完整失败/定向及全量成功输出、构建/类型/strict、评审原文与处置；[清单](evidence/webui-typography-svg/manifest.json)保存每个证据文件的字节数与 SHA-256。原始临时取证在 `docs/.temp/typography-icons/`，本记录不以其长期存在为条件。

修复预览为 `http://127.0.0.1:45002`，独立 browser profile/数据目录，HTTP 200 且实际提供外层焦点与 SVG 麦克风资源。原 `45001` 实例、数据及 cookie/profile 保留。响应 provider 明确是本地确定性预览，不构成外部模型能力演示。临时启动材料、私有登录文件与停止 marker 只在 ignored `docs/.temp/operator-preview-005544b/`；登录凭证不入本记录。

## 创建关系的独立工作

现有 home 命名 textarea 发 `op:"create"`，单 runtime catalog enroll 最终调用同 Session 的 `tx.createConversation`；sidebar 的 Sessions 名称与这一实际效果不符。用户提出的独立创建弹窗、真正 New Session / Session 内 New Conversation、无父 Session 时预填并顺序创建、sidebar 文件夹归类，由 [design §6.3](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#63-session--conversation-创建关系调查) 和 [tasks §4.3](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#43-session--conversation-创建方向2026-10-24) 承接。本批未实现这些新生命周期，未声称其完成或用改文案冒充新 Session；原 P0 的主 catalog 故障恢复、同 Conversation 跨轮 call ID 重用等未覆盖边界仍按原记录保留。
