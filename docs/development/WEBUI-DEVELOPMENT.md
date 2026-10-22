# Pakka-Pocket WebUI 与扩展开发规范

本文件维护 `@pakka/webui` 的服务、扩展、组件、配置与验证方法细则。整体预期见 [WebUI state](../state/webui.md)，页面结构与交互由[前端声明](../state/frontend.md)维护；当前工作及未完成门禁见[工作入口](../OVERVIEW.md)和所指 OpenSpec tasks。公共 API 通过明确 exports 和独立消费者核对，实际实现较窄不自动缩减目标。

## 1. 产品核心与扩展的分工

| 产品宿主拥有                                  | 扩展贡献                                   |
| --------------------------------------------- | ------------------------------------------ |
| 登录/邀请、当前人类身份、权限检查             | 已声明 scope 下的业务查询与操作            |
| 路由 namespace、导航、Sheet/panel 容器、focus | 导航项、子页面、自定义 Preact content      |
| 组件/主题 tokens、loading/error boundary      | settings、图表、表单、成员板等交互内容     |
| command registry、触发器、operation identity  | namespaced command、参数/结果 schema       |
| checked RPC/events、连接/取消/重连            | extension action、client binding、订阅处理 |
| generation、安装/启用/更新/卸载与 assets      | 可选 Agent/Backend/WebUI/Client facet      |

MAS Board 必须通过右侧的通用贡献方式实现。不为 MAS 增加特权的 core store、专用 router 分支或“内置可绕过”标志。另一份 GUI-only 扩展必须能使用同一机制。

## 2. 四个 facet 与构建边界

- **Agent**：真实 native invocation 下的 tools/instructions/策略服务；保持现有受控端口，不向插件返回 raw Pi 对象。
- **Backend**：认证后业务查询/命令、scoped persistence、受控 job。注册 schema 和权限，不直接把任意 callback 暴露为网络 handler。
- **WebUI**：普通 Preact content、command/action 和界面贡献。采用宿主同一份 Preact/htm/组件，不自带另一份运行时。
- **Client**：对已存在 backend action/event 的类型化编码、解码和调用，不自行授予权限或定义服务端没有的命令。

一个扩展可以只实现任一面。WebUI-only 不要求工具、模型或 Conversation；Agent-only import 不加载 Preact/Web server。一个 extension package 的 browser、backend、Agent exports 应有明确的 module graph 边界。

`@pakka/webui` 作为单一产品包，可以暴露纯声明、组件等 public SDK 子路径；扩展只 peer-consume 这些明确 exports。不得跨 workspace import `src/`、私有 `dist/`、页面 store/router 或可执行入口。核心 agent/MAS 库不反向依赖产品。

## 3. 界面作者可以做什么

公共扩展面包括：

- 注册导航项和 extension namespace 下的页面。
- 注册 app/Conversation 范围的 sheet、panel 和设置入口。
- 编写完整 Preact 交互内容，不限于配置表单或 schema form。
- 使用宿主 UI primitives、主题 tokens、状态/订阅 hooks。
- 注册 slash/command-palette/button action，共用 command identity。
- 返回私有 toast、共享 display card、打开 interface 或 operation receipt。

宿主负责容器 title、close/focus、返回导航、加载与错误状态；扩展不要嵌套第二个应用壳层或通过 DOM monkey patch 抢占它。完整全局布局/store override 不是首版稳定第三方接口；需要新插槽时用真实消费者证明，而不是复制内部代码。

设置界面只是自定义 interface 的一种用途。简单设置复用标准 input/select/toggle；复杂 MAS topology、receipt inspector、策略预览可以自行组成组件。

## 4. 组件、交互和样式

- 前端基座、CSS 身份、页面布局、响应式和 Team 交互统一由[前端声明](../state/frontend.md)维护。扩展采用宿主 Preact/htm、公开组件和同套界面语言，保留代码与字体许可证，不另建应用壳层。
- 组件默认消费 DTO 和 host-owned context，不把整个应用状态注入扩展。
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

