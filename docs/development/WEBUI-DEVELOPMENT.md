# pakka-webui WebUI 与扩展开发规范

本文件维护 WebUI 的服务、扩展、组件、配置与验证方法细则。独立前端/React/Astryx 已采用；本页涉及 `/pocket`、旧 SDK 精确字段和 legacy 装配的内容用于现有实现定位，不是新前端必须兼容的接口。新服务命名空间、模型作用域、插件与清理边界以 [WebUI state](../state/webui.md)和[分仓设计](../../openspec/changes/plan-independent-webui/design.md)为准；权限、持久化和原请求要求继续有效。查文件、职责和 public exports 先读[架构说明](WEBUI-ARCHITECTURE.md)；可维护性、开放组合与重构初期少测试政策见[前端规范](FRONTEND-GUIDELINES.md)。整体预期见 [WebUI state](../state/webui.md)，页面结构与交互由[前端声明](../state/frontend.md)维护；当前工作见[工作入口](../OVERVIEW.md)和所指 OpenSpec tasks。公共 API 通过明确 exports 和独立消费者核对，实际实现较窄不自动缩减目标。

## 1. 产品核心与扩展的分工

| 产品宿主拥有                                  | 扩展贡献                                   |
| --------------------------------------------- | ------------------------------------------ |
| 登录/邀请、当前人类身份、权限检查             | 已声明 scope 下的业务查询与操作            |
| 路由 namespace、导航、Sheet/panel 容器、focus | 导航项、子页面、自定义组件内容             |
| 组件/主题 tokens、loading/error boundary      | settings、图表、表单、成员板等交互内容     |
| command registry、触发器、operation identity  | namespaced command、参数/结果 schema       |
| checked RPC/events、连接/取消/重连            | extension action、client binding、订阅处理 |
| generation、安装/启用/更新/卸载与 assets      | 可选 Agent/Backend/WebUI/Client facet      |

RSI、MAS、Memo 的可视化、业务控制和管线通过右侧通用贡献方式实现；默认与普通插件使用相同公开能力。宿主不建立专用 core store/router 分支或“内置可绕过”标志。GUI-only 扩展无需工作 Session；资源视图与跨 Session 原历史导航也通过通用引用/解析接缝。

## 2. 四个 facet 与构建边界

- **Agent**：真实 native invocation 下的 tools/instructions/策略服务；保持现有受控端口，不向插件返回 raw Pi 对象。
- **Backend**：认证后业务查询/命令、scoped persistence、受控 job。注册 schema 和权限，不直接把任意 callback 暴露为网络 handler。
- **WebUI**：普通 React content、command/action 和界面贡献，共享宿主 React/Astryx、主题及 portal，不自带第二份运行时。
- **Client**：对已存在 backend action/event 的类型化编码、解码和调用，不自行授予权限或定义服务端没有的命令。

一个扩展可以只实现任一面。WebUI-only 不要求工具、模型或 Conversation；Agent-only import 不加载浏览器/Web server。browser、backend、Agent exports 有各自 runtime/声明图，启停分别表达。

纯浏览器 UI SDK 归独立前端，协议/client 和 Node Backend 能力归各自服务维护源。扩展只消费明确 public exports，不跨 workspace import `src/`、私有 `dist/`、store/router 或可执行入口；核心 agent/MAS 不反向依赖产品。旧 Preact 插件不迁移，旧 WebUI/SDK 不为兼容保留 facade。

## 3. 界面作者可以做什么

公共扩展面包括：

- 注册导航项和 extension namespace 下的页面。
- 注册 app/Conversation 范围的 sheet、panel 和设置入口。
- 编写完整 React 交互内容，不限于配置表单或 schema form；通过所属资源视图与稳定引用进入可解析、获准访问的原对象。
- 使用宿主 UI primitives、主题 tokens、状态/订阅 hooks。
- 注册 slash/command-palette/button action，共用 command identity。
- 返回私有 toast、共享 display card、打开 interface 或 operation receipt。

