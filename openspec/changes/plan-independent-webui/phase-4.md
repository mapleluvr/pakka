# 阶段 4：功能与所有者接续

用户已授权在阶段 3 完成后执行本阶段。起点为 Pakka `1b5111f` / pakka-webui `f1275d8`；两份配对 Draft PR 已推送，默认产品切换仍在阶段 5。功能归属按 [inventory](inventory.md#2-功能保留与实现归属)，总退出条件按 [tasks §6](tasks.md#6-阶段-4按功能与所有者补齐)。

## 实施依据与顺序

固定的是独立 React/TSX/Astryx 前端、公开协议消费、权限/原身份/原请求、原生调度与插件领域归属。页面和组合从这些需求形成；旧页面只核对功能、条件与服务调用，旧布局和目录不作为模板。由主会话核对源码与真实运行，不委派调查或 review。

1. Conversation：输入原请求查询、实时观察与重连、排队/撤回/停止、正文与工具、历史分页和原文能力。先打通公开查询与 UI 恢复，再发展观察呈现。
2. 工作台与身份：授权 Session/Conversation 清单、创建/显式重开、命名/归档/fork、个人组织与路由、邀请/人员与登录目的地。
3. 设置：现有模型/Thinking/连接/Person 默认的完整交互，Session 预算与原请求、Conversation 目录/预设、外观和扩展/facet 控制；所有入口覆盖键盘和窄屏。
4. 插件：RSI 继续由所属包维护；以 MAS DevPack 作为第二个真实业务消费者，验证同一装载、服务、资源导航和生命周期机制。文件/Git、审批、浏览器、Memory、定时输入和 Webhook 等既有能力按各自所有者接续，不能写成宿主业务分支。
5. 清单收口：人类协作、通知、语音草稿、搜索/复制/下载等逐项记录真实覆盖；实际延期/取消须有既有决策或具体阻塞依据，不能以旧代码退出代替功能实现。Provider `/login`、Memo GUI/Book 与删除/retention 沿既有专属任务，不在本阶段自行启动。

顺序表示实施批次，不将后续项视为已完成或自动延期。服务新增能力可按实际消费者形成，但仍使用闭合 DTO/decoder、固定包与制品兼容声明。

## 首项：普通输入的原请求查询

现有 `RuntimeCatalog.lookupRequest` 读取原始持久 admission，核对 principal、source、target、requestId、text、mode；调用不进入 `deliver`。workspace 负责 Person 与当前 read 权限，managed Sessions 路由到原 Session，外部 Conversation 来源须显式提供自己的查询能力，缺少能力时拒绝而不是返回假空值。

候选公开入口为 WebUI services 的 `input.lookup`，传入完整原 `target + input`，返回关联原请求和 target 的可空回执。services API 升到 4；workbench 2 与 extensions 3 保持各自契约。复用原输入/回执校验，不放宽现有 wire shape。前端发送前保存完整原绑定与输入；查询使用新运输 requestId、原操作身份不变。查询空值、unknown、读取失败及损坏本地记录均保持原请求与阻止重发。已知 receipt 的观察/撤回和新输入是各自操作。

原 Session 正常重开、已失效 incarnation、未加载来源和其他人同号 request 的处理分别核对，不把稳定资源引用当成当前执行绑定，也不为了查回执自动打开 writer。

## Conversation 配置与原请求

目录/preset 入口核对发现：原 configure/configure.agent 仅返回新运行绑定，没有可按原请求读取的持久结果；原模型 hook 也只在内存保留未知状态。按既有持久效果要求补入原生 catalog 事务回执，不另设 WebUI 配置账本。配置、绑定轮换与回执在同一事务中提交；失败整体回滚。回执保存完整原参数、发起人和历史结果，查询接受原来的旧 incarnation；当前管理权限与已登记资源仍须核对。

services API 4 候选提供 conversation-configuration.read/write/lookup，workbench 2 保持现有可信消费者契约。读取同时给出当前允许的 preset 和来源是否具备原请求恢复能力；插件来源由其所有者显式提供配置/回执方法。页面在发送前按来源、Person、Session、Conversation 保留原请求。空查询或未知效果保持待核对；查回结果后单独重新解析当前配置，不把后来改过的当前值当作旧操作回执。preset 替换包含该 preset 的模型、Thinking、工具、指令与目录，单项配置只改变选择的字段。

此处新增持久检查针对原子回滚、旧绑定跨重开读取与原请求相关性，归入现有 runtime-configuration（heavy）、WebUI services（heavy）和 client service（light）文件；WebUI affected 集合补入 runtime-configuration。界面组合继续用真实浏览器验证，不固定临时 DOM/props。

## 扩展/facet 设置

沿用 extensions 3 的逐 facet 控制和原请求查询，未新增领域控制通道。设置按 Backend/Agent/WebUI/Client 独立保存原请求，历史回执与新读取的当前状态分别呈现。WebUI 控制后调用通用宿主同步；实测发现旧 refresh 会复用控制前已发出的发现请求，已改为串行新读取。闭合 control DTO 显式选择协议字段，列表 registration 不进入请求。

隔离真页核对了 Client/Backend 停用不卸载 UI、Backend 丢响应只查询原请求、Agent 控制跨原 Session 重开及两次实际本地模型请求、WebUI 旧实例/Dialog/计时器/样式清理、延迟发现响应、unknown 初始化不重入、旧 generation 拒绝、回执/当前状态区分、390px 和撤权清理。相关原始证据暂存独立前端 `docs/.temp/phase-4/facets-summary.md`；本项尚非阶段 4 总验收或仓库外固定制品复验。沿少测试政策使用可丢弃真实探针，不新增临时 DOM/props 持久断言；既有 facet 安全与持久回归保留在阶段末受影响集合。

## 正文、工具与原文

核对原文契约后保留了两种坐标：存档范围按 JSON 转义后的字节读取，搜索游标同时保存读取段和解码字符位置。新下载入口 `/pakka-webui/resources/content/download` 采用已登记的稳定 Conversation 引用，经 `resource.content` 重验身份、版本与权限；复用流式输出，覆盖未加载来源与 fork。协议公开出口随前端固定归档更新，不把工作区新增出口当成已交付。

工具卡按原 Session、来源 Conversation 和调用 ID 合并声明、活动输出与结果；单纯隐藏 DOM 的草稿未满足释放正文要求，改用 TanStack 历史窗口与原文行虚拟化，控制位置单独保存。真页发现只存 scrollTop 会在动态测量后漂移，最终用行锚点、行内偏移和上游按行定位恢复。Markdown 使用 react-markdown/remark-gfm，跳过 HTML、过滤危险 URL；图片按需读取，下载与原文搜索有独立范围说明。

局部 HTTP 与浏览器核对覆盖了精确正文/图片下载、跨段中文/emoji/转义搜索、已存截断说明、未加载 fork、读取取消/晚到响应、390px 与撤权清理。实际工具采集上限与公开 Durable commit 的长存档样例分别记录，不以样例绕过产品限额宣称工具输出完整。一次 `fetch(blob:)` 诊断被 CSP 拒绝，其 URL 释放结论已撤回；图片字节与 DOM 清理结论保留。原始证据与失败更正见独立前端 `docs/.temp/phase-4/content-summary.md`，阶段末再绑定最终固定制品。

测试选择延续现有 content-download-http / stored-history 的真实权限与内容版本边界；UI 搜索、虚拟化、复制和排版使用临时真实路径探针，不新增永久 DOM/props 测试。动态高度/位移使用虚拟库公开几何值，inline-style 提示不改成静态 CSS 来掩盖运行需求。

## 文件/Git 与目标插件地址

文件/Git 新页面由原 contribution 包提供，保留受控根目录、hash 冲突、Git 空闲检查与持久文件回执。浏览器以稳定 Person/Session/Conversation 身份保存原请求与草稿；已接纳结果不明时按 extension operation → 文件 receipt 恢复。已有服务回归继续承接权限、路径边界与真实磁盘/Git 效果，界面与导航使用临时真页探针，不新增永久 DOM 测试。

实际刷新发现目标 plugin publication 只由先前 Conversation 实例建立，原请求虽然还在却无法直接打开页面。接入层增加按稳定地址准备贡献的流程，重新解析/授权原 Conversation，挂载前核对页面资源与服务绑定。通用 registry 显式区分用户关闭与 publication 替换，单独恢复的 scope 在最后实例关闭时释放，不影响持久工作。隐藏文件页面的移除 Dialog 与返回后的焦点也经真实复现后修正。

局部真页覆盖文本/图片原字节、冲突草稿、HTML inert 上传、真实 diff/分支/worktree、断响应与原 Session 重开、四次正常重开、390px、只读成员与撤权清理。另用公开服务装配在真实写入/回执之后延迟返回，验证一次写入/一次外层查询/一次按 operation ID 的内层查询，WebUI 重载与刷新不重提。两轮各零模型请求。首次断流探针、RPC 名、原生 Dialog 选择器、客户端先于 Backend 超时等失败更正保留在独立前端 `docs/.temp/phase-4/files-summary.md`；最终固定制品验收仍在阶段末。

## 原生工具审批

审批 contribution 已改用 React/Astryx，沿现有原生调用 capability 和一次决定机制。页面分别显示决定回执和工具状态；发送前按 Person/Session/Conversation/approval 保存完整原请求，响应未知按 operationByRequest 查询，工具列表变化不自动证明原决定成功。原服务不增加长期授权或重放路径。

局部真页覆盖允许的断响应/刷新/原 Session 重开（一次决定/一次查询/一次效果）、键盘拒绝、工具晚到超时、效果后抛错、旧未知保留时另一调用继续决定、关闭页面仍等待、pending 重开 unknown、原生到期、只读 HTTP 拒绝、390px 与延迟读取/撤权清理。两轮本地 provider 分别 12/3 次请求、3/0 次效果，服务正常停止；刷新后错误监听缺失与计数探针更正在独立前端 `docs/.temp/phase-4/approvals-summary.md` 保留。

既有 approvals-browser 固定旧 Preact 控件，独特的真实 extension HTTP → 原生审批/工具/通知链路下沉到 approvals-http，仍在 WebUI affected/release heavy；原生 pocket-approvals 回归继续覆盖调用权限、取消与生效前复核。当前 UI 使用临时真实浏览器检查，不新增永久 DOM 形状断言。构建补齐声明的 Client 入口，与 WebUI 同次生成，资产校验保持严格。最终固定安装版验收仍在阶段末。

## 服务器浏览器

浏览器 contribution 已接共享 React/Astryx，沿公开受控站点、frame 与动作服务。页面在发送前保留完整原请求，查询先取得 extension operation，再按 operation ID 查询服务回执；外层 done / 内层 unknown 分别处理。浏览器动作回执不替代网页异步业务结果。关闭界面停止观察，浏览器仍由服务持有，服务正常重开清理原 profile。

局部真页覆盖导航/填入/点击、断响应跨重开、返回过晚的两层查询、unknown 保留、暂停/关闭与晚到读取、WebUI 重载、只读/他人查询拒绝、390px 和撤权清理。第一轮一次重开、两次预期网页效果，第二轮复验精简文案及撤权后重新登录的提示清理；两轮均零模型请求、零越界网络请求，服务正常停止、profile 清空。探针选择器/状态节点错误与监听范围保留在独立前端 `docs/.temp/phase-4/browser-summary.md`。

原生 pocket-browser 回归与新增 browser-contribution-http 回归通过；后者保护原生服务单独未覆盖的 extension operation → 服务 receipt 身份和嵌套 unknown 边界，属于 WebUI affected/release heavy。界面不增永久 DOM/props 测试。类型/构建与主动 LSP 通过，最终固定安装版配对仍在阶段末。

## Memory 建议与上下文

Memory contribution 已接共享 React/Astryx，沿原项目/Session 全局作用域、owner 审批与原生上下文来源。发送前保存完整原请求与已提交草稿，响应不明时按 extension operation → Memory operation 查询；重新读取的当前内容不替代回执。编辑状态独立于清单分类，冲突保留草稿，显式采用当前版本后继续编辑。

局部真页验证了成员建议的断响应/刷新/原 Session 重开（一次添加/一次查询）、批准已落盘后的外层超时及两层查询（一次批准/一次外层/一次内层查询）、WebUI 重载、成员与 Agent 建议在批准前后真实模型上下文的差异、暂停、冲突草稿、作用域筛选/分页、390px、键盘忘记、关闭/晚到读取及撤权/只读清理。第一轮本地 provider 错把工具后的 system context 更新当成继续调用条件，产生 17 条建议直至 20 次预算停止；保留该失败，不计正常 Agent 链路完成。修正 provider 后新数据以 2 次请求完成一条 Agent 建议，第 3 次请求确认批准后上下文。两轮正常退出、服务错误 0，原始证据和探针更正见独立前端 `docs/.temp/phase-4/memory-summary.md`。

四组原生 Memory 回归与新增 memory-http 均通过，后者接续旧 Preact browser 中独特的扩展 HTTP/服务身份、建议私密性和实际上下文边界，属于 WebUI affected/release heavy；界面交互使用临时真实探针。Client 入口按 publicDir 解析，manifest 与同次构建已配对，严格资产校验保持。类型/构建与主动 LSP 通过，最终固定安装版验证在阶段末。

## 定时输入与取消请求

定时输入 contribution 已接共享 React/Astryx，计划仍由原生 schedules/job/Conversation 投递路径持有。发送前按 Person/extension/Session/Conversation 保存完整原请求，登记和逐计划取消独立。响应不明按 operationByRequest 查询，原结果与新清单状态分离，unknown 不据当前已取消状态解除。取消已有持久标记通过 cancellationRequested 公开，动作 schema 显式升到 2；marked 与 nativeTerminal 分开说明，不将原生 abort 返回误当同步终态，不取消已经投递的输入。

局部真页验证登记断响应/刷新/原 Session 重开（一次登记/一次查询/零模型请求）、取消回执 waiting 但标记已确认后单独读到 aborted、页面关闭后的两次有限投递、取消后原输入/模型请求完成而后两次不投递、外层 unknown 保留、WebUI 重载旧实例/样式释放、另一 Conversation 待核对隔离、22 条合法原生记录的 20/2 分页筛选、390px 实际新建与取消、延迟读取/撤权及只读拒绝。一轮正常重开、3 次本地模型请求/预算、服务错误 0；服务与隔离开发监听均已结束。原始证据与装配/监听/选择器/样式/JSX 归一更正见独立前端 `docs/.temp/phase-4/schedules-summary.md`，最终固定配对仍在阶段末。

原生 pocket-schedules 三组与 schedules-http 共 14 项通过，后者接续旧 schedules-browser/recovery 的独特真实 HTTP/operation/native job/投递/权限边界，WebUI affected/release 仍 heavy。旧 Preact 控件断言退休，当前交互使用临时真实路径探针，不新增永久 DOM/props 测试。类型/构建及主动 LSP error 检查通过，辅助提示和已有策略过滤不作为全量 clean，未追加 lint 清理或类型抑制。

## Webhook 管理、回执与外部投递

Webhook contribution 已接共享 React/Astryx，沿原生签名/密钥、创建者授权、有限配额和 Conversation 准入。目录/preset 换绑的真实反例显示旧端点仍活动却被管理清单隐藏，外层 operation 也被旧 incarnation 检查拒绝。修正按用途分开：清单、管理和回执按稳定 Session/Conversation 与当前所需权限核对，原请求仍匹配完整旧 target 和 actor；外部投递继续使用不可变原绑定，换绑后旧地址拒绝。端点变更账本、指纹与原结果身份保持，歧义原生 requestId 不任选结果。extension 历史查询与新执行的权限边界分别核对。

局部真页完成登记/移除断响应跨目录换绑和原 Session 重开、轮换已落盘后 outer unknown 的两层查询、签名准入/外部正文过滤/同正文换 delivery header 不重放、原生接纳 unknown、390px 创建与私密设置、暂停私密读取/晚到结果、WebUI 替换、关闭后原模型继续、21 条分页搜索、撤权清理与只读目标隔离。移动移除确认区完全留在屏幕上方的缺陷已定点修正为允许聚焦滚动；相同 390×844 入口复验确认区完整可见、触控返回回焦且未新增移除。两次正常重开、3 次本地模型请求/预算、服务错误 0，隔离服务与开发监听已结束。探针 HTTP 层级、刷新监听与 952px 视口失败分别保留，原始证据在独立前端 `docs/.temp/phase-4/hooks-summary.md`；最终固定制品仍在阶段末。

原生 Hook 与 extension 边界、hooks-http、hooks-busy 的最终 10 文件/38 项全部通过。新 HTTP 接续独特的 socket/operation/native receipt、秘密隔离、签名、当前权限与旧绑定边界，WebUI affected/release 保持 heavy。旧 hooks-recovery/read-boundary 的 Preact 控件断言在对应新页面通过后退休；busy 的原生队列与 Backend 停用边界保留，并改走 `/pakka-webui/ingress` 实测。全量类型检查、同次插件构建通过；最终 8 文件新进程 LSP 无过滤 0 诊断，不把常驻 push-only 的未确认结果当作 clean。

## 人类协作、原请求与 driver

沿实际公开操作确定人类协作对象为 side chat、notes、pins/reactions、短期 presence 与 driver，未套用审批或任务分派。只读成员可聊天/reaction；笔记、置顶和 driver 操作核对各自授权，最终模型输入由原生 driver/期限准入约束。修改效果和原请求回执同一次协作存储 CAS 提交；查询匹配原发起人、原意和完整旧绑定，当前所需权限重验。历史回执与当前共享状态分开，presence 仅由所属短期观察维护。

局部真页覆盖聊天/引用/提及、notes 冲突草稿、pins/reactions 原请求恢复、目录/preset 换绑和原 Session 重开、driver 拒绝与接管后的真实输入、20 条分页/筛选、390px 键盘/触控、暂停/关闭和晚到读取、撤权、只读与另一目标地址隔离。聊天和 driver 的断响应重开均只查询原请求，未重提；note 的原回执版本 5 与当前版本 6 独立显示。最终原数据 27 条、note 7、driver 已释放，只有 1 次本地模型请求/预算，实际请求未混入人类聊天或 note。

只读观察发现历史 user 角色被无依据地标成当前查看者“你”，提及列表也将历史参与者称作“在场”；文案分别修正为 User 和“提及成员”。四文件格式编译归一除这两处文字外一致，Prettier 的尾空格 JSX 节点拆分已恢复。PC 与 390px 原生 dialog/触控及直接图检查另行通过。原后台采集错用 2 MiB，被原生 1 MiB 协调器契约拒绝；旧 writer 退出后以公开 Runtime 正确重读同一 Session，没有新增模型请求。snapshot envelope 漏字段、旧声明缓存、reaction wire 名、刷新监听、952px 视口、隔离服务到期与原生 dialog 选择器等失败保留在独立前端 `docs/.temp/phase-4/collaboration-summary.md`，不计作通过或据此放宽产品。

现有四文件/14 项回归通过：server 6、HTTP 1、client 5、protocol 2。新增持久检查针对实际 CAS 回滚/丢返回和原请求相关性，沿已有 server/WebUI heavy、client/protocol light 分类；界面使用临时真实探针，不增永久 DOM/props 断言。前端类型/build 与五文件主动 LSP 类型检查通过，7 条辅助建议与真实 I/O 边界/签名分别核对，不冒充全量 clean。原数据、caption 只读复验与开发监听均已正常结束；最终固定制品与完整安装仍在阶段末。

## 通知设置、事件与原生显示

沿通知实际契约区分 Person 偏好、Conversation 设备登记与设备整体停用；本浏览器的权限和原生订阅是独立状态。工作台修改将效果与回执写入通知存储同一次 CAS；services 4 的 `notification.lookup` 只读取完整原工作台修改请求对应的结果，查询重验当前读取权限并保留旧完整绑定。偏好后续变化、设备变化和原 Session 重开不覆盖旧回执；null/unknown 保持原请求，其他操作各自继续。

独立前端提供设置与专用 worker。wake 只含 eventId/deviceId，通过 `/pakka-webui/notifications/event` 受权取得内容，点击再次授权并导航原 Conversation。公共 worker 地址 `/pakka-webui/service-worker.js` 映射固定应用 `notification-worker.js`，开发和生产提供根 scope 许可。推送 HTTP 接纳、浏览器显示调用与系统实际显示分开记录，权限提示由用户处理。

局部真页已覆盖偏好及设备停用断响应/刷新/换绑/原 Session 重开，各一次写入、一次查询；旧偏好与当前值分别显示，设备全部资源解除不依赖当前目标清单。390px 原生触控保存/目标切换/确认及返回回焦、暂停/关闭/晚到读取、撤权和只读成员的个人偏好/目标隔离通过。第一轮服务正常退出：4 次重开、1 次真实本地模型请求、1 次受控 TLS 接纳、服务错误 0；页面关闭后的生产模型完成触发真实加密 HTTPS 投递，但不是浏览器原生推送或 OS 显示证据。

6 文件/19 项最终回归全通过，7 文件主动 LSP 全级别 0，类型与构建通过。路径映射、页面凭据被 setup 轮换、刷新监听、1908px 视口、Portal/隐藏 tab 与 raw hello 身份取值等探针失败保留。停用他人设备的原生 guard 没有生效写入，当前 HTTP 返回 UNKNOWN，未改写为调用人已确认无效果。结果和限制见独立前端 `docs/.temp/phase-4/notifications-summary.md`。

原生轮先确认用户实际允许、本地显示和真实 PushManager 订阅。未批准的浏览器 origin 在持久写入前被拒，原请求查询为空且保持原请求；新隔离配置只许可实际的 `https://jmt17.google.com`，一次登记、一次查询确认本浏览器设备。产品默认白名单保持原样。关闭 Pakka 页面后的真实模型完成由远端推送唤醒 worker，通过同一事件/设备授权读回并实际显示在 Windows。点击再次授权，打开原 Session/Conversation 的真实历史，无新模型请求。该次发送回执仍为 `unknown`，不以浏览器证据改写，也未重发。

撤权清除显示中的通知和页面，释放实际已授权的晚到响应后未恢复；本地订阅独立移除，没有发起服务器设备停用。原生正轮共 1 次模型请求、2 条协作聊天、5 条事件，服务错误 0，相关隔离服务均正常结束。跨固定制品的 worker 替换清理仍需用阶段末安装复验；当前激活、字节核对和撤权清理不代替该检查。

## 外观、语音草稿与工作台界面

独立前端的语音草稿使用浏览器 SpeechRecognition，识别后显式插入当前输入，再沿原输入服务提交。受控识别事件只验证实例隔离、取消、晚到结果和手动草稿；实际显式发送经 production client / Runtime / 本地 Provider。2026-11-19 用户说明本机无录音设备并授权跳过真实录音检查。已核对原生构造器、安全上下文和一次听写入口，录音、语音服务连通性和识别质量保留未验证。外观的浏览器保存、跨页签、系统模式与 body 字体 token 已核对。

UI 调优前的固定候选已在源码树外通过 Node 24 空 consumer 安装，生产 loader 核对 713 资产与 worker 字节。A/B 为相同逻辑的不同编译字节；原 Session 上 A → B → A 更新/回退清理 Pakka 通知、保留隔离非 Pakka 项，旧 worker redundant，授权的旧读取被浏览器取消。这个实际分支与“仍向旧 worker 送达正文”的未覆盖分支分别记录；Node 27 alpha 误打包和激活/等待失败保留。汇总位于仓库外 `verification/phase-4/pre-design-candidate-20261119/CANDIDATE-SUMMARY.md`。

按用户授权用 design-companion 与真实页面迭代侧栏/手机导航、独立阅读、下部输入、紧凑工具栏和消息动作。原文以同一视图的明确阅读模式呈现，搜索框与按钮同行，返回入口位于固定阅读导航；各条搜索与阅读位置独立保留。明确发送接续新回复，手动阅读暂停，同一范围刷新保持阅读实例。普通输入的原记录在重新装载时初始化正文和 mode，原消息详情呈现冻结参数；核对旧请求保留后来另写的草稿。

新隔离轮三种尺寸完整跑通原文打开/搜索/返回，独立确认回焦、原文切换、Thinking/切页阅读位置与发送接续。断响应样例沿同一原请求完成一次写入/一次查询，未新增模型请求；24px 深色和登录退出的正文/固定原文控件/旧下载链接清理通过。共 5 次本地 Provider 请求，完整监听的通过轮次无脚本或 CSP 错误。探针 selector、状态节点、视口、帧时序和初稿原消息呈现的失败及修正分别保留。当前类型/构建通过，push-only LSP 的未确认状态保持限定。正式前端汇总见 `docs/verification/WORKBENCH-INTERFACE.md`，新布局的撤权与最终固定制品复验现已完成代表性路径，安装与覆盖限制见下节。零模型输入的新样例另确认空历史 HTTP 为 loaded、0 条记录、空闲，当前可见页与刷新均实时观察。此前 unavailable 来自隐藏旧 Session 页的无作用域探针，判断已撤回；未据此修改服务或页面。

## 当前固定候选与退出状态

最终候选在 Node 24 仓库外消费 8 个 Backend 包与 713 资产的前端归档，生产入口/HTML/worker 字节核对通过。登录状态与 modal 在壳层共用一个实例，保留桌面与手机入口；较长模型名在 390px 常规字号下与其余三个入口保持同一条 44px 工具栏。真实登录、输入、刷新完成回执、配置窗打开期间撤权，以及手机登录取消/回焦通过。最终差异核对还在安装版复现了确认响应会清掉等待期间新草稿；前端沿用正文比对，仅清空仍对应本次提交的内容。新固定前端复验两次等待确认的新草稿保留、第三笔 390px 正常发送后原稿清空，三笔独立输入各一次 Provider 请求。首次监听遗漏的失败与完整监听补验分别保留，后者脚本/CSP 为 0。服务正常结束、errors 0，Ego 空间已结束；前两轮固定登录/工具栏检查各自一次请求。

扩大回归选取 334 个文件，取得 333 个完成记录；短目录维护两文件/13 项复验通过后，仍有 13 个失败文件、1 个未完成文件。旧默认页面拒绝新 React 插件，旧样式检查等待未发出的请求；原失败与停止记录保留。阶段退出继续受阻，tasks 6.1–6.5 保持未整体勾选，默认切换仍属阶段 5。

固定制品身份、完整本地证据包 hash、分批与最终安装的覆盖范围在[阶段 4 候选记录](../../../docs/verification/INDEPENDENT-WEBUI-PHASE-4.md)。原生录音质量、通知发送 unknown、worker 旧读取取消与未覆盖的旧正文送达分别保留。

## 验证选择

沿重构初期少测试政策，不固定临时 props/DOM/CSS。扩展现有 workspace 持久恢复检查，针对新增公开查询尚未覆盖的不同风险：无 admission 的观察不产生效果；精确原请求跨重开可查；正文/模式/身份冲突拒绝；查询人的权限读前/读后重检。公开服务/client 的闭合 shape 与错误关联、服务版本配对沿已有测试分层核对。HTTP 丢响应、刷新/重开、观察与交互使用真实 Pakka + 本地确定性 provider 和隔离浏览器。

测试分类与受影响集合随具体改动维护，原长路径 ACL、上游声明限制和依赖告警保留，不扩大本阶段到固定 Pi 升级。最终退出仍需两仓类型/构建、干净安装、制品身份、真实 UI/服务路径与清单覆盖；单项通过不等于阶段完成。