输入 slash、点击 suggestion 或按钮走同一 dispatcher。保留 built-in/template/skill 名称规则；冲突不以“最后加载覆盖”解决。Status/settings 命令不自动发 prompt、不改变 requester；显式 send-work 才调用受控 input/A2A，并返回真正的 native receipt。

Card 是显示记录，不是偷偷添加 system/user message。必须用下一次真实 provider payload 验证它不进模型，而不是只看前端没有渲染成聊天气泡。

## 6. Backend RPC、数据和任务

- 宿主验证 extension/action/version envelope；扩展注册有限 input/output/event schema、scope 和所需 action permission。任意 `unknown` payload 加一个 action 字符串不构成公开契约。
- 当前 actor 由服务端绑定；浏览器带来的 user/principal/source/grant 只是未经授权的数据。
- 从受控服务取冻结 DTO/绑定 closure。原始 Harness、Tx、DocumentReader、provider session/credential 不离开 adapter。
- 业务 settings/notes 等使用明确 namespace 与版本冲突规则；user、Conversation 和 extension 的 scope 不能仅靠 UI 选项约束。
- 长工作通过受控 job/receipt 服务；HTTP 与 wait 均有有限期限，关闭/取消 wait 不等于取消已接受的 job。
- 同 actor/resource/request 的相同参数只 reconciliation；不同参数拒绝冲突。未知 handler 不自动重进，不能宣称任意外部效果 exactly-once。
- 实际 public SDK 的 `ExtensionClient.operationByRequest({ extension, requestId, target })` 可在丢失 host operation ID 时只读查询原请求；服务端绑定当前 person 和精确 AgentRef，并在发布前重查原权限。`UIContext.operationByRequest(requestId)` 另绑定当前 open instance。
- 外层 operation 已记录 `done` 不证明内层 job/browser/native effect 已完成；内层仍为 `unknown` 时必须保留待确认身份，不解锁重复效果。
- 明确 pre-effect guard 的拒绝可报 denied；opaque callback 可能已有效果，其异常/断连/超时保持 unknown。不要解析报错文本推断 rollback。
- Memory 是相同插槽的另一实际消费者：`workspaceMemoryService`/`workspaceMemoryExtensionRoot` 绑定当前人类与精确资源；宿主分别选择 `createPocketMemory().tools` 与 `.source`。人类界面不自动激活 Agent 能力；记忆审批、版本冲突、暂停与原操作核对见 [P5 阶段记录](../archive/webui/PAKKA-POCKET-P5.md)。
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

Pakka-Pocket 的主 provider key 使用独立 `credential.status / credential.replace / credential.clear` 命令，不进入扩展 command palette 或通用 settings 回填。只有具备全局安装权限的当前人类可调用；scoped admin 也不能改变全 Session 的凭据。写请求带稳定 request ID 和预期 version，只返回 `{ version, configured }`。表单提交即清空输入，未知响应后只能显式读取当前状态，不自动重发密钥；读到当前配置不等于证明原写操作的完整历史。

owned 私密服务会持久保存显式提交的值，供未来原生主请求解析；保留已有启动 resolver，直到明确替换/清除。清除会阻止后续解析且重开不回退，但不撤回已发请求、不擦除旧持久日志，也不宣称加密。它的稳定写回执有每 Session 256 次的上限，不以自动遗忘回执扩大容量。

通知使用独立的 `notification.status / subscribe / unsubscribe / preferences` 有限命令，设备与偏好绑定当前人类，当前 Conversation 在服务端校验。`PocketServiceContext.notifications` 是受信任 producer；浏览器命令不能决定通知收件人或文案。pending/unknown 的真实 push 不自动重发；worker 在显示和导航前用当前 Cookie 读取 metadata，HTTP 接受不作为 OS 显示的证据。状态仅返回公开 VAPID key、偏好和当前资源设备的 `{ id, subscriptionKey }`；摘要匹配真实 PushSubscription，丢注册响应后的核对不再写注册，也不返回 endpoint/auth/private VAPID。实际边界、保留上限与测量记录见 [P5 通知](../archive/webui/PAKKA-POCKET-P5.md)。

