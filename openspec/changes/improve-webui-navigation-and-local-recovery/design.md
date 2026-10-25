# Design

## 1. 来源、观察与采用状态

用户于 2026-10-23 要求，把下一步前端调优与本机管理员恢复入口放在同一轮变更流程中，先介绍方案。

已有约定：

- [前端规范](../../../docs/development/FRONTEND-GUIDELINES.md)采用 Atlassian 与 Vercel 指南；对应 UI 的原生行为由 Devin 离线生产前端确定。
- [Runtime state](../../../docs/state/runtime.md)规定公开 Pi API、mutable 对象封装、单 writer、身份与 unknown 契约。
- Verification 为可选开发活动；跳过时在所属任务记录一次，后续仅记录实际发生的活动。

现场观察：

| 观察                                                                                                          | 能支持的判断                                                               |
| ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 45001 登录页显示通用拒绝；服务仍在监听                                                                        | 进程存活，当前界面缺少明确的登录原因                                       |
| 认证 journal 三个状态依次为 1/1、2/1、2/0（总会话/active），初始令牌后两次均 inactive，owner person 仍 active | 初始会话被轮换，换出的会话随后失效；现有会话为零。不能据此确定是谁触发注销 |
| 初始令牌尚未到期，携带它的只读 hello 实测返回 401 / UNAUTHORIZED / denied                                     | 失效来自已撤销状态，不是 TTL 到期                                          |
| app.js 的 signIn 丢弃非 2xx 响应码；main.ts reopen 不再次 initializeOwner                                     | 通用文案来源已定位；重启与重用初始链接不是恢复机制                         |

本地原始探查在 docs/.temp/refusal-debug。上表保留可长期引用的方法与结果；没有把令牌明文、令牌哈希或浏览器 Cookie 写入正式文档。