宿主负责容器 title、close/focus、返回导航、加载与错误状态；扩展不要嵌套第二个应用壳层或通过 DOM monkey patch 抢占它。全局布局和 store 由宿主拥有；需要新插槽时，定义公开契约并以独立消费者验证。

设置界面只是自定义 interface 的一种用途。简单设置复用标准 input/select/toggle；复杂 MAS topology、receipt inspector、策略预览可以自行组成组件。

## 4. 组件、交互和样式

界面实施采用[前端开发规范](FRONTEND-GUIDELINES.md)及其中保存的 Atlassian 排版、Vercel 界面指南；对应原生行为以 Devin 离线生产前端为准。具体来源、直接定位和证据类型在该规范中维护。

- 前端基座、CSS 身份、页面布局、响应式和 Team 交互统一由[前端声明](../state/frontend.md)维护。扩展采用宿主共享 React/Astryx、公开组件和同套界面语言，可直接使用上游公开部件；保留代码与字体许可证，不另建应用壳层。
- 页面／功能入口消费授权 DTO 和 host-bound context；通用 UI 原语只接收必要的值、内容与意图回调，不代办业务请求。不把整个应用状态注入扩展。
- 状态分别处理 loading、empty、denied、conflict、unknown、stale/disconnected 和 terminal；不要把它们合成同一个红/绿点。
- 显示已持久 membership 与 native live readiness 的区别；generation done 不等于业务目标或工具副作用已完成。
- 表单写入前展示 scope；危险操作需要明确目标和动作反馈，重复点击复用同一 pending operation，不能静默分配新请求。
- 使用公开 tokens/classes，CSS 作用于自身内容，不覆盖全局登录/权限/别的插件。公共 `@pakka/webui/components` 的 `Icon` 提供共享 SVG 图标；可访问名称、尺寸及触达条件由[前端声明](../state/frontend.md#响应式与可访问性)维护。
- 键盘可操作、focus trap/return、Escape、屏幕阅读标签、窄屏可滚动和触摸交互是组件要求，不是最后加的桌面补丁。
- Files、Schedules、Memory、Webhooks、MAS 与其他插件消费同一公共扩展插槽，不增加权限或隐式启用 Agent facet。宿主页面/命令入口与实例语义见前端声明和下面的 command/lifecycle 契约。
- 页面和面板卸载时释放 host subscriptions、listeners、timers 和 abortable reads；关闭界面不表示已接受的服务端工作取消或回滚。

## 5. Command contract

每个 command 的定义至少覆盖以下概念，具体 TypeScript API 在有独立类型消费者时固定：

| 字段/行为        | 要回答的问题                                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| identity/version | 属于哪个 extension/generation/action？名称冲突怎么拒绝？                     |
| scope            | 无 Conversation 的 app 操作，还是指定 Session/Conversation/resource？        |
| actor/permission | 谁能发现、谁能执行？driver/owner 是否需要效果时重验？                        |
| input/output     | 哪个有限 runtime schema？参数错误发生在效果之前还是之后？                    |
| model effect     | 纯显示/设置，还是显式提交任务？不能由 slash 文本猜测                         |
| operation policy | read/write、deadline、cancel、request identity、conflict、unknown 如何表达？ |
| presentation     | private notice、shared card、interface、receipt 各自的可见域                 |

已注册 slash、suggestion 和按钮使用同一 dispatcher；精确命令名以外的斜杠文本是普通输入。已注册命令的参数错误、不可用或执行拒绝保留草稿，不回退为模型输入；无法确认命令目录时，不将疑似命令解释为空目录中的普通文字。保留 built-in/template/skill 名称规则；冲突不以“最后加载覆盖”解决。Status/settings 命令不自动发 prompt、不改变 requester；显式 send-work 才调用受控 input/A2A，并返回真正的 native receipt。

Card 是显示记录，不是偷偷添加 system/user message。必须用下一次真实 provider payload 验证它不进模型，而不是只看前端没有渲染成聊天气泡。

## 6. Backend RPC、数据和任务

- 宿主验证 extension/action/version envelope；扩展注册有限 input/output/event schema、scope 和所需 action permission。任意 `unknown` payload 加一个 action 字符串不构成公开契约。
- 当前 actor 由服务端绑定；浏览器带来的 user/principal/source/grant 只是未经授权的数据。
- 从受控服务取冻结 DTO/绑定 closure。原始 Harness、Tx、DocumentReader、provider session/credential 不离开 adapter。
- 业务 settings/notes 等使用明确 namespace 与版本冲突规则；user、Conversation 和 extension 的 scope 不能仅靠 UI 选项约束。
- 长工作通过受控 job/receipt 服务；HTTP 与 wait 均有有限期限，关闭/取消 wait 不等于取消已接受的 job。
- 同 actor/resource/request 的相同参数只 reconciliation；不同参数拒绝冲突。未知 handler 不自动重进，不能宣称任意外部效果 exactly-once。
- 实际 public SDK 的 `ExtensionClient.operationByRequest({ extension, requestId, target })` 可在丢失 host operation ID 时只读查询原请求；服务端绑定当前 person 和精确 AgentRef，并在发布前重查原权限。`WebInterfaceContext.operationByRequest(requestId)` 另绑定当前 open instance。
- 外层 operation 已记录 `done` 不证明内层 job/browser/native effect 已完成；内层仍为 `unknown` 时必须保留待确认身份，不解锁重复效果。
- 明确 pre-effect guard 的拒绝可报 denied；opaque callback 可能已有效果，其异常/断连/超时保持 unknown。不要解析报错文本推断 rollback。
- Memory 是相同插槽的另一实际消费者：`workspaceMemoryService`/`workspaceMemoryExtensionRoot` 绑定当前人类与精确资源；宿主分别选择 `createPocketMemory().tools` 与 `.source`。人类界面不自动激活 Agent 能力；提议须经授权审批才进入来源；编辑、审批和遗忘按精确 expectedVersion 提交，冲突保留当前草稿。暂停只停止内容贡献，移除人类界面保留已批准记录及宿主显式工具；响应不明按原 operation 核对。每条文本最多 300 个 UTF-16 code units，项目/global 各最多 40/30 条，未批准提议最多 20 条，保留记录／mutation ledger 上限为 256/512。
- 对外 incoming endpoint 可由已安装 Backend 的 `ExtensionService.ingress` 声明：有限 raw body/headers/path、截止时间、封闭输出 schema 与 generation live check；handler 不取得 socket、Cookie/CSRF authority、模块或任意响应 header。服务先验证外部身份，再把 live check 传到受控效果边界，超时保持 unknown。
- Webhooks 已通过这一通用接口实现签名/专用 secret、轮换、原请求恢复和真实 native follow-up；明确 Conversation 的目标与当前创建人权限由服务端绑定，移除 WebUI 保留 Backend。私密 setup 是显式授权的只读操作，不落入通用 operation ledger；详细路径与容量见 [Webhook 说明](../guides/WEBHOOKS.md)。
- 不把 metadata 写和 native Durable effect 称为跨存储原子提交。保留各自 operation/receipt 与不确定状态。

## 7. 多人可见性与私密数据

用户安装插件即确认代码可信。可信 backend/同源前端不是沙箱；规范不承诺限制恶意同进程代码。业务 API 仍必须执行：

1. 发现、快照、历史、文件/导出、审批、RPC/assets、SSE 都在服务端按当前 person/resource 过滤。
2. 查看不意味着 send/steer/manage；MAS 通信权限也不意味着完整 transcript read。
3. 驱动与授权变化在等待后的效果边界重验，撤权关闭后续 stream/读/操作；不声称撤回已经发给浏览器的字节。
4. 私有 toast 只回当前操作者；shared card/notes 明确共享 scope；人类 side chat/presence 默认不进入模型。
5. 已存 provider secret 不回填表单，不进 URL、command history、browser persistent storage、task/entry、广播或 export。配置敏感值区分 keep/replace/clear；provider credentials 不成为通用 plugin client 字段。外部 Webhook 的专用 URL secret 是显式授权 setup 的独立契约，不能套用为 provider key 的返回接口。

以下认证段落说明现有后端/legacy 装配的安全边界，不是新 WebUI Provider `/login` 的实施安排；新的 API key/OAuth 交互待用户敲定多端偏好后再设计，旧 UI 代码无需为兼容保留。现有原生模型模式通过公开 pi-coding-agent ModelRuntime 使用其 `models.json`、`auth.json` 与 `settings.json`。模型目录和配置来源可以读取、刷新；provider 登录/登出由当前全局管理权限约束，并绑定发起浏览器的登录身份。API key/OAuth 交互仅在私密流程中传递，角色撤销、退出和到期取消原生授权；输入提交即清空，响应丢失后核对原交互，不自动重发密钥。状态只展示公开认证信息；原生密钥不进入页面持久存储、通用 operation 或 Session。

显式 legacy 装配保留独立 `credential.status / credential.replace / credential.clear` 命令，不进入扩展 command palette 或通用 settings 回填。只有具备全局安装权限的当前人类可调用；scoped admin 也不能改变全 Session 的凭据。写请求带稳定 request ID 和预期 version，只返回 `{ version, configured }`。表单提交即清空输入，未知响应后只能显式读取当前状态，不自动重发密钥；读到当前配置不等于证明原写操作的完整历史。

legacy owned 私密服务会持久保存显式提交的值，供未来原生主请求解析；保留已有启动 resolver，直到明确替换/清除。清除会阻止后续解析且重开不回退，但不撤回已发请求、不擦除旧持久日志，也不宣称加密。它的稳定写回执有每 Session 256 次的上限，不以自动遗忘回执扩大容量。

通知使用独立的 `notification.status / subscribe / unsubscribe / preferences` 有限命令，设备与偏好绑定当前人类，当前 Conversation 在服务端校验。`PocketServiceContext.notifications` 是受信任 producer；浏览器命令不能决定通知收件人或文案。pending/unknown 的真实 push 不自动重发；worker 在显示和导航前用当前 Cookie 读取 metadata，HTTP 接受不作为 OS 显示的证据。状态仅返回公开 VAPID key、偏好和当前资源设备的 `{ id, subscriptionKey }`；摘要匹配真实 PushSubscription，丢注册响应后的核对不再写注册，也不返回 endpoint/auth/private VAPID。保留上限为每 Session 256 个事件、512 个控制操作、128 个设备与 128 份个人偏好；单人最多 10 个活动设备，每设备最多 64 个资源，store 最大 1 MiB。容量耗尽拒绝新增。VAPID 私钥和订阅材料由受保护存储保留，不进入模型或状态响应；HTTP 接受与操作系统实际显示分别确认。

## 8. 生命周期与资产

- extension identity、generation、resource scope 与 open-instance identity 都要绑定。旧回调不能关闭/通知/写入新的界面实例。
- 提前检查 names/schema/compatibility/assets 后再发布 registration。失败重建只有在旧状态可确认时才保留；partial/unknown installation 要封闭并核对，不假称全局回滚。
- disable/uninstall 移除新调用入口并清理 host-owned 界面资源，不删除 members/history 或把已接受工作记成未发生。
- public assets 来自真实批准目录的固定字节；拒绝 symlink/junction、traversal、hidden/private files 和超限内容。旧 generation 不得提供新字节。
- 任意 ESM 全局副作用不能被卸载撤销。需要整页 refresh 才能使用新 generation 时明确提示，不承诺全图热替换。

## 9. 实际开发与验证路径

Verification 的选用与记录按[通用方法](VERIFICATION.md#选用与记录)。重构初期优先遵循[少测试政策](FRONTEND-GUIDELINES.md#重构初期的测试政策)：下面是按风险选用的检查项目，不是每项 UI 改动必须新增的测试清单。选用扩展端到端检查时，按扩展能力从以下项目确定覆盖范围：

1. 能从 public exports 编译的独立消费者，无内部路径/根 overrides。
2. 一份可原样安装的例子：GUI-only 或真实配置影响后续行为的工具/服务。
3. 实际 WebUI/backend/browser 路径测试，而非只调用 handler 返回 success。
4. 两个获准人与一个越权身份，检查 HTTP/SSE/export/模型的 canary 泄漏。
5. typed/tapped/button 一致性、权限、冲突、reload失败、旧实例、断网后相同身份 reconciliation。
6. desktop 与手机 viewport 的直接浏览器检查。常规视口取 `1440×900` 和 `390×844`；手机默认最短目标按宽∶高 `3∶5`，短屏检查取 `360×600` 或 `390×650`。这些是测试配置，不强制页面比例或裁切实际视口；更矮尺寸不是默认验收范围。
7. local deterministic provider、独立 browser profile 和存储；不读用户 cookie/sign-in，不调用付费模型。
8. 正向 action/job/refusal 记录、原始 receipts/state 和 HTTP/tool 计数，防止“没有额外请求”掩盖根本没有触发功能。

只修改文档时检查文档结构、链接和格式，不重跑无变化的模型矩阵。代码实施后的通过依赖实际消费者与精确产物，不依赖 OpenSpec checkbox 或截图单独自证。

### 被动观察与完整原文

普通产品根／子 Runtime 默认冷观察。页面使用 v2 `preview`、`content.read` 及 `mode=preview` 的观察端口；旧完整 SDK/read 语义不被静默截断。预览按条数与字节封顶，大文字、参数和图片通过原来源/版本引用按需读取，不能每轮先创建完整 native watch 再裁剪。

观察流按 333 ms 合并变化，无变化只小心跳，长流与短控制请求分开计量。多资源请求必须整体通过当前权限校验；浏览器合并状态只接受同 server/person/Session/resource/stream 的确切基线和连续版本，缺页重新读而不是补空数据。可用 SharedWorker 时同身份页面共享连接，回退直连仍保留浏览器连接池限制。

历史用固定的虚拟化内核与原行 key 管理绝对定位、测量、前插锚点及唯一焦点行，原文、正文缓存与 DOM 分别受预算约束；不能将 CSS 折叠或缓存淘汰称为存档删除。标准构建产出 browser vendor 与输入/输出摘要，运行时不安装或改写依赖。接口见 [Runtime API](../reference/RUNTIME-API.md#冷观察预览与完整内容)，操作见[使用指南](../guides/WEBUI-GUIDE.md#历史工具摘要与完整原文)，预期见[观察声明](../state/conversation-observation.md)。

### 独立选择模型和 Conversation 工作目录

模型入口位于消息输入区，点击紧凑模型按钮查询可信宿主的原生 Pi 目录。具有 Conversation 配置权限的人可选择目录内任一模型；完整引用包含 provider/modelId，模型目录与 Agent profile 分开。候选显示真实输入类型、上下文与输出上限、thinking 等级及目录价格，不携带另一个预设的 cwd、工具或指令。原生产品使用有界分页与服务端搜索，兼容配置响应的 65 项前缀不是完整目录，也不限制其余模型。legacy 单 provider 装配仍可从其显式配置生成兼容目录。

当前模型独立显示；未选模型用 `model: ""` 表示，仍可进入设置和管理 Session。新入口另提供 `/model` 悬浮选择、完整 provider/model 准确直接选择和 `/thinking` 与点击/触控共用操作；持久配置经 Pakka 提交 pi-durable。选择器参考 pi-coding-agent 在 pi-tui 上实现的 `/model` 的输入焦点、上下键循环、高亮候选、Enter 确认、Escape 关闭及位置/匹配总数反馈。检索和键盘移动不提交配置，空结果下 Enter 无效果，中文等输入法组合期间不把 Enter 当作选择。提供商/模型参数由设置中的可视化控件及校验后的高级编辑接入原生配置；当前选择归 Conversation，显式默认归 Person 并在后端跨设备保存，实例连接定义由配置权限管理。刷新不覆盖既有选择或发送生成请求。

工作目录入口**只在 Conversation 标题下方**，Settings 不提供目录变更入口。点击当前服务器路径打开目录选择器：

- Locations 是宿主批准的位置；目录浏览、面包屑、上一级和粘贴绝对路径均只在这些位置内导航。
- 最近使用与收藏保存在当前浏览器，按 server/person 隔离，退出时清除；服务端每次重新验证快捷路径，越权、失效及逃出批准范围的符号链接不展示。
- 浏览或关闭不会修改 Conversation；只有 **Use this directory** 明确应用。手机使用单栏滚动内容与固定确认区，默认最短目标为宽∶高 3∶5。
- 普通新建 Conversation 的模型/Thinking 缺省使用 Person 保存的默认；显式创建参数及同一基础 profile 的分叉保留所指定/来源配置。目录沿用创建入口的明确上下文；这些选择不隐式替换指令或工具。

Pi Durable 公开 configure 支持 model/cwd/thinkingLevel 局部修改。Pakka 分别持久化选定字段；成功应用更换 incarnation、撤销旧绑定，保留历史和已花额度，不搬文件、不重放工作。已有工作或队列未清空时拒绝切换，不自动取消工作。未知结果只能读取当前配置核对，不自动重试。Viewer 可查看当前配置，但不能打开配置菜单、浏览服务器目录或修改它们。

目录浏览沿用服务器 roots 约束：默认使用 `runtime.cwd` 及整组 Agent 预设允许的目录作为可浏览根目录。可通过可选的 `runtime.cwdRoots` 一次批准项目根树，新子项目无需新增“模型 × 目录”profile。下面是显式 legacy JSON 宿主配置的局部片段；完整装配仍须提供其模型访问与初始 limits。无参数产品入口则由 Pi 原生模型来源和本地预设装配，无需这份 JSON：

```json
{
	"runtime": {
		"cwd": "/srv/projects/project-a",
		"cwdRoots": ["/srv/projects"],
		"profiles": [
			{
				"id": "alternate-model",
				"model": "alternate-model-id"
			}
		]
	}
}
```

`cwdRoots` 是宿主批准的全局目录位置，当前能够管理 Conversation 的角色可在其中选择；未显式配置时，从该角色可使用的整组 Agent 预设推导位置。它支持 JSON、ESM 与 worker 配置，必须是现有绝对目录。路径为**运行服务器上的路径**，不是手机本地路径，也不构成文件系统沙箱。Files & changes 的 roots 是独立批准的权限，切换 cwd 不会扩大它们。

现存 Session 的已登记 profile 与批准目录边界按原指纹核对；可登记新增预设，不能通过同名替换隐式改变已有执行权限。额度使用独立的版本政策、原请求索引和审计，允许受权调整且保留累计消费。正常重开从原生 Conversation 配置恢复模型、目录及 thinking，不从基础 profile 猜测，也不以原 bootstrap 覆盖管理调整。

基础 profile、顶层 `profiles`/服务端 `profileCeiling` 与整组 configure API 用于完整 Agent 预设的工具/指令权限；单独模型选择不据此筛选或改变预设。未知模型仍按服务配置目录拒绝；`canConfigure` 与实际 `manage` 资源写权限一致，目录读取、凭据及扩展安装继续各自处理真实效果。

### Session 管理、创建与个人导航

New Session / New Conversation 使用独立创建表单。`session.list` 对有创建权限者返回 defaults 与获准 presets，`creation.directories` 提供批准目录；这些只读来源不创建资源、不发送模型输入。Agent 预设选择独立于模型目录，本地产品可选择 coding 或 read-only，后端继续校验整组预设权限。`session.list / session.create / session.lookup` 分别读取当前授权父项、以稳定 requestId 创建、只读核对原请求；清单失败不被转换为空清单。

管理目录位于控制 Session 的 `pocket.sessions` namespace，最多 31 个新增 Session，加已有控制 Session 最多 32 项。它先持久记录保留的 Session ID 和 unknown，再以公开 `createRuntime` 打开独立 storage/writer，原生初始化和 ready 注册均确认后才发布。重开沿原 ID 与目录，保留预算消费；unknown 初始化、writer claim 和历史输入分别保留原边界。已确认子存储打开失败时，保留 unavailable 登记，健康 Session 继续服务；该目录不是跨 Session 的 Runtime、总预算域或进程隔离。

具备全局 Session 创建权限的人可在设置中发起 `session.reopen`，仅尝试打开启动时未能取得 Runtime 的原登记。活跃 writer、运行中已封闭或清理未确认的 Runtime、unknown 初始化、缺失/损坏/异属数据库继续拒绝；不补库、不清锁、不重放。客户端核对返回的原 Session ID，打开与发布前重验权限。响应未知时只读目录核对，不以可用状态证明原请求完成者；打开已确认而目录刷新失败时，先重读目录，不能按旧状态再次打开。

`create` 在明确的 sessionId 内创建 Conversation；可选 `configuration: {model?,cwd?,thinkingLevel?}` 与创建同次原生提交，不替换整组 Agent 预设。没有可用父项时，确认执行 Session → Conversation 两步，保留各自原请求；父项成功后不因第二步失败重建或删除。请求未知时仅 lookup，明确确认才接续第二步。待核对身份保存在当前页面状态，关闭并重开对话框可读取；整页刷新重新加载资源清单，未确认创建草稿仅在原页面存续。

读取、SSE、协作、通知、扩展服务与 Native 操作按完整 Session/Conversation 地址选择所属 Runtime。资源 grant 同样区分两级身份；原单 Session 裸 ID 兼容授权只代表原控制 Session，不向同号的新 Session 扩权。receipt/wait/withdraw 保留原生 receipt ID，sessionId 作为单独寻址字段；客户端同时核对响应父项，不用重编码的 ID 冒充新原生回执。

有限 envelope 为 v2。server、静态前端与 `@pakka/client` / `@pakka/protocol` 必须按相同字段与完整资源键成套解析。仅具裸 Conversation ID 的兼容 grant 归属控制 Session；grant 解析与 wire decoder 版本分别核对。

`navigation.read / navigation.update / navigation.lookup` 在控制 Session 的每人独立 namespace 保存单层个人文件夹与视图。每人最多 32 个文件夹、256 条归类，更新使用版本 CAS 与最近 16 个原请求结果；过期请求也不能绕过版本重做。分组为 Sort Per Session 或 Default，Conversation 至多归入一个文件夹，删除只回到 Uncategorized（未分类）；归类需当前 read 权限，不要求 manage 或新文件夹 ACL。授权读取过滤隐藏资源，但无关编辑保留它们的已有归类。unknown 先核对，不自动重发。

### 预算管理

预算设置按所选 Session 显示政策版本、三项额度、累计消费及历史。受权调整携带 actor/request/expectedVersion，政策与审计同一原生事务提交；降低额度不退款，关闭页面不取消已接受操作。明确冲突后先显式读取现行政策；响应丢失保留原请求，使用只读 receipt 核对，不分配新身份重发。只有提交前明确拒绝可映射 denied，存储或写后状态未知继续封闭。完整宿主接口见 [Runtime API](../reference/RUNTIME-API.md#预算政策与审计)。

## 10. 分阶段 Computer Use 实操验收

本节描述选用独立 Computer Use 验证时的执行方式。阶段目标、逐项通过条件和项目约束由所属任务确定；GUI 实操与源码检查、两方 adversarial review 分别执行和留证。

### 适用条件与职责

所属任务已选用独立实操，且阶段目标、逐项通过条件明确并可通过 Computer Use 验证时，采用本流程。缺少定义时先补齐该项验收定义，并继续推进其他已有依据的工作。

主代理只做必要的简单测试和项目要求的检查，先排除明显的启动、编译等问题，再将真实 GUI 实操交给后台子代理。默认模型为 `Mapleluv-ChatCompletions/deepseek-flash:max`；显式提供验收所需工具，按本机 pi-subagents、agent-workspace-linux 技能及当前工具 schema 调用。模型或环境故障如实报告，不自行换模型或将故障归为通过。

主代理保留计划、产品修复和最终验收决定。子代理可以在自己的隔离环境中做可逆诊断并记录改动，不向集成代码写入产品修复，也不自行再委派。

### 固定快照与隔离环境

主代理为每个验收任务准备独立 worktree 和 agent-workspace-linux 桌面，固定待检查的实际候选代码。快照必须收录本阶段的实际改动及必要的未提交或未跟踪文件；不得默认以旧 HEAD 代替。记录基线、候选文件清单、内容身份与实际测试版本，并核对启动代码、构建资产及安装归档属于该快照。

每个并行任务使用唯一 workspace id，所有 workspace 调用显式传入该 id。应用通过 workspace 工具从验收 worktree 启动；仓库外安装场景使用同一快照生成的确切产物。端口、浏览器 profile、身份、测试数据与存储相互隔离，GUI 操作只使用 workspace 工具。

### 交接与异步推进

交给子代理的验收包至少包含：

1. 阶段目标、逐项通过条件、未覆盖项以及相关约束。
2. 代码快照身份、验收 worktree、workspace id 和环境位置。
3. 准备与启动方式、隔离的端口/profile/数据，以及当前可用的工具。
4. 报告、截图、操作记录和必要日志的输出位置；按阶段和轮次分别保存。
5. 诊断权限、严重问题的通知方式和中断/恢复规则。

子代理运行期间，阶段保持“实操验收中”；主代理继续不依赖该结论的工作。正常完成依靠异步通知，不循环轮询或用阻塞等待替代通知。收到有效报告并核对证据后，主代理再判断阶段是否通过。

### 实操证据与 A/B 诊断

子代理通过真实 GUI 操作逐项验收，保存可核对的截图、操作记录和必要日志。源码、脚本可辅助定位，涉及界面行为的结论必须有对应快照上的实际操作证据。

发现问题时，以真实 A/B 实验支持根因判断：A 在原始快照复现，记录步骤、预期与实际；B 保持其他条件一致，只改变怀疑的关键变量或应用最小诊断补丁，再执行同一路径。记录两侧证据、精确差异及支持的因果关系；必要时恢复 A 再测，排除缓存、重启或偶发现象。没有问题时无需制造 A/B 实验。

诊断状态下通过不代表原始快照通过。报告明确区分已复现现象、证据支持的原因和待验证假设；根因未证实时提交已有证据与缺口。严重或阻塞问题及时通知主代理，普通问题随报告汇总。

每轮报告包含实际测试版本、每项 `PASS / FAIL / BLOCKED`、问题影响、复现方式、A/B 证据、根因判断及未覆盖项。截图与日志必须能关联到对应阶段、轮次和代码身份。

### 中断、修复与完整重测

主代理发现使当前验收失去意义的严重问题时：

1. 使用 `interrupt`，确认子代理已暂停且不再操作环境，保存旧版本和已有证据。临时暂停不用 `stop`，保留恢复能力。
2. 主代理修复代码并做必要检查，准备新快照，重启应用并恢复干净的测试初始状态。
3. `resume` 同一子代理，交代代码变化、新快照和环境位置，要求本阶段从头完整验收。保留旧证据并标明适用版本，不混入新结果；记录恢复后的最新 run id。

没有严重问题或问题不重时，让子代理完成当前快照，再由主代理核对证据、结合当前代码处置。迫切或阻塞问题立即修复并复验；非迫切、非阻塞问题可以延后或仅记录，保留影响、复现、证据和重访条件。证据不足或过时的判断说明依据，必要时补充有判别力的实验。

### 集成验收与清理

选用集成版本的 GUI 验证时，在新快照上执行受影响路径；旧快照的结论仍归属于其原版本。主代理保存各阶段、各轮报告及证据，并在最终交付中说明验收版本、结果、证据，以及已修复、延后和受阻事项。

确认资源不再被使用后，清理本次创建的桌面、服务和 worktree，保护用户原有改动与已留存证据。
