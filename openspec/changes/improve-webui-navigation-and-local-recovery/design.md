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

### 6.3 Session / Conversation 创建关系调查

用户提出独立 Conversation 创建弹窗，并要求识别 Pi Durable 中 Session 包含 Conversations 的关系，考虑并立 New Session 与 Session 内 New Conversation、无父 Session 时预填并按 New Session → New Conversation 顺序创建，以及 sidebar 文件夹归类。这是超出本轮排版的产品/运行时设计方向，具体服务协议与恢复行为仍由后续设计及任务承接，未以已实现或已验收记账。

当前代码证据：`Frontend` 把 home 的命名 textarea 直接绑定 `App.createConversation`；该方法仅发送 `op:"create"`，`PocketWorkspace.create` 使用单 runtime catalog 的 enroll，原生 adapter 的 `tx.createConversation` 继承同一 runtime 的 sessionId。`startPocket` 只装配一个 `createRuntime`，sidebar 当前用 Sessions 表头展示 Conversation refs。因而现有 New Session 名称没有对应的新 Durable Session 效果。

后续实现应先明确真正的 Session 管理端口和持久注册，再由独立创建弹窗显示父 Session、Conversation 名称以及宿主允许的初始模型/目录。New Session 创建独立存储/额度域；New Conversation 只写选定父 Session。无可用父 Session 时，弹窗预填父 Session，并保留两步各自的原请求/核对身份；第二步失败时准确显示已建立的 Session，而不是重放第一步或释放未知结果。Session 身份、权限、单 writer 与预算都以真实 runtime 为准，文件夹仅承担人类导航归类，不改变 Conversation 原生归属。后续需先验证不同 Session 中同 Conversation ID 的授权隔离、重开与撤权，再扩展 sidebar。

## 7. 实施检查与决策点

建议开发检查包括真实 Pi/本地确定性 provider 的恢复与 HTTP 回归、发行竞争/故障注入、仓库外 CLI、路由与表单的浏览器回归；每项只报告实际版本和范围。Verification 选用规则见第 1 节，不从前一轮复制跳过记录。

采用前需用户确认本方案的整体方向，重点是：停服式本机恢复、默认 10 分钟、原 owner 的旧登录全部撤销。Windows 文件保护、维护 API 组合和故障协议是实施前必须取得信息的试做，不是假定已经解决的条件。
