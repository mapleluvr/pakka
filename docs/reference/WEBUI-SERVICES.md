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
| `@pakka/client/extensions`                    | extension 发现、调用与原 operation 核对   | 只依赖 protocol              |
| `@pakka/webui/backend`                        | Node Backend context 与受权服务           | Node 产品包，不是前端依赖    |
| `@pakka/webui/assets`                         | 固定前端制品的 Node 读取与核对            | Node 产品包，不是前端依赖    |
| `@pakka/webui`                                | 默认 Node 产品装配 `startPocket`          | Agent、Server 和公开 Pi 能力 |

协议/client 包保留 ESM `import` 与 `types` 出口；不承诺 CommonJS `require`。固定开发消费使用实际 tgz 与锁文件，不使用 sibling 源码、私有 import、根 overrides 或两仓重复定义。包仍为 private，未发布 npm 版本；相同 package version 的不同开发候选须靠归档 hash 和实际配对区分。

旧 Node 产品包的 extension/extension-rpc/extension-client 定义移到 protocol/client，对内部和默认插件消费者一起改入口，不建立旧 export facade。旧 Preact 页面及 `ui/components` 仍只用于尚未切换的旧默认产品，不是新 SDK 消费路径，不承担旧用户兼容承诺。

## 2. 同源服务与身份

工作台使用 `/pakka-webui/rpc` 和 `/pakka-webui/events`，延用已声明的 v2 DTO；新服务使用 `/pakka-webui/services` 的 `api: 1`。extension 客户端可使用 `/pakka-webui/extensions/rpc`。人类身份交换、资产、下载、通知和 worker 沿各自已有安全处理接缝接入新 namespace；旧 `/pocket/models/rpc` 不映射成新模型接口。

浏览器使用同源 Cookie 与 `X-Pakka-CSRF`，endpoint 不接受认证信息、query/hash 或跨 origin；前端开发用同源代理。服务 request 在发送前固定工作台 hello 得到的 `personId/serverId`；后端从 Cookie 获取真正 actor，核对预期身份后才执行命令。客户端在响应、身份切换和异步返回时再次核对 request、server、Person 与结果种类。

服务的 `capabilities` 返回实际可用 features。当前组合是 services 1、workbench 2、extensions 2；其中 extension 兼容声明不等于 `ExtensionManifest.api: 1`，UI SDK/runtime 又是另一项组合。服务 API、renderer 描述和文件 hash 各自检查，不通过给 closed hello 偷加字段协商。

Node 的 `publicOrigin`、trusted proxy 和 TLS 约束保持原实现：带 forwarding/trusted-peer 元数据的代理模式需要显式 HTTPS public origin；本地 HTTP origin 模式不靠伪造这些头部绕过要求。客户端、HTTP boundary 和受权服务缺一不可。

## 3. 新服务操作

`createWebUiServiceClient()` 是 inert factory；调用前传入明确 endpoint、CSRF getter、Person 与 server getter。通过 `request(command)` 获取对应闭合结果类型，没有自动写入重试。

| 命令                         | 结果和责任                                                    |
| ---------------------------- | ------------------------------------------------------------- |
| `capabilities`               | 服务组合与实际 features                                       |
| `resource.resolve`           | 原 Session/Conversation 的身份、权限和已加载状态              |
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

当前公开服务只解析已有 owner 已加载的资源。未加载、不可得、无权、错身份分别报告；未加载的原历史读取明确为 `history: "unsupported"`，不自动 reopen writer。原生 SQLite 初始化有写入行为，不能用 readonly flag 或私读 schema 冒充公开历史 API。

UI dispose 属于单个界面实例。整体 extension enable/disable/reload 不等于分 facet 停启；独立 Backend/Agent/WebUI/Client 控制尚未形成，不返回假成功。浏览、UI 关闭和停止等待不启动模型、不取消已接纳工作。

## 6. 固定前端制品

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

加载后 HTTP 提供已核对的内存字节，生产者后来改磁盘文件不改变正在提供的版本。无下载、运行时构建、npm latest 或失败后替换成另一份 UI。manifest 只描述 renderer 兼容，不让 Node 了解 Button、theme provider 或插件组件树。

本轮尚未切换默认产品。阶段 1 结果与未完成的原历史/facet/完整应用范围以[任务](../../openspec/changes/plan-independent-webui/tasks.md)及其验证记录为准。