生产参考固定于 [devin-ui-comparison@ed20cec](https://github.com/mapleluvr/devin-ui-comparison/tree/ed20cec0aef82daa22aa50da19597b7ba1607e02/reference-dump/source/assets)：

- webapp-B9OnyKmM.js 的 sidebar-settings 使用路由 Link，按条件前往 /settings 或 /settings/local。
- app-initial-D97LNTSt.js 注册 /settings/preferences、/settings/notifications；settings-DvAqVerK.js 按 audience、visible 与权限过滤分类。
- 当前 SettingsPage 渲染分类 button，并复用带 dialog/focus-trap/history-slot 的 Sheet。页面路由应拥有独立生命周期。
- Devin 的 /settings 根路径映射含 organization；Pakka 以 Appearance 为默认入口是产品配置适配，不把它说成 Devin 的原生默认分类。

这些是静态控制流观察，不是线上 Devin 运行结论。本机可信恢复是本轮 Pakka 设计，不从参考站推断其认证后台。

## 2. 工作拆分与顺序

| 阶段 | 交付                                   | 完成依据                                                               |
| ---- | -------------------------------------- | ---------------------------------------------------------------------- |
| 0    | 维护端口、文件保护与崩溃交付的最小试做 | 取得独占存储，仅访问允许的数据；provider、工具、Job 和扩展启动计数为零 |
| 1    | 本机恢复与登录错误闭环                 | 注销后可恢复原 owner，旧凭证拒绝，原产品数据可继续读取                 |
| 2    | 设置路由                               | 分类 URL、深链接、刷新、真实链接与浏览器历史对齐同一页面状态           |
| 3    | 逐页质量改进                           | 每个实际入口有来源、差距、采用结果与对应开发检查                       |

阶段 0 是安全实现前提；若公开 API 的维护模式达不到约束，先记录具体缺口并调整设计，不把完整 WebUI 启动伪装成无效果的存储维护。

## 3. 本机可信恢复

### 3.1 操作流程

拟新增命令为 `pakka-webui recover-owner`。普通启动参数与初始 owner-file 的行为继续使用原契约。

1. 操作者正常停止持有该产品存储的 WebUI 进程。
2. 命令读取显式配置与 reopenSessionFile，检查物理路径、provenance、Runtime 身份和 bootstrap 中的 ownerId，展示目标及将撤销的会话数量。发行需要显式确认该 Session；脚本使用确认参数。
3. 在独占 writer 下执行恢复，生成受保护的恢复文件，输出非秘密的 recoveryId、到期时间、状态与文件位置。
4. 正常启动原产品，在登录页兑换恢复文件中的令牌，进入同一产品身份与 Conversation。

命令提供只读预览/核对模式；具体参数拼写在维护试做后定稿。恢复文件与普通启动 owner-file 分开，避免改变已有文件格式。

恢复文件包含 product Session 标识、recoveryId、有效期和登录令牌。只有服务地址能从显式配置准确确定时才附带 URL；端口为 0 时使用正常启动后报告的地址与令牌。令牌 URL 使用 fragment，页面解析后清除该 fragment。

### 3.2 权限与保留范围

- 恢复权限来自本机进程取得受保护数据目录和 writer 的操作系统权限；浏览器身份不授予此维护能力。
- 默认目标为 bootstrap 记录的原 owner，要求该 person 当前 active、role=admin、resources=\*。账号被停用或降权时，命令报告不满足恢复条件，另行处理管理员变更。
- 同次认证提交使该 owner 的既有登录会话与较早恢复凭证失效，加入新的短时凭证和发行记录。其他人的角色与会话保持其原有授权状态。
- 恢复凭证默认 10 分钟，首次成功 exchange 后由正常浏览器会话取代；重复兑换、到期和后续发行均按当前认证状态拒绝。正常会话继续使用产品配置的 TTL。
- 模型凭据、Conversation、history、receipt、预算与持久工作不属于这次认证写入的对象。

本方案选择停服维护，代价是短暂停机。它使恢复的独占写入和公开入口边界可直接核对；自动后台恢复、未鉴权 HTTP 重置和直接修改 journal 均不采用。

### 3.3 维护端口

当前 createRuntime 会装配 Host、Agent、Job 与 Harness。源码中的初始化不能单凭“没有调用 Send”就被认定为零效果。

为恢复提供最小的维护端口：在 durable-adapter.ts 内用公开 Pi 存储/文档 API 打开已有存储，对外只给冻结身份、受限快照与 CAS 命令。复用原路径、provenance 和 writer 检查。端口只开放 bootstrap/Runtime 元数据读取与认证命名空间的受控写入，不安装 provider、工具、Job、扩展或 HTTP listener，也不解析模型凭据回调。

people 的状态 codec 与原子变换由普通服务和维护路径共享；不复制一份独立认证规则。具体公开 API 组合先通过隔离试做确认。

### 3.4 凭证交付与 unknown

- POSIX 的文件权限与 Windows ACL 分别落实；Windows 的 mode=0600 不作为 ACL 已受保护的证据。
- 新发行的输出路径若已有文件、存在链接/reparse 重定向、权限不符或不支持的保护方式，在认证变化前拒绝。对应同一 recoveryId 的受保护预备文件只进入核对/续交付流程。新文件以排他方式准备；只在明确私有的位置交付明文令牌。
- 每次发行绑定 recoveryId、原产品身份和目标 owner。认证变更与不含明文的发行记录在同一持久化提交内完成。
- 交付按“私有文件预备 → 认证 CAS → 确认发布”设计。跨文件系统与存储的步骤不假装成一次事务；阶段 0 用故障注入确定恢复协议。
- CAS 或后续发布未知时返回非成功状态和 recoveryId，保留可核对材料。重跑先核对同一发行，不盲目再发行或重新激活旧令牌。
- 已提交但文件发布失败时，只有受保护预备文件与持久记录一致，才可完成同次交付；材料不一致则保持失败，并通过显式新发行处理。
- 发行/核对日志只含身份、时间、状态与文件位置；令牌不进入 stdout/stderr、浏览器存储、模型历史或通用配置。

认证 schema 升级读取原 schema 1，写入时保留人员、scope、邀请与已有会话语义；损坏或未知版本闭锁。审计和会话集合使用有限容量，容量不足在写入前报告；未确认记录保留其核对身份。

若写入新 schema，旧二进制会按未知版本闭锁；交付说明要明确升级后的可用版本。代码回退不自动回退认证数据，也不恢复已撤销的令牌；需要降级时另行设计保留撤销语义的显式转换。

## 4. 登录与操作反馈

| 情况                         | 页面行为                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 登录输入格式错误             | 字段附近给出输入要求，关联错误并聚焦首个无效字段                                                             |
| exchange 的 401              | 说明链接无效、已使用或已失效；请求新的登录链接，操作者可使用本机恢复流程。公开页面不区分某个令牌究竟存在与否 |
| 403                          | 说明权限或安全校验拒绝，指导使用配置的地址与重新核对当前状态；不只凭状态码判定账号已注销                     |
| 409/CONFLICT                 | 保留适用的编辑内容，提示读取最新状态后再明确提交                                                             |
| CAPACITY/服务暂不可用        | 明确服务/容量状态，采用显式重试而非复制 mutation                                                             |
| 网络或可能持久化后的未知结果 | 显示未确认状态并锁住原操作身份，先做只读核对                                                                 |

exchange 结果未知时，现有 Cookie 的只读 hello 可以说明“当前以谁登录”，不把这一点等同于证明原兑换的具体结果；不自动重发一次性令牌。登录返回目的地仅接受内部允许路由。

401、资源权限变化与登出各自清理对应的私密状态。错误消息公开程度、请求身份与安全边界在服务和浏览器两侧共同检查。

## 5. 设置路由

### 5.1 页面关系

初始路由表：

| 页面                                    | 路由                    | 上下文                               |
| --------------------------------------- | ----------------------- | ------------------------------------ |
| 设置入口                                | /settings               | 规范化到 Preferences，保留合法上下文 |
| Appearance                              | /settings/preferences   | 当前浏览器偏好                       |
| Notifications                           | /settings/notifications | 当前授权会话                         |
| Conversation settings（含当前凭据控件） | /settings/conversation  | 当前授权会话                         |
| People & invitations                    | /settings/people        | 当前管理员                           |
| Extensions                              | /settings/extensions    | 当前获准能力                         |

Preferences/Notifications 的对应 href 来自生产注册；Conversation/People/Extensions 是 Pakka 已有实际能力的路由适配。可选 `conversation=<public id>` 表示上下文，不代表访问权；incarnation 由 fresh list/snapshot 解析，不沿用 URL 中的旧 capability。现有 `/#conversation=...` 工作台链接继续可用。

### 5.2 生命周期与历史

- 分类为真实 a[href]，支持普通激活、Ctrl/Meta/中键及新标签页。激活态来自路由，分类注册包含能力和权限条件。
- 设置作为 page/main 区域，独立于 Sheet 的模态 trap、Escape 关闭和 history-slot 清理。真正的 dialog/palette 保留自己的实例生命周期。
- HTTP 只对明确允许的页面路由提供 shell。未知页面、RPC、扩展 assets 和私密路径保持各自路由与错误，不做全路径 HTML fallback。
- 深链接先恢复认证和授权列表，再决定当前页面、会话与允许动作。未登录时保留合法目的地；越权、撤权、失效资源各有明确页面状态。
- Back/Forward 在分类和工作台页面间按浏览器历史移动；Back to app 是指向原授权工作台上下文的导航链接。直接打开设置时采用授权默认工作台目的地。
- 单页导航期间，消息草稿、会话选择、滚动位置与用户焦点按页面/资源/人类身份保存。身份或 scope 失效时先清理相应私密状态。
- 整页刷新恢复 URL 指定的分类与持久授权上下文。本轮不把当前内存草稿称为可跨刷新恢复的数据；是否持久化消息草稿需要另行核对生产原生存储行为。

## 6. 逐页质量工作

每批以真实入口为单位：Login → Appearance/Conversation/凭据 → People/邀请 → Notifications/Extensions → Conversation 内容与反馈。

- 表单：label/name/type/autocomplete 适配用途，错误就近并可被辅助技术关联，提交后聚焦首个错误。加载时保持布局与可识别操作；unknown 保留原操作。
- 页面：标题层级、main/nav 与跳转入口清楚；配置路由用页面焦点，模态仍用所属 focus trap/return。
- 长内容：会话标题、目录、模型名和工具内容有完整读取路径；以换行、详情/复制与适用滚动处理实际长字符串。
- Conversation/composer：依生产 renderer 和真实原生状态区分发送、排队、停止、拒绝和待核对；本轮保持 Prompt/Steer/Follow up 的调度与预算边界。
- 响应式：实际桌面、360×600、390×650、390×844 及放大字号；核对操作可达、固定层遮挡、水平溢出和阅读宽度。固定 reference.css 字节保持原身份。
- 已发现的“拒绝后第二次 Send 偶发不可点击”，先比较 disabled、命中测试和更新边界，避免把重试成功或固定等待当成根因。

### 6.1 2026-10-24 Conversation 状态可观测性批次

经本轮指挥交接，先实施上述 Conversation/composer 切片的 P0 项；这不表示本提案的恢复、路由或其他页面范围已经获采用。实现和检查继续由本节及对应 delta 约束。

可观测性先于视觉设计。`PocketSnapshot.live` 实际提供 `busy`、可选 `message` 和 `{callId,name,status,taskId?,output?}` 工具观察；`entries` 提供持久消息及 `entriesTruncated`/`olderBeforeId`；输入回执提供 `queued|placed|done|unanswered|unknown`。`list.states[id]` 只有 `version` 和 `archived`，所以 Sessions 行运行状态徽标不能在本切片中可靠实现，需独立的协议、服务与 OpenSpec 变更，不由 UI 猜测。

本批次的适配决策：

- Send 的既有禁用布尔保持不变，将只读、提交中、视图未就绪及 Prompt 生成中的原因关联到输入和按钮。提示位于 composer 卡片上方，不改变卡片基准几何。
- Stop 位于原生工作发送组，Prompt 的 busy 状态与 Send 互斥；Steer/Follow up 保留可发送能力。stopping 只由授权 `busy=false` 解除，不用 abort 请求成功代替完成；8 秒后可显式再次 Stop。正常快速结束不人为延迟。
- `live.message` 用 `data-live=true` 和 `message-live` 区分，只有 busy 且存在该消息时才在消息列表末尾显示紧凑 Streaming。原生进行中 `stopReason:"pending"` 是 live 标记而非终态，Pocket live 投影省略该可选终态字段；历史消息保留真实终态，不能通过 SSE 校验失败后不断重连。验证通过但不可内联的 `image/*` 用中性、文本节点占位，保留 MIME；未知原生类型仍由协议闭锁，不能借兜底把无效 DTO 变成可接受输入。
- 工具三种载体分别取 `toolCall.id`、`live.callId`、`toolResult.toolCallId`，与来源 Conversation 组成键：历史使用 `entry.sourceConversationId ?? entry.conversationId`，live 使用当前 `view.ref.conversationId`。卡片暴露 `data-source-conversation`，声明与 live 共存时只渲染一卡，live 状态按 DTO 原值显示，历史状态不靠推断。结果文本可从同一卡直接看到；完整内容仍在 disclosure 内。结果中的非文本 part 不能因归并被静默省略。
- 找不到声明的 toolResult 保留孤儿卡并明确声明不在当前视图；跨 fork 不能把不同 Conversation 的同 ID 误合并。历史分页、筛选或 live 更新不应重置已展开卡片。流式 toolCall 初次落盘时，live 与历史采用同一 section 渲染序列和来源/调用键；仅给不同父层的子卡添加 key 无法保留节点。原生 toolResult.isError 为 true 时，折叠摘要保留显式 error 文本，不能只有与正常结果同色的无效规则。
- receipt 保留原 DTO 状态、原生 reason 和请求 ID。只有 `reason:"blocked"` 是 policy blocked 及修改输入指引；`aborted` 是撤回，其他未回答（包括 `model_error`）不得误称策略拒绝。unknown 追加 needs review 及先核对再发送的指引。blocked 不等同权限 denied。恢复既有 DeliveryReceipt.reason 到 Pocket DTO 的透传，不从状态或文本猜测原因；只有精确 blocked/aborted 字面量分类，其他自由文本或缺省 reason 使用中性 not delivered，缺省时不伪造 data-receipt-reason。本批不改变既有 receipt 清除时机，也不增加服务端不存在的权限原因。
- `reference.css` 字节、home/conv 卡片几何和既有原生调度均不变。样式仅进入产品附加层 `elements.css`。

验证采用真实 `runtimeFixture`、本地确定性 provider、`ownedBrowser` 和真实 SSE/RPC，不用静态页面或伪造 DTO 代替生产路径。工具 gate 同时证明 live 与已落盘声明的同 callId 前提，再断言跨转换唯一卡片、输出归位和节点连续性。合法非内联图片需实际 DOM 证据；孤儿通过受控历史截断验证。若某状态没有可达的真实生产路径，保留明确的覆盖缺口，不把纯分类函数或 mock 结果称为端到端证据。

本批次选用独立渲染/a11y/门禁复核及指定 adversarial review。前者核对实际桌面和移动端的可读性、占位中性色、命中区和参考几何；后者在固定快照上保留双方意见和争议。阶段 GUI acceptance 若另选，必须另行提供隔离 Linux 环境，不能用这些检查代替。

### 6.2 2026-10-24 主次文字、表单与 SVG 图标整检

用户手动查看冻结 P0 预览后指出 model ID 与 profile `default` 贴连，要求主动找出同类难读排版；随后要求所有箭头/图标使用 SVG，补报凭据表单的标签、输入和替换/清除按钮粘连，并明确固定标题采用 `People & Invitations` 一类 Title Case、Dictate 应显示麦克风图标而不是文字占位。本批采用这组呈现修正，恢复与设置路由仍保留原确认边界。

真实产品/本地确定性 provider 的桌面与手机取证确认：model 主次文字零间距且同色，凭据 form 缺布局，Team 的 notes version/保存按钮紧贴，Conversation/Fork 相邻字段无间距且分区标题比弹层标题更重。修复针对布局缺失，不通过拼接空格、猜测后端字段或覆盖 reference.css 来遮掩。

进一步实际检查确认公共 Button/Field/Notice/Stack 缺默认呈现，造成扩展动作无 padding、Memory scope 标签贴边、核对说明和按钮连读及 Scheduled Inputs 控件退回灰底默认样式。公共原语补齐默认排版，不通过按插件硬编码其状态或权限来修外观。固定标题逐字修正；用户命名、模型 ID 和第三方自定义标题保持原文。Dictate 的 idle/listening 分别采用共享 SVG microphone/stop，保留浏览器识别、草稿、明确 Send 和生命周期清理的全部既有语义。

采用相对文字角色、明确字段/动作分组和可换行布局，保留完整原生 ID、写密钥的 password 语义及所有 admission/reconciliation 行为。图标整检覆盖快捷键、折叠标记及 MAS DevPack 方向展示；正常文本标点、用户内容与反应数据中的语义值保持原值。验证以各实际入口、默认/大字号和 360×600、390×650、390×844 为矩阵，保存前后截图及实测间距，补真正能在旧候选失败的浏览器回归。实际检查的范围与未覆盖项分别记录，不据有限矩阵宣称穷尽所有界面状态。

用户随后提供首页输入的直角蓝框截图。实测根因是 `.composer-surface:has(textarea:focus-visible)` 对包含提示条、编辑器与工具栏的内部直角容器描边；文本输入经鼠标点击也可匹配 focus-visible，并非仅由 Tab 引起。指示改由具有实际圆角和完整边界的外层 `.composer-card` 承担。回归分别通过真实 pointer、Tab/Shift+Tab 在桌面/手机核对焦点、边界和零模型请求，保留键盘可见性。

2026-10-25 用户另报发送/下拉按钮的 Tab 描边只剩接缝竖线。真实键盘与 PNG 实测确认 `.send-group` 的 `overflow:hidden` 裁掉了通用 `outline-offset:2px` 的外侧描边；该问题独立于编辑器外层卡片焦点。附加样式将各按钮的 2px 描边内移到本按钮边界内，首尾继承胶囊对应圆角，中间按钮保持直边。保留 group 裁切、按钮几何、原始 reference.css 和原生调度；检查首页/Conversation、明暗主题、桌面/手机、空输入与真实 busy/Steer/Stop，并对实际 PNG 四侧采样，避免 computed outline 存在却不可见仍算通过。

### 6.3 Session / Conversation 创建关系调查

用户提出独立 Conversation 创建弹窗，并要求识别 Pi Durable 中 Session 包含 Conversations 的关系。2026-10-25 用户再次指出首页 `Name a conversation` 与创建配置混用，要求澄清并立 New Session / Session 内 New Conversation、首次预填父 Session，以及 `Sort Per Session` / `Default` 两种 sidebar 模式。本节记录这一方向的澄清候选；本轮没有修改产品代码，也未将候选细节记为已采用、已实现或已验收。

当前代码证据：`Frontend` 把 home 的命名 textarea 直接绑定 `App.createConversation`；该方法仅发送 `op:"create"`，`PocketWorkspace.create` 使用单 runtime catalog 的 enroll，原生 adapter 的 `tx.createConversation` 继承同一 runtime 的 sessionId。`startPocket` 只装配一个 `createRuntime`，sidebar 当前用 Sessions 表头展示 Conversation refs。因而现有 New Session 名称没有对应的新 Durable Session 效果。

#### 概念与当前缺口

- WebUI 工作区承载登录身份与产品导航；Durable Session 是其管理的真实存储/原子提交域，一个 Session 容纳多个 Conversations。Conversation 持有自己的 transcript、上下文与 agent 配置，归属一个 Session。
- 用户文件夹是导航元数据，与上述原生父子关系正交。浏览器登录 session、cwd、独立进程也分别是其他边界。新建 Durable Session 不能用新名称、新文件夹或再次完整启动一个有独立登录身份的 WebUI 来替代；它也不自动提供进程隔离。
- 当前命名 textarea 是创建表单，不是向模型发送首条消息；把它放在 composer 的外形中，让创建、命名与聊天混淆。现有 create 还可能继承来源 Conversation 的配置，却没有专门的创建配置确认步骤。仅换 placeholder 或按钮名称不足以闭合这一缺口。

#### 建议的创建交互

| 入口             | 弹窗/向导表达的对象                                                                                | 确认后的效果                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| New Session      | 新 Session 名称及必要存储/工作目录配置，沿用服务身份与权限；是否同时创建首个 Conversation 明确展示 | 建立真实 Session；如包含首个 Conversation，分别呈现两步的身份与结果    |
| New Conversation | 父 Session、Conversation 名称、初始模型与 cwd；导航文件夹可另选，不配置逐模型权限                  | 仅在指定 Session 中建立 Conversation，打开后才由明确 Send 提交模型输入 |

从一个 Session 分组发起时预选该父项；从文件夹视图发起时，文件夹不能替用户确定原生 Session。已有可用父 Session 时选择或确认父项，不为每次 New Conversation 都创建新 Session。

仅在 WebUI 管理的 Session 授权清单成功读取，且没有可作为父项的 Session 时，在同一创建向导预填一个待建 Session，让用户看到并可编辑它，再显式确认 `New Session → New Conversation in that Session`。预填是表单草稿，不是打开弹窗就创建后台资源。加载、读取失败或无权获知清单不能当作“没有 Session”；引导不绕过创建权限，也不静默把未纳管的底层 bootstrap/root 当作用户已创建的 Session。

两步创建保留各自的原请求/核对身份。Session 已确认建立、Conversation 失败时呈现部分成功，并针对该 Session 接续第二步；未知结果先核对，不自动重建 Session，不声称跨存储原子回滚。具体管理协议、现有人类身份/资源权限的复用、可编辑的 Session 级配置及首次 Conversation 策略仍待设计采用；模型与相关权限的精简按 §6.5 的用户纠偏采用。

#### 建议的 sidebar 两种投影

| 模式原文         | 分组                                                      | 原生数据效果          |
| ---------------- | --------------------------------------------------------- | --------------------- |
| Sort Per Session | Session → 多个 Conversations                              | 按真实父 Session 展示 |
| Default          | 用户创建的文件夹 → 多个 Conversations，未归类项有可达分组 | 按用户导航归类展示    |

两者使用同一批当前授权的 Conversation 引用。文件夹可以归纳来自不同 Session 的 Conversations；行项目保留识别实际父 Session 的读取路径。切换模式、移动文件夹归类和删除文件夹均只改变导航，不迁移 transcript、cwd、权限或额度，也不删除原生 Conversation/Session。文件夹不是磁盘 cwd，更不是另一种 Session。

首版可采用个人持久化文件夹/视图偏好；这是设计建议，不把共享文件夹、ACL 继承、多重归类或多级目录擅自纳入已采用范围。原生归属引用必须至少区分 Session / Conversation，并继续绑定适用 incarnation；显示名称或裸 conversationId 不足以跨 Session 寻址。服务授权在返回分组与元数据前完成，不让名称和数量泄漏不可读资源。

#### 实施前仍需落实

真正的 Session 管理端口、持久注册与当前 WebUI 身份如何跨已纳管 Session 授权；单 writer、独立存储与 Pakka 预算配置/已消费额度的保留；现有单 runtime 数据如何识别并登记；文件夹元数据的持久归属及删除语义。先以真实 runtime 验证两个 Session、跨 Session 同 Conversation ID、重开/撤权与两步部分成功，再实现 sidebar。独立弹窗与模式标签不能冒充这些运行时能力。

### 6.4 2026-10-25 Model Selection 检索索引

用户要求在 Model Selection 加入类似 Pi coding agent TUI `/model` 的索引体验。直接阅读本机 Pi 1.4.0 的 `ModelSelectorComponent`、`getModelSelectorSearchText` 和公开 `fuzzyFilter` 实现，确认其搜索输入始终存在；非空检索重置候选、上下键循环、Enter 确认、Escape 取消、当前模型独立标记及长列表位置计数。它没有行号数字快捷选择。本批将这些交互关系适配到浏览器搜索 combobox/listbox，并对所有列表显示位置计数。

此前 WebUI 只在超过 8 个批准模型时提供连续子串搜索，默认焦点落在关闭按钮，上下键移到行按钮后不能继续直接输入查询。本批采用常驻检索、词内有序字符匹配和紧密匹配优先；多词按空格或 `/` 分隔，覆盖真实模型与批准 profile 标识。候选高亮与已应用模型分别呈现；保留鼠标/触屏和原有配置命令、权限、busy、unknown 处理。候选滚动限定在列表，搜索入口和位置反馈可达；IME 组合按文本输入处理。

Pi 是本用户请求指定的交互来源；外观继续使用现有 Pakka Sheet、SVG Icon、主次文字和主题 tokens，不修改固定 reference.css，不导入 Pi 私有模块，不扩展模型发现、供应商认证或配置协议。测试先验证上述可观察差距，再经真实 runtime/本地 provider、HTTP 和浏览器操作确认选择后的实际模型。独立复核按用户当前会话指令不再安排。

### 6.5 2026-10-25 模型与相关权限精简

用户明确指出不需要“获准模型”这种权限配置，并要求检查相关权限的过度配置。本节采用这项纠偏；§6.3 的完整创建/Session 管理仍是待实现方向，不因本轮采用模型精简而整体获批。

#### 直接采用的边界

模型是 Conversation 的普通配置。可用目录由当前 provider 的服务端启动配置派生；现有实现的来源是 runtime.model 与 runtime.profiles 中的 model 值，并非自动调用远端模型发现。具备 Conversation 配置权限的人可选择目录里的任一模型，不再叠加按人、按 Session 或逐模型的批准名单；浏览器也不提交 endpoint、凭据或配置模块。模型目录按 model ID 去重、保留首次出现顺序，以首个配置标识作展示标识；只发布 id/model，完整预设的 cwd、工具和指令不是模型候选元数据。

整组 Agent 预设可能改变工具、指令及工作目录。顶层 profiles / PocketWorkspaceOptions.profileCeiling 保留在 create、整组 configure 和 fork 的预设边界，不再用来筛选模型目录或拒绝单独 model/模型继承。模型值仍按实际配置目录验证；busy、旧 incarnation、撤权、预算和 unknown 按原契约核验。模型选择不施加另一条预设的工具/指令，也不要求再次批准该预设。

有限协议同时容纳现有 JSON 启动配置允许的 64 个附加预设及默认模型，即最多 65 个不同模型；仍拒绝第 66 项，不按权限截断列表。原 64 候选验证器在合法最大配置下产生真实 HTTP 500/unknown，须与服务端/客户端一起改为 65。协议 envelope 维持 v2；旧的 64 上限客户端需随包更新才能读取 65 项，不能宣称这一边界对旧构建完全兼容。更大的 headless/programmatic 目录不由本 WebUI 有限协议承诺。

#### 相关权限审计

| 位置/关系                                                                              | 观察及处置                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspace.configuration 的 choices、configureAgent(model) 与 create 的 inherited model | 基线 d6199a3 将这些路径再次套入 profileCeiling；本轮拆除这一重复授权，仅保留配置目录内有效模型校验。普通模型选择不用再填写顶层 profiles。                                                                                                   |
| configuration.choices.cwd                                                              | 这是另一个完整预设的目录，不是选择模型所需信息；全目录模型可见后仍不能据此泄漏该预设路径，本轮从候选 DTO 省去。当前 Conversation.cwd 与独立目录选择器各按原资源契约读取。                                                                   |
| configuration.canConfigure                                                             | 基线把 driver 标为可配置，真实 configureAgent/directories 却要求 manage，而 people 中仅 admin 有 manage；本轮使提示与现有资源写权限一致，不增加模型专属角色/开关。                                                                          |
| profileCeiling 与整组 Agent 预设                                                       | 预设会影响工具/指令/cwd，现有服务有真实消费者与拒绝测试；保留这个独立边界，不把“可用模型”当作工具提权许可，也不将其放进普通 Conversation 创建表单作为另一组模型授权。                                                                       |
| cwdRoots、目录 canonicalization 与默认预设 roots                                       | 约束服务器目录浏览/应用以及 symlink 逃逸，有真实读取效果；保留受信任根目录约束。已提供 cwdRoots 时直接使用该目录树，不为子项目制造“模型×目录”许可组合。旧 roots 从完整预设推导的兼容分支不新增配置项。                                      |
| 登录身份、角色、资源 scope 与 driver lease                                             | 前者约束人类读取/写入，后者处理输入协作控制；不取消真实远程/多人边界。保留等待后的重验，因为撤权可能在 await 期间发生；这不是额外让用户配置一层 ACL。                                                                                       |
| Session 创建与个人文件夹草案                                                           | 创建向导填写名称、父项、初始模型/cwd及必要存储配置，复用当前身份/资源权限；不新增逐 Session 模型许可、逐文件夹 ACL、ACL 继承矩阵。个人文件夹仅为当前人的导航元数据，分组不发放原生资源权限；跨 Session 标识和 writer 仍按真实数据关系处理。 |
| provider 凭据、扩展可信代码与持久效果                                                  | 写密钥、安装代码和存储 writer 都有不同于选择模型的真实效果；保留现有专用命令、当前资源绑定与 unknown 核对，不把这些检查扩展成创建弹窗里的逐项授权表。                                                                                       |

没有证据支持把 viewer/sender/driver/admin 全部合并或关闭资源鉴权；本轮不擅自改变这些已采用角色的动作集合。上述 canConfigure 矛盾是已有实现错误，修正提示而非暗中放大 driver 权限。用户提出的“精简”落实为移除不对应独立效果的权限配置和重复决策，而不是 fail-open。

#### 行为验证

先在真实 startPocket + 本地确定性 HTTP provider 上取得 RED：仅允许 default 完整预设时，另一个已配置模型仍应进入候选；单独应用它不得套用另一个预设的指令/cwd，且创建继承、正常重开、已花额度和原回执都保留。未知模型与整组受限预设仍在效果前拒绝。模型候选不返回 cwd、endpoint 或凭据；不同角色的提示与实际写入一致。原配置/browser/recovery/目录/多人边界同时回归，失败原日志与最终候选分别记录；按本会话指令只做实现者自检，不恢复独立复核。

## 7. 实施检查与决策点

建议开发检查包括真实 Pi/本地确定性 provider 的恢复与 HTTP 回归、发行竞争/故障注入、仓库外 CLI、路由与表单的浏览器回归；每项只报告实际版本和范围。Verification 选用规则见第 1 节，不从前一轮复制跳过记录。

采用前需用户确认本方案的整体方向，重点是：停服式本机恢复、默认 10 分钟、原 owner 的旧登录全部撤销。Windows 文件保护、维护 API 组合和故障协议是实施前必须取得信息的试做，不是假定已经解决的条件。