## 8. 生命周期与资产

- extension identity、generation、resource scope 与 open-instance identity 都要绑定。旧回调不能关闭/通知/写入新的界面实例。
- 提前检查 names/schema/compatibility/assets 后再发布 registration。失败重建只有在旧状态可确认时才保留；partial/unknown installation 要封闭并核对，不假称全局回滚。
- disable/uninstall 移除新调用入口并清理 host-owned 界面资源，不删除 members/history 或把已接受工作记成未发生。
- public assets 来自真实批准目录的固定字节；拒绝 symlink/junction、traversal、hidden/private files 和超限内容。旧 generation 不得提供新字节。
- 任意 ESM 全局副作用不能被卸载撤销。需要整页 refresh 才能使用新 generation 时明确提示，不承诺全图热替换。

## 9. 实际开发与验证路径

每个扩展至少提供：

1. 能从 public exports 编译的独立消费者，无内部路径/根 overrides。
2. 一份可原样安装的例子：GUI-only 或真实配置影响后续行为的工具/服务。
3. 实际 WebUI/backend/browser 路径测试，而非只调用 handler 返回 success。
4. 两个获准人与一个越权身份，检查 HTTP/SSE/export/模型的 canary 泄漏。
5. typed/tapped/button 一致性、权限、冲突、reload失败、旧实例、断网后相同身份 reconciliation。
6. desktop 与手机 viewport 的直接浏览器检查。常规视口取 `1440×900` 和 `390×844`；手机默认最短目标按宽∶高 `3∶5`，短屏检查取 `360×600` 或 `390×650`。这些是测试配置，不强制页面比例或裁切实际视口；更矮尺寸不是默认验收范围。
7. local deterministic provider、独立 browser profile 和存储；不读用户 cookie/sign-in，不调用付费模型。
8. 正向 action/job/refusal 记录、原始 receipts/state 和 HTTP/tool 计数，防止“没有额外请求”掩盖根本没有触发功能。

只修改文档时检查文档结构、链接和格式，不重跑无变化的模型矩阵。代码实施后的通过依赖实际消费者与精确产物，不依赖 OpenSpec checkbox 或截图单独自证。

### 独立选择模型和 Conversation 工作目录

模型入口位于消息输入区，点击紧凑的模型按钮选择**宿主批准且当前角色可配置的模型**。当前模型置顶；多于 8 个模型时提供搜索，支持按模型名或批准配置标识过滤，以及键盘选择。当前 headless 集成仍是同一 OpenAI-completions provider 下的批准模型，不虚构多供应商登录、Thinking 档位或自动模型发现。

工作目录入口**只在 Conversation 标题下方**，Settings 不提供目录变更入口。点击当前服务器路径打开目录选择器：

- Locations 是宿主批准的位置；目录浏览、面包屑、上一级和粘贴绝对路径均只在这些位置内导航。
- 最近使用与收藏保存在当前浏览器，按 server/person 隔离，退出时清除；服务端每次重新验证快捷路径，越权、失效及逃出批准范围的符号链接不展示。
- 浏览或关闭不会修改 Conversation；只有 **Use this directory** 明确应用。手机使用单栏滚动内容与固定确认区，默认最短目标为宽∶高 3∶5。
- 新会话默认继承当前模型和目录；同一基础 profile 的分叉也继承独立选择。两者都不隐式替换指令或工具。

Pi Durable 公开 configure 支持 model/cwd 局部修改。Pakka 使用这个接口将二者分别持久化：换模型只更新模型，换目录只更新 cwd。成功应用会更换 incarnation、撤销旧绑定，保留历史和已花额度；不搬文件、不重放工作。已有工作或队列未清空时拒绝切换，不自动取消工作。未知结果只能读取当前配置核对，不自动重试。Viewer 可查看当前模型和路径，但不能打开配置菜单、浏览服务器目录或修改它们。

