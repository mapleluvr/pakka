# 独立 WebUI 公共消费接缝

本页面向前端接入层、插件的 browser/Backend facets 和 Node 产品装配。实现与类型以 public exports 为准；阶段边界见[阶段 1](../../openspec/changes/plan-independent-webui/phase-1.md)。新 UI SDK 位于独立 [pakka-webui](https://github.com/mapleluvr/pakka-webui)，不在本仓复制 React 组件或 UI context。

## 1. 出口与归属

| 入口                                          | 用途                                      | 安装依赖                     |
| --------------------------------------------- | ----------------------------------------- | ---------------------------- |
| `@pakka/protocol/pocket`                      | 工作台 v2 DTO 和 decoder                  | 无运行时依赖                 |
| `@pakka/protocol/webui`                       | 新服务命令、结果、原请求及运行时 decoder  | 无运行时依赖                 |
| `@pakka/protocol/webui-assets`                | 静态前端 manifest 类型和校验              | 无运行时依赖                 |
| `@pakka/protocol/extensions`、`extension-rpc` | 通用 extension manifest、资源和 wire 定义 | 无运行时依赖                 |
| `@pakka/client/pocket`                        | 工作台请求、事件观察、重连、正文和通知    | 只依赖 protocol              |
| `@pakka/client/webui`                         | 绑定身份的新服务 typed client             | 只依赖 protocol              |
| `@pakka/client/extensions`                    | 逐 facet 发现/控制、调用与两类原请求核对  | 只依赖 protocol              |
| `@pakka/agent` 的 `createAgentFacet`          | 可信 Agent 贡献、profile 上限与原生启停   | Agent/Pi，不依赖 WebUI       |
| `@pakka/webui/backend`                        | Node Backend context 与受权服务           | Node 产品包，不是前端依赖    |
| `@pakka/webui/assets`                         | 固定前端制品的 Node 读取与核对            | Node 产品包，不是前端依赖    |
| `@pakka/webui`                                | 默认 Node 产品装配 `startPocket`          | Agent、Server 和公开 Pi 能力 |

协议/client 包保留 ESM `import` 与 `types` 出口；不承诺 CommonJS `require`。固定开发消费使用实际 tgz 与锁文件，不使用 sibling 源码、私有 import、根 overrides 或两仓重复定义。包仍为 private，未发布 npm 版本；相同 package version 的不同开发候选须靠归档 hash 和实际配对区分。

旧 Node 产品包的 extension/extension-rpc/extension-client 定义移到 protocol/client，对内部和默认插件消费者一起改入口，不建立旧 export facade。旧 Preact 页面及 `ui/components` 仍只用于尚未切换的旧默认产品，不是新 SDK 消费路径，不承担旧用户兼容承诺。

## 2. 同源服务与身份

工作台使用 `/pakka-webui/rpc` 和 `/pakka-webui/events`，延用已声明的 v2 DTO；新服务使用 `/pakka-webui/services` 的 `api: 3`。extension 客户端可使用 `/pakka-webui/extensions/rpc`。人类身份交换、资产、下载、通知和 worker 沿各自已有安全处理接缝接入新 namespace；旧 `/pocket/models/rpc` 不映射成新模型接口。

浏览器使用同源 Cookie 与 `X-Pakka-CSRF`，endpoint 不接受认证信息、query/hash 或跨 origin；前端开发用同源代理。服务 request 在发送前固定工作台 hello 得到的 `personId/serverId`；后端从 Cookie 获取真正 actor，核对预期身份后才执行命令。客户端在响应、身份切换和异步返回时再次核对 request、server、Person 与结果种类。

服务的 `capabilities` 返回实际可用 features。当前组合是 services 3、workbench 2、extensions 3；其中 extension wire 不等于 `ExtensionManifest.api: 1`，UI SDK/runtime 又是另一项组合。capabilities 中的协议版本是有界声明值，由对应消费者判断是否支持；不能因为服务能力响应可解码就认定所有协议都兼容。服务 API、renderer 描述和文件 hash 各自检查，不通过给 closed hello 偷加字段协商。

Node 的 `publicOrigin`、trusted proxy 和 TLS 约束保持原实现：带 forwarding/trusted-peer 元数据的代理模式需要显式 HTTPS public origin；本地 HTTP origin 模式不靠伪造这些头部绕过要求。客户端、HTTP boundary 和受权服务缺一不可。

## 3. 新服务操作

`createWebUiServiceClient()` 是 inert factory；调用前传入明确 endpoint、CSRF getter、Person 与 server getter。通过 `request(command)` 获取对应闭合结果类型，没有自动写入重试。

| 命令                         | 结果和责任                                                    |
| ---------------------------- | ------------------------------------------------------------- |
| `capabilities`               | 服务组合与实际 features                                       |
| `resource.resolve`           | 原 Session/Conversation 的身份、权限、运行绑定及历史可读状态  |
| `resource.history`           | 已加载 owner 的预览，或已知未加载来源的有限保存历史页         |
| `resource.content`           | 原资源与内容引用绑定的连续正文范围，不接受任意文件/JSON 路径  |
| `model-connections.read`     | 原生配置的脱敏快照、opaque version、protectedPaths 与加载状态 |
| `model-connections.validate` | 候选定点修改的公开 ModelRuntime 校验，不保存或推理            |
| `model-connections.write`    | 实例配置保存/重载回执                                         |
| `model-connections.lookup`   | 按完整原始修改查原回执                                        |
| `model-connections.reload`   | 原生配置重载，与保存和在线目录刷新分开                        |
| `model-catalog.read`         | chat/image/classifier、实际 api 和非秘密参数的有界目录        |
| `model-catalog.refresh`      | 显式 provider、allowNetwork 的目录刷新，不是推理健康验证      |
| `model-defaults.read`        | 当前 Person 的默认值与版本                                    |
| `model-defaults.write`       | 当前 Person 的持久默认值及原请求回执                          |
| `model-defaults.lookup`      | 该 Person 原请求的默认值回执                                  |

当前 Conversation 的模型/Thinking 配置仍经工作台受权 Durable 命令。slash、悬浮搜索与点击/触控界面属于前端；这套服务不提供 `/model` TUI 或新的 Coding Agent AgentSession。预算和 Provider `/login` 不塞入本服务的实例配置对象；其界面/后续接缝各自推进。

目录支持固定 revision、provider/type/query、offset/limit。认证 configured 只表示 Provider 配置；不证明模型使用权限、远端可达或 tool calling 等能力。刷新失败保留已有目录并返回 unavailable，不把列表改成已验证模型。

目录的嵌套 parameters 与配置快照经过同一公开脱敏投影，包括 compat 中受保护的 headers。原生 ModelRuntime 会保留部分未知兼容字段；类型标签或 native validation 不能代替公开数据的脱敏，目录 revision 也只由已投影的公共内容形成。

## 4. 原生配置保存与默认值

实例连接定义以 pi-coding-agent 的原生 `models.json` 与公开 `ModelRuntime` 为单一加载/组合来源；pi-ai 拥有 Provider/Models/Model 契约。本接缝不是第二套 registry。

修改使用 JSON property path 与数值数组 index，不接受文件路径。候选先经 JSONC 语法、重复 key、有限 JSON、受保护字段和公开 ModelRuntime 校验；保留注释、未编辑内容、原生覆盖与既有凭据来源。ModelRuntime 接受部分未知属性，valid 不保证每个字段生效。原错误不透出路径或秘密。

`apiKey`、OAuth、headers、凭据/可执行来源及含认证信息的 URL 不回填，也不允许通过删父对象、换数组或其他普通参数修改间接替换。公开 revision 是带服务私密 seal 的 opaque 身份，不是可用于猜测凭据的原文件裸 hash。实例配置权限沿当前实例管理能力 `extensions.install` 核对；模型目录读取与选择不因此得到配置权限。

保存过程在原 Session 的公开 records 中持久接纳原请求，使用私密候选文件、API writer lock、版本检查和原子 rename，再核对发布字节并重载。保存与 reload 分别报告。API lock 不锁外部编辑器；外部修改不得和 API 并发写入，遇到无法确认的已接纳写入，回执保持 unknown，阻止后续写入覆盖它，不自动清锁或换身份重提。

丢响应后调用 `lookup`，传入同一 `requestId/expectedVersion/edits`；改动内容后沿用身份会被拒绝。`receipt: null` 不是证明效果未发生。服务接纳后的 unknown 不解释成 rollback。

Person 默认存在控制 Session 的独立原子记录，不写 pi-coding-agent 的全局 `settings.json`。默认只参与该 Person 后续新建、未显式指定的 Conversation；已有 Conversation、fork/inherit 来源和工作流显式配置不被覆盖。创建时仍重新核对目录、模型与资源权限；保存偏好不赋予执行能力。

extension 原请求链路仍是 `operationByRequest(browserRequestId)` → 外层 operation → 所属业务回执。`BackendContext.requestId` 是外层 operation id，不能拿浏览器 requestId 当内层服务 mutation id。

## 5. 原资源与生命周期边界

`ConversationReference` 包含 kind、sessionId、conversationId。解析不只比较 Conversation id，也不把当前 root Session 用作所有资源的 owner。扩展资产请求和 public `reconnect()` 保留完整 Session 身份；跨资源结果仍检查所属对象。

`resource.resolve` 的 loaded 结果携带当前合法 target；已登记但未加载、且原历史可读的结果为 `status: "unloaded", history: "readable"`，没有可执行 target。不可得、无权和身份不符分别报告；不兼容格式、错误来源及忙状态保持明确拒绝。Session 列表的 unavailable 表示执行 owner 未就绪，不直接决定原历史是否可读。

`resource.history` 接收稳定 reference 与可选 limit/beforeEntryId/maxBytes。已加载返回 `status: "loaded", snapshot`；未加载返回 `status: "unloaded", page`。后者使用 reference、sequence、entries、分页位置、saved 和 usage，没有 AgentRef 或 live 字段；保存的 busy/running 不是当前执行活动证明。默认 64 条、最大 256 条，页面最大 256 KiB；翻页使用返回的 olderBeforeId，不在浏览器等待期间保持 SQLite 事务。

`resource.content` 接收同一 reference、页面取得的 content 与 offset/length，单次最多 64 KiB。客户端核对原 Session/Conversation、完整内容定位及返回范围；按 nextOffset 继续，不用字符数推算字节位置。入口只读取既有公开投影中的正文，不能改 path 读取原生 data/configuration。分叉自身可见内容与来源身份的披露权限分开，不能凭继承内容取得源 Conversation 权限。

未加载路径经 `@pakka/agent` 的受信任 `readStoredConversation` 接到 Durable .4 的公开 SQLite reader，不创建 Runtime、不取得 writer 或恢复任务。Pakka 先验证已确认登记、原 Session/Conversation、来源与 read grant，返回前再次核对；执行、发送及管理仍要求已加载绑定。Node 定位、原生对象与数据库路径不进入浏览器协议。具体 SDK 边界见[只读 SDK](../../patches/pi-durable/1.4.0-pakka.4/README.md)。

客户端遇到身份关联正确但不支持的服务响应版本报告 VERSION_MISMATCH/unknown，不把它当成持久写入未发生的证明，也不自动换版本重提。固定制品声明的服务需求必须与实际服务配对。

UI dispose 属于单个界面实例；WebUI facet dispose 清理该 publication 的实例集合。它们都不是 Backend/Agent 的停用，更不取得持久工作取消权。浏览、UI 关闭和停止等待不启动模型。

## 6. 独立 facet 控制

一个获准来源可分别提供 backend、agent、webui、client。发现结果是逐 facet 的 registration，各自有 manifest/version、generation 和 phase，不再提供整扩展开关。Backend call 使用 backend generation；`assetUrl(extension, facet, generation, path, target?)` 只接受 webui/client 的对应 generation，目标资源仍保留 Session/Conversation 身份。

`control(change)` 的 change 包含 extension、facet、action（enable/disable/reload）、expectedGeneration、requestId。服务要求当前 Person 的 `extensions.install`，接纳及受控效果前重验；控制以已批准来源为上限，不从浏览器安装路径、代码或 profile。准备失败保留仍确认的旧 publication；相同原请求返回原结果，同身份不同控制参数拒绝。

`controlByRequest({ extension, facet, requestId })` 只查当前 Person 的原控制回执。lookup 的闭合输入只有这三个字段，不传整个 change。返回的 done 回执含原控制参数、actorId 和当时的 publication；当前状态另行 list。null 或 unknown 不证明没有效果，不允许自动重提或换 requestId。控制回执不等于 Backend 业务 operation；后者继续通过 operation / operationByRequest 核对。

| facet   | 控制的实际边界                                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend | 停止该注册的新调用和未通过有效性检查的后续效果；不销毁所属服务、既有历史、持久 job 或原回执。未确认初始化只隔离本 facet；重开不自动重入代码。 |
| Agent   | 在可信批准的 profiles 中改变后续工具/指令资格；不改 Conversation 身份，不因停用取消已接纳的原生工具结果或改写历史。                           |
| WebUI   | 改变该 UI publication 的装载资格，接入层通知纯 UI host 清理其实例；其他 facet 的改变不触发这项清理。                                          |
| Client  | 改变客户端模块的装载与绑定资格；不能撤回已经交付的 JavaScript，也不是浏览器代码安全沙箱。                                                     |

Agent 接缝由 `@pakka/agent` 的 `createAgentFacet` 构造，固定 id/version、profiles、tools 和可选 instructions，默认 disabled；通过 Runtime 的 agentFacets 及可信 extension source 显式组合。Agent-only 消费不安装 WebUI。公开 pi-durable Registry 始终位于 durable-adapter 内，不为此构建第二套注册系统。

`setEnabled` / `reconcile` 是可信 Node 控制端，不是浏览器授权凭据；reconcile 只重新发布该固定定义，不加载新代码。安装源码改变而没有对应可信定义时明确拒绝，不能把浏览器 reload 称作任意 Agent 热更新。端口 status 的 generation 标识原生调用资格，bindings 是已附着的原生 registry 数量，不是 UI 实例数；它与服务 publication generation 分开。

旧 generation 的延迟调用在资格边界被拒绝，重新启用也不恢复旧调用资格。已保存的指令和工具结果仍属历史；停用通过后续原生请求撤下贡献，而不是删除过去的文本。关闭先停止接纳；Agent 撤回未确认会报告清理失败，重复 facet close 保留同一次结果，不误报成功。

## 7. 固定前端制品

```ts
import { startPocket } from "@pakka/webui";

const app = await startPocket({
	runtime,
	frontend: {
		directory: fixedArtifactDirectory,
		manifestSha256: approvedManifestSha256,
	},
});
```

`runtime` 是受信任装配参数，不从浏览器接收。先核对 manifest digest、closed schema、受支持服务组合、有限文件及其内容 hash，再打开 Session；拒绝路径逃逸、符号链接、重复 URL、服务路由遮蔽、未声明 import/CSS/worker 与内容篡改。完整前端必须有已声明的 HTML entry；共享 runtime 的 entry:null 不能作为完整应用启动。

当前资产 schema 为 `2`，必填 `inlineStyleHashes` 是至多 16 个唯一、小写 SHA-256 hex，可为空。它只许可受信任构建已核对的固定运行时样式文本；Node 转为 CSP hash source，不接受任意 policy、外部 origin、`unsafe-inline` 或 `unsafe-hashes`。前端负责将摘要绑定实际依赖版本并验证字节；修改摘要属于修改固定制品，须重新批准 manifest digest。资产 schema 1 明确拒绝，不能把其中缺失的许可静默当成已支持。该格式版本独立于 services 3 / extensions 3 / workbench 2。

加载后 HTTP 提供已核对的内存字节，生产者后来改磁盘文件不改变正在提供的版本。无下载、运行时构建、npm latest 或失败后替换成另一份 UI。manifest 只描述 renderer 兼容，不让 Node 了解 Button、theme provider 或插件组件树。

本轮尚未切换默认产品。阶段 1 各项实际核对与尚未完成的产品范围以[任务](../../openspec/changes/plan-independent-webui/tasks.md)及其验证记录为准。
