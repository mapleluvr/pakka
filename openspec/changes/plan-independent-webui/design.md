## Context

本设计接续 [proposal](proposal.md)，把已经采用的边界与候选实现办法分开。规划修订之后已完成[阶段 0 消费盘点](inventory.md)，用户已授权创建独立前端仓库并进入阶段 1；当轮接缝与验证边界见 [phase-1](phase-1.md)。未运行的产品与 UI 验收保持未完成。

固定依据：

- 实现基线：成功 fetch 后的 `origin/dev@cc1cdd8aead42cd0afe018c75973f09fd369184d`；文档工作树基于 `c241c5e8e053cdfb7c15f9233e706f66d320b531`，所读 WebUI 产品文件与 dev 相同。
- 需求来源：[通用插件能力 G1–G6](https://github.com/mapleluvr/pakka/blob/170aa153e7dad0cda8f6172665d709407dfa703a/docs/requirements/WEBUI-PLUGIN-CAPABILITIES.md)。参考分支的用途及限定见[交接记录](https://github.com/mapleluvr/pakka/blob/170aa153e7dad0cda8f6172665d709407dfa703a/docs/changes/history-reference-branches.md)。它不是合并、发布或复制旧界面的要求。
- `history-book` 相对该 dev 没有修改所读 `apps/webui` 接口/宿主；新增历史/Book/Memo/RSI 能力不能因此被算作新 UI 已验收。
- Pi 模型能力依据为项目固定的 pi-ai / pi-coding-agent 1.4.0 公开 API、声明与本地确定性探针；TUI 源码核对、模型请求探针和新 WebUI/Durable 实现是不同证据。

## Goals / Non-Goals

**Goals:** 独立前端可通过公开制品开发和交付；任意业务插件能完成自己的可视化、控制和管线；配置作用域、跨 Session 资源浏览与持久效果边界清晰；未知接口随真实消费者形成。

**Non-Goals:** 当前阶段 1 不切换默认发行、实现完整页面、发布 npm 包或合并分支；不迁移旧 Preact 插件，不为旧 WebUI/SDK 建兼容工程；不重写后端执行/权限/持久化；不把 RSI/MAS/Memo 业务或统一业务账本放进核心；不实施 Provider `/login`、插件市场、任意后端平台、多 Session 全局搜索或提前整改 Board。

## Decisions

### 1. 独立交付，职责分开

用户采用独立 `pakka-webui`，而不是把前后端继续装在同一产品包后只调整目录。前端拥有 React 19 + TypeScript/TSX + Astryx、纯 UI 宿主、浏览器 SDK 和业务页面；Pakka 接入层消费公开服务。Node 启动、HTTP、身份/权限、执行、持久化和 Backend 服务留在 Pakka。

服务命名空间采用 `/pakka-webui`；子路径、包名和 wire schema 在阶段 1 按真实消费定下。不为了路径整齐同时改名所有 Pocket 包/类型。前端普通构建不安装或编译 agent/server/Coding Agent；默认 `pakka` 仍提供一份选定的固定版本/hash 前端产物。

原规划以同仓独立切片作为建仓前过渡；用户随后已授权创建 public pakka-webui，因此新 SDK 和前端构建基础直接在新仓形成。独立消费及真实切片门禁不变，不把整个 `apps/webui` 连同 Node 依赖原样搬走。初版通过同源代理开发，保持 Host/Origin/Cookie/CSRF 约束。分仓、部署和数据库 writer 的边界分别处理。

### 2. 配置归属与模型访问已定，不再列为待决项

| 对象                     | 已采用作用域                                                 | 提交路径                                                          |
| ------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| 当前模型 / Thinking      | 当前 Conversation，按其配置权限                              | WebUI 共用操作 → Pakka → pi-durable 配置及回执                    |
| 人类默认选择             | Person，后端保存、跨设备，用于其新建 Conversation 的缺省选择 | 显式保存个人偏好；不改已有 Conversation 或覆盖 MAS/工作流显式选择 |
| 提供商 / 端点 / 模型定义 | Pakka 实例，由有配置权限者管理                               | 受权校验、冲突/回执、原生配置写入与重载                           |

`/model` 打开悬浮搜索选择器，完整 provider/model 命令准确直接选择；`/thinking` 与点击/触控共用操作。提供商及模型参数有常用可视化控件，高级编辑保留适用的原生覆盖语义。命令不是模型输入，普通选择不自动保存默认。

pi-coding-agent 提供交互参考及公开 ModelRuntime/SettingsManager；pi-tui 是基础界面库；pi-ai 拥有共享模型与 Provider 契约；pi-durable 拥有持久 Conversation 配置/执行。Pakka 不创建 Coding Agent AgentSession 承担执行。ModelRuntime 没有公开 models.json 写入方法，薄的受权写入接缝仍需形成，不能深导私有 validator 或另建 registry。

Provider `/login` 交互待用户确定多端偏好后另行设计；当前切片消费可信宿主已有认证及脱敏状态，不借参数编辑提前加入 API key/OAuth 流程。Pakka 人类身份登录与安全边界照常覆盖。

### 3. 现有公开能力映射：声明/源码，不是能力验收

下表保留规划形成时的初步映射；阶段 0 的全部归属、实际差异和后续对象以 [inventory](inventory.md) 为准，两者都不是独立安装结论。路径均相对仓库根；完整职责定位见 [WebUI 架构](../../../docs/development/WEBUI-ARCHITECTURE.md)。

| 需求                  | 已有公开消费路径和源码事实                                                                                                                                                                                                                                                              | 对新前端的处置及待核对项                                                                                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 独立契约/facets    | `apps/webui/package.json` 有 extension/ui/components/client/backend 出口；`src/extension.ts` 区分 agent/backend/client/webui；`packages/rsi/package.json` 分开导出 Agent/Backend/Client/WebUI                                                                                           | 声明已有，不从零发明 facets。当前 WebUI 包含 Node 依赖，components 是 Preact；纯浏览器安装和 headless 的 runtime/声明图仍须独立验证                                                         |
| G2 资源引用/导航      | `packages/protocol/src/index.ts` 的 AgentRef 含 sessionId/conversationId/key/incarnation/profile；`ui.ts` 有 navigate/open；`web/app.js` 导航重取 list，按 Session/Conversation 找目标；`@pakka/server/pocket` 导出可信 PocketConversationSource，`BackendContext` 的服务接缝可登记资源 | 已有多 Session 与受权来源基础。UI 公共面目前是 AgentRef/所属界面，不含任意资源类型的视图注册协议；补通用引用/解析接缝，并核对原身份、未加载、无权和不可得，不把旧导航回调算作全部 G2 已通过 |
| G3 有限数据/服务/观察 | action 声明 scope/permission/effect/input/output；checked client 校验结果；`HostInterface.subscribe` 是有限 read-action 轮询；主协议已有内容引用和分页方向                                                                                                                              | 复用有限读与 typed client。轮询不冒称通用事件总线，也不因采用轮询便判为缺口；分页、搜索、固定版本、大正文按引用读取及重连身份逐消费路径核对，业务索引属于服务                               |
| G4 命令/长操作        | manifest commands 绑定 action/interface；context/client 有 call、operation、operationByRequest；BackendContext 有服务与 job 接缝                                                                                                                                                        | 沿用 namespaced 调用和原请求语义。按钮/快捷入口共用命令；外层调用、内层 job/receipt 与业务完成分别呈现，不新增统一业务账本或为每个 Promise 叠一层 ACL                                       |
| G5 完整 UI            | ExtensionInterface 已有 page/sheet/panel/settings/navigation；宿主加载组件 export，而非只渲染 schema 表单；容器和错误边界已有实现参考                                                                                                                                                   | 新 SDK 保留自定义内容，统一 React/Astryx、主题/portal/focus；上游公开 Astryx 入口可直接消费。旧 Preact 内容只作能力参考，不迁移或兼容                                                       |
| G6 生命周期           | registration/generation、actor/resource/instance、AbortSignal 与关闭清理已有接线；client.control 为 extension 整体 enable/disable/reload                                                                                                                                                | 保留实例隔离。现有 browser control 没有 facet 参数，不能等同于分 facet 启停；可信装配与实际依赖还要盘点，再形成必要控制接缝。独立更新、资产、旧回调和新实例需真实核对                       |

**已见差异**：浏览器消费与 Node 安装图仍混合；当前 renderer 与采用路线不同；UI 公共声明缺少通用资源视图/解析入口；浏览器管理接口未表达分 facet 控制。阶段 0 又确认原 Session 读取缺少来源接缝、资产 query 未保留完整 Session 身份、public reconnect 仍按单 Session 校验，以及默认产品尚未注入独立资产产物；各自证据和所属任务见 inventory。它们是必要演进输入，不是要求重造资源平台或插件管理服务。

**未证明的事项**：新 SDK 的干净安装、headless 类型/运行图、全部 G2 原 Session 状态、长正文合法范围、所有生命周期组合，以及不同业务插件是否真能同权消费。未运行不能写成失败，更不能写成通过。不得从某个领域测试失败直接推出 ticket/report 专用核心 API。

### 4. 最小通用接口按职责形成，不冻结大 HostAPI

下面是候选接口分工，不是已发布类型名或方法签名：

1. **贡献声明与加载入口**：插件身份、版本、实际 facets、命名空间、页面/导航/设置/容器贡献；接受显式来源，UI host 不拼 Pakka 资源 URL。
2. **UI 实例能力**：打开/关闭、私有 notice、focus/返回、实例级清理及错误处理；纯 UI 插件不依赖 Pakka 服务或模型 Session。
3. **资源引用与解析**：引用说明所属类型/来源与稳定身份；所属插件/服务负责业务解析，宿主负责导航结果与容器。Session/Conversation 的适配由 Pakka 接入层提供。
4. **显式服务绑定**：typed client 接已绑定 actor/resource 的服务；调用、观察、原请求核对使用该服务已有语义。界面能力与服务能力定义/实现分开，调用处可以方便组合。
5. **模块与安装契约**：共享 renderer/UI 的公开入口、SDK/服务兼容声明、固定资产身份及生命周期；不让 peerDependency 或 external 替代真实模块解析。

不新增统一业务数据仓库、工作流引擎或全局可写 store。默认 composition root 显式装配插件，与领域插件拥有核心特权是两回事。

### 5. 多 Session 是资源浏览能力，不是另造 Session 执行器

已采用的是：插件可沿稳定引用进入另一已知、宿主可解析且获准访问的 Session 的原 Conversation；查看真实过程，浏览本身不启动模型、重派任务、解锁或恢复执行。

- 持久资源身份、可选内容版本与当前运行绑定分别处理。现有 AgentRef 含运行绑定信息，不能直接假定它的全部字段就是长期资源 URL schema；重开后的当前 binding 必须由所属服务重新解析和授权，不能靠同名对象替代原身份。
- UI host 持有引用/解析结果和界面生命周期；Pakka 接入层对接受控资源来源。已加载/未加载、不可得、无权、身份不符分别有可操作的状态，不把未加载当成不存在，也不把未知当成可自动执行。
- 原历史从已有 owner 的公开服务读。浏览器不选择任意 SQLite 路径；引用不取得 writer；跨进程/机器能力服从实际服务和部署，不要求共享数据库文件。
- 首片至少覆盖两个真实 Session 的导航和原历史读取；同号 Conversation 不能串线，权限变化及旧结果不得污染另一目标。未加载来源的读取/解析若尚缺公开接缝，作为明确 blocker 处理，不用替代 Session 通过验收。
- 多 Session 统一总览、自动发现所有 Session、全局搜索及多窗布局仍未采用，不作为这个能力的隐含前置。

### 6. 兼容、清理和固定制品

分别维护三种边界：服务 API/wire、UI SDK/renderer、资产身份。初期声明少量确切支持组合；安装/加载/功能启用前识别不兼容，保留 closed validation。现有 version 2 decoder 会拒绝未声明字段，不能把“加字段”自动算作兼容，也不必为本次明确退出的旧 UI 新造适配协议。

共享 React/ReactDOM/JSX runtime、Astryx 和所需 StyleX runtime；插件开发依赖/类型、打包 external、浏览器共享模块映射一起验证。消费预编译 Astryx 不要求应用采用 StyleX 编译器；swizzle 才另有源码/编译/升级责任。

用户明确旧 WebUI/SDK 可按无用户处理：移除旧 Preact 插件迁移、兼容 facade、必须维持旧默认入口的阶段义务。清理按依赖与新功能准备情况进行，不强制拖到最后；独立试验入口只是开发安排。需保留的业务能力以新 SDK 实现，由其所属插件维护，不等于移植旧 browser facet。原 Session、权限、持久记录和已接纳工作不随 UI 清理删除。

## Risks / Trade-offs

- 新包看似 browser-safe，安装仍带入后端 → 分别检查 exports、运行图、声明图和仓库外干净安装；不使用 sibling 源码或根 overrides。
- 通用资源引用被误用为权限或 Runtime handle → 所属服务解析稳定身份并绑定当前授权，UI 只消费 DTO；正常重开与身份不符分别核对。
- SDK 过早做全 → G1–G6 是外部能力要求，不是六个新 framework/package；先用纯 UI 与真实业务消费者暴露最小接缝。
- 大正文被预览/transport 截断 → 核对公开内容契约，以有限分页/按引用读取完成，不在前端静默缩小合法上限。
- 配置 UI 复制上游 registry、泄露秘密或扩大出站访问 → 复用公开 Pi 能力，分开配置权限/模型使用，保全覆盖语义，秘密和可执行来源由可信后端管理。
- 整理旧代码误删功能/存储 → 阶段 0 区分旧实现、仍需功能、历史 backlog 和域插件计划；清理不越过后端效果边界。

## Migration Plan

阶段按退出条件推进，不以页面数量、checkbox 或文档校验代替真实能力。

| 阶段                 | 工作与产物                                                                                                                                 | 退出条件                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 完整盘点           | 全部浏览器网络/资产入口、各 export 消费者、当前功能、G1–G6 映射；把旧实现清理与保留功能分开，固定源/制品                                   | 已用接口、功能、依赖及责任有归属，真实缺口和未知分别列出；已完成的盘点见 [inventory](inventory.md)，不等于新产品验收                                          |
| 1 独立消费接缝       | 纯协议/client 与 UI SDK 出口；最小贡献/资源解析/服务/生命周期契约；模型配置写入与 Person 默认；新 namespace、兼容组合和资产规则            | 隔离消费者只安装声明的固定制品即可消费类型/运行入口；GUI-only 与 headless 图分开；不依赖后端源码、根 overrides 或私有路径                                     |
| 2 最小真实切片       | 同仓独立前端构建；一个无业务依赖的 GUI-only 插件、一个新 SDK 真实业务插件（优先 RSI 读取/编辑公开服务）；模型双入口；跨 Session 原历史浏览 | 共享 runtime/主题/portal 成立；GUI-only 打开/关闭模型请求为 0；真实授权、有限数据、受控写入与丢响应核对、原 Session 状态、关闭/旧回调均有证据；不以 mock 代替 |
| 3 实际搬仓           | 建仓/可见性/制品渠道按授权落实；移入已独立前端、SDK、构建和文档；Pakka 消费固定产物                                                        | 干净 checkout 无后端源码可构建；至少两个前端候选连接同一份未修改后端；版本不兼容有明确处理；不把旧入口保留作为退出条件                                        |
| 4 补齐功能与插件     | 身份/工作台/导航 → Conversation/输入/工具/历史与观察 → 模型参数/个人默认/预算/人员等设置 → 各所有者的新 SDK 插件及所选其余功能             | 每片有真实服务/权限/恢复证据；两种业务插件按同一公开机制工作，无 RSI/MAS/Memo 特权分支；遗漏、延期和取消分别有依据                                            |
| 5 默认交付与清理收口 | 固定组合下安装、pakka 启动/重开、PC/移动端、支持的代理/TLS、安全/缓存/worker/SDK更新；切换发行并清理残余重复代码                           | 独立前端成为维护源；默认产品可用；回退选择兼容前端制品，不恢复数据库、不取消工作或抹掉 unknown；发布/合并另按授权                                             |

阶段 2 的跨 Session 场景不要求提前实现全局 Session 总览；参考历史分支的领域功能也不自动成为首片前置。阶段 4 的业务插件以新 SDK 接入原公开服务，不承担旧 Preact 插件移植任务。

验证沿用重构初期少测试政策：先复用已有公开边界回归，按改动使用类型/构建、独立安装和真实浏览器检查；只为未覆盖的明确外部兼容、安全或持久效果风险补必要测试。文档本轮检查内容、链接、格式、主动 LSP 与 OpenSpec；不跑模型、安装或 GUI 验收来冒充尚不存在的新产品。主会话自行核对，不安排 subagent review/委派调查。

## Open Questions

以下是阶段 0–1 的有限设计工作，不重新打开已采用的分仓、renderer、作用域和旧实现处置决定：

- 新 browser SDK、纯 extension wire/client 与保留 Node 能力的确切 package/export 名称；依据真实消费者和安装闭包决定。
- 固定制品的开发分发渠道、建仓可见性，以及初始 SDK/服务组合标识；远端创建与发布前落实相应授权。
- 通用资源引用的最小编码、受控来源解析与未加载原 Session 的读取接缝；先复用已有服务，按真实能力决定是否需要上游演进。
- Pi 配置公共校验、models.json 原子/冲突写入、Person 默认与新 Conversation 创建接线的具体 API；不复制私有实现。
- Provider `/login` 的多端偏好留 roadmap；多 Session 总览等未采用界面另行讨论，不阻塞已明确的引用浏览。