默认使用 `runtime.cwd` 及批准 profile 的目录作为可浏览根目录。可通过可选的 `runtime.cwdRoots` 一次批准项目根树，新子项目无需新增“模型 × 目录”profile。下面是需合并进完整启动配置的片段，不能代替 endpoint、凭据、limits 等其他必需字段：

```json
{
	"runtime": {
		"cwd": "/srv/projects/project-a",
		"cwdRoots": ["/srv/projects"],
		"profiles": [
			{
				"id": "alternate-model",
				"model": "approved-model-id",
				"systemPrompt": "Approved alternate preset."
			}
		]
	},
	"profiles": ["default", "alternate-model"]
}
```

`cwdRoots` 是宿主批准的全局目录位置，当前能够管理 Conversation 的角色可在其中选择；未显式配置时，仅从该角色的批准 profile 推导位置。它支持 JSON、ESM 与 worker 配置，必须是现有绝对目录。路径为**运行服务器上的路径**，不是手机本地路径，也不构成文件系统沙箱。Files & changes 的 roots 是独立批准的权限，切换 cwd 不会扩大它们。

现存 Session 的 profile/limits/显式 cwdRoots 身份仍锁定，重开必须保持原声明；不能改配置文件后静默扩大旧工作权限。旧 Session 未配置 cwdRoots 时仍可正常重开，并使用原批准目录内的子目录，不要求迁移为组合 profile。正常重开从原生 Conversation 配置恢复实际模型、目录及额度，而非从基础 profile 猜测。

基础 profile 与旧的整组 configure API 保留为兼容的宿主控制面预设；新 WebUI 不用它们实现单独的模型/目录选择。

## 10. 分阶段 Computer Use 实操验收

本节是用户对当前计划及后续符合条件阶段持续授权的验收方式。沿用既有 P5/P6 目标、通过条件和项目约束；GUI 实操验收与项目门禁、P6 指定的两方 adversarial review 分别执行和留证。

### 适用条件与职责

已有多阶段计划，且当前阶段目标、逐项通过条件明确并可通过 Computer Use 验证时，采用本流程。缺少定义时先补齐该项验收定义，并继续推进其他已有依据的工作。

主代理只做必要的简单测试和项目要求的检查，先排除明显的启动、编译等问题，再将真实 GUI 实操交给后台子代理。默认模型为 `Mapleluv-ChatCompletions/deepseek-flash:max`；显式提供验收所需工具，按本机 pi-subagents、agent-workspace-linux 技能及当前工具 schema 调用。模型或环境故障如实报告，不自行换模型或将故障归为通过。

主代理保留计划、产品修复和最终验收决定。子代理可以在自己的隔离环境中做可逆诊断并记录改动，不向集成代码写入产品修复，也不自行再委派。

### 固定快照与隔离环境

主代理为每个验收任务准备独立 worktree 和 agent-workspace-linux 桌面，固定本轮实际候选代码。快照必须收录本阶段的实际改动及必要的未提交或未跟踪文件；不得默认以旧 HEAD 代替。记录基线、候选文件清单、内容身份与实际测试版本，并核对启动代码、构建资产及安装归档属于该快照。

每个并行任务使用唯一 workspace id，所有 workspace 调用显式传入该 id。应用通过 workspace 工具从验收 worktree 启动；P6 仓库外安装场景使用同一快照生成的确切产物。端口、浏览器 profile、身份、测试数据与存储相互隔离，GUI 操作只使用 workspace 工具。

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

相关代码变化后，旧快照通过不自动代表集成版本通过；交付前补做受影响路径的真实 GUI 验收。主代理保存各阶段、各轮报告及证据，并在最终交付中说明验收版本、结果、证据，以及已修复、延后和受阻事项。

确认资源不再被使用后，清理本次创建的桌面、服务和 worktree，保护用户原有改动与已留存证据。
