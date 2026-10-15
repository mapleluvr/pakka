# Pakka monorepo 仓库规范

状态：已采用的仓库演进规范。`@pakka/agent` 保留现名；MAS、DevPack、协议与应用的目标边界不表示这些能力已经实现。

当前行为以 [ARCHITECTURE.md](ARCHITECTURE.md)、[STRATEGY-API.md](STRATEGY-API.md) 和源码为准；实施顺序见 [MONOREPO-MIGRATION-PLAN.md](MONOREPO-MIGRATION-PLAN.md)。历史验收只覆盖其记录的 commit、产物和范围。

## 1. 目录与命名

```text
pakka/
├── packages/
│   ├── agent/                 @pakka/agent：受控运行时与权限执行边界
│   ├── mas/                   @pakka/mas：资源、所有权策略、A2A 与恢复
│   ├── mas-devpack/            @pakka/mas-devpack：可选 Agent contribution；计划增加 Web facets
│   ├── protocol/              @pakka/protocol：browser-safe schemas
│   └── client/                @pakka/client：共享连接与受控请求
├── apps/
│   ├── server/                装配、认证、transport 与 worker 启动
│   ├── cli/                   操作员命令入口
│   └── webui/                 计划中的 @pakka/webui（Pakka-Pocket 单一产品包）
├── integrations/
│   └── dynamite/              固定外部版本的跨包验收
├── patches/
│   └── pi-durable/<revision>/ 固定基线、源码 patch、构建锁与产物身份
├── scripts/                   仓库构建、打包与验证工具
├── docs/                      契约、计划和验收记录
└── artifacts/                 被忽略的本地构建与调查证据

独立仓库 mapleluvr/pakka-dynamite
└── @pakka/dynamite             宿主无关 engine + Pakka adapter
```

上图同时标明现有组件与下一项产品目标。M1–M6 的 agent/MAS/DevPack/protocol/client/server/CLI 已存在；`apps/webui` 尚未创建，准备范围见 [PAKKA-POCKET-PLAN.md](PAKKA-POCKET-PLAN.md)。按真实实现创建目录，不创建空 package、空 app 或占位 exports。`pakka-si` 不自动纳入此次迁移。

`packages/` 放可复用库及 extension；`apps/` 放可执行产品与 composition root。Pakka-Pocket 采用单一产品包 `@pakka/webui`，不另造空 SDK 包；可通过纯 public SDK 子路径供 extension peer 消费，边界见下节。只有真实应用加入时才扩展 workspace、构建和检查范围。进程部署拓扑由应用明确选择，与 package/repository 的数量无关。

暂不引入 `@pakka/gate`、转发包或双名称发布。文档可以使用“gate 职责”描述 `@pakka/agent`，生产 import 和 package metadata 继续使用现名。

## 2. 职责与依赖方向

| 组件                 | 拥有的职责                                                                      | 不应获得的职责                                                      |
| -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `@pakka/agent`       | Pi 适配、身份与 capability、admission、生命周期、请求授权、受控存储和 inference | MAS 算法、Dynamite 算法、产品 UI 和默认装配                         |
| `@pakka/mas`         | 资源登记、membership、所有权策略、消息路由、投递恢复与编排                      | 原始 Pi handles、模型凭据、另一个权限内核或复制的 Durable scheduler |
| `@pakka/mas-devpack` | 工具、指令、调用 scope 与可选公开 Web facets/Board，见 P4 记录                  | 自行授予权限、开启任意 endpoint、直接管理 storage/进程              |
| `@pakka/dynamite`    | 编号、窗口、reduce、摘要计划、策略记录及 Pakka binding adapter                  | 直接发送主输入、获取凭据、绕过 inference 预算或依赖 MAS CLI         |
| server / CLI / GUI   | 产品装配或客户端入口                                                            | 在客户端重建权限、直接读写宿主内部文件或修改 Pi 对象                |
| Durable patch        | 下游 Durable 契约与可重建产物                                                   | 安装后动态修改另一份 Durable、MAS 产品逻辑                          |

目标调用方向：

```text
server bootstrap ──→ @pakka/agent + @pakka/mas + 可选 extensions/策略
@pakka/mas       ──→ @pakka/agent 的受控 runtime ports
MAS DevPack      ──→ principal-bound MAS port
CLI / GUI        ──→ MAS client 或服务接口
Dynamite adapter ──→ principal-bound StrategyBinding
@pakka/agent     ──→ 固定的 patched Durable + pi-ai/chord
```

MAS 和 Dynamite 不依赖 CLI；agent 不反向 import MAS、DevPack 或 Dynamite。`apps/` 可以装配库，核心库不能依赖 app。Pakka-Pocket 的明确例外仅为可选 extension facet peer-consume `@pakka/webui` 的纯 public SDK exports：不得 import executable、私有 store/router/backend startup；现有 Agent-only export 不加载 WebUI。纯 SDK、browser/backend graph 与安装消费者必须独立验收。默认启用、工具组合、模型 allowlist、凭据、预算与 worker 隔离由受信任 bootstrap 明确配置。

MAS policy 决定资源关系和可授予的动作；agent 在实际效果边界绑定调用身份、目标与有效期，并执行授权。MAS 通过窄端口完成登记和编排，不能取得可任意调用的原始事务或 Harness。可信 bootstrap 的控制端口与 agent-facing 端口必须分别授予。

库之间只 import 已声明的 package exports；禁止跨包引用 `src/`、`dist/`、workspace 路径或 sibling checkout。内部子模块优先留在所属包中；只有真实消费者和独立契约出现后才拆成新包，不建立无归属的通用 `utils` 包。

## 3. Pi、扩展与权限边界

生产 Pi mutable objects 和凭据继续封装在 `packages/agent/src/durable-adapter.ts`。多 Conversation/Session 支持也必须经过该适配边界。其他组件接收冻结 DTO 与绑定身份的命令 closure；测试 oracle 不进入生产 graph、声明或安装产物。

现有 MAS DevPack 的 Agent contribution 继续遵守已验收契约；后续 [WebUI/扩展契约](WEBUI-DEVELOPMENT.md) 增加可选 Agent、Backend、WebUI、Client facets，包含版本、激活/卸载、受限服务端口与 generation/invocation 生命周期。用户授权安装插件即确认代码可信，不代表每个被邀请人获得其业务权限，也不构成恶意插件沙箱。MAS Board 必须通过和另一份普通扩展相同的公开插槽实现；WebUI-only 不自动安装模型工具，Agent-only 不依赖 Web 产品启动。包入口不得通过自动发现、import 副作用或直接注册原生 Pi hook 绕过受控接口。

普通 hook 抛错仍可能被 Durable report-and-skip。拒绝生成使用受支持的 block/check 路径，在全部 hook 之后和 provider payload 边界重验；不以错误日志代替零 HTTP 证据。

工具参数中的 `from`、principal、owner 或目标 ID 只能作为数据，不能自证权限。宿主根据实际调用 Conversation、task/invocation 和已认证主体确认来源。旧 invocation、旧 lease、复制或序列化 capability 不得取得新的权限。

## 4. 身份、所有权与故障域

| 概念                            | 必须保持的含义                                                             |
| ------------------------------- | -------------------------------------------------------------------------- |
| Durable Session / storage scope | 一条原子提交线与持久化域                                                   |
| Harness                         | Session 上的调度与运行时                                                   |
| Conversation                    | transcript、active context、inbox、agent 配置与 provider identity 的作用域 |
| provider session identity       | provider affinity 身份；与上述持久化域分别记录                             |
| principal                       | 已绑定的调用主体                                                           |
| task ownership                  | Durable 的等待、取消和完成传播关系                                         |
| MAS ownership / grants          | 应用层资源控制与授权关系                                                   |
| AgentRef / SessionRef           | 可寻址的逻辑引用；引用本身不提供 authority                                 |

现有 Pakka `sessionId` 属于当前宿主契约，不能在迁移中无提示改作 Conversation ID 或 provider identity。新的 DTO 和 receipt 必须显式记录目标 Session、Conversation、incarnation/generation，以及相应 principal/lease/invocation；实际字段和版本由迁移契约固定。

上下文 owner、frame、projection permit、输入 admission 和策略产物必须绑定目标 Conversation。多 Conversation 的策略记录至少以 Session、Conversation、strategy、journal kind 分域。Session 级总预算与 Conversation 级预算分别定义，不能因新增 agent 自动重置或扩大已消耗额度。

Durable ownership 是生命周期关系，不是 ACL。应用 ownership 变更不能伪装成重写原生不可变 owner edge。长期成员、task-owned worker 与 background anchor 的取消/等待语义必须分别定义。

创建能力分开表达三个维度：

- 位置：已有 Session 或新 Session。
- 寿命：task-bound、长期存在或临时使用。
- 执行隔离：同进程或独立 worker/process。

新 Session 不自动代表新进程；同进程多个 Harness 仍共享 OOM、进程退出和运行时风险。同 Session 的 storage poison 影响整个提交域。Conversation/task 局部失败、Session 失败和进程退出分别上报；当前单 Host 的 fail-closed 行为不能在结构调整中被静默放宽。

每个 storage 只允许一个存活 writer。跨进程访问通过有明确 owner 的 worker 和消息端口完成，不能让多个 Harness 同时打开同一 storage。

当前 Durable 没有公开 Conversation 物理删除接口。`temporary`、reset、compaction 和 task 结束均不代表历史被删除。生命周期操作采用停止准入、abort/drain、retire/tombstone；物理 GC 必须另有保留规则和对 fork、task、receipt 引用的完整检查。未知效果或仅已请求 abort 不足以证明可回收。

## 5. A2A 与初始化

通信权限和管理权限分别授予。域内发现、发送和回复可以比 configure、steer、abort、retire 更广；收件方准入、预算、限流和退役规则仍须执行。允许通信不隐含读取完整 transcript、修改目标上下文或删除目标的权利。

消息 envelope 明确 message/request identity、经宿主确认的来源、目标、payload、关联与回复关系。普通消息、steer、follow-up 分别使用原生 admission/placement 语义；被动消息是否触发生成、如何进入模型上下文必须明示，不能自动拼接全部其他 agent 的历史。

投递 receipt 分别说明传输接收、目标 admission、queued/placed 和生成终态。目标 admission 不等于运行成功；超时、断线或 abort 请求后无法确认的状态保留为 `unknown`。幂等 request ID 去重不是 provider/tool execution 的 exactly-once 保证。同 key 的 payload/mode 冲突必须在受控边界拒绝。

同 Session 内的创建、agent 配置、初始文档和 membership 可以经受控端口放在同一次 Durable commit；provider 调用、环境分配和工具效果不能放进该原子性声明。已确认拒绝与无法确认的 commit/adoption 结果分别记录；unknown 不能推断成回滚成功。跨 Session 使用可恢复、幂等的 enrollment/activation 和 outbox/inbox，保留中间状态，不声明分布式原子提交。

跨重启的请求去重必须由目标侧持久 admission/inbox 记录与 Durable submission 身份共同支持，明确 payload 冲突检查、存储原子边界和记录保留期；现有进程内 C2 ledger 不足以证明这一性质。可恢复运行状态与运行时 authority 分开恢复，旧 capability 不复活。

长期通信保存逻辑地址和 durable receipts，由 broker/reporter task 重新取得当前权限；不持久化 invocation-bound ConversationHandle 或 capability。

## 6. 协议与客户端的抽取条件

M5 已抽取 `@pakka/protocol` 与 `@pakka/client` 并验证实际浏览器/CLI 消费。现有 v1 为显式 loopback token 协议；Pakka-Pocket 的多人/邀请/远程路径需要新的版本化 schema/client 入口、person-scoped read model 和事件流，不能直接放宽 v1 默认。其目标不等于已经交付，见 [Pakka-Pocket 计划](PAKKA-POCKET-PLAN.md)。

协议层只包含可序列化引用、命令、事件、错误、receipt、runtime schema 和版本协商；不能依赖 Node 文件系统、Pi runtime、server 启动或进程内 capability。TypeScript interface 不能替代消息 runtime validation。

远端客户端使用认证身份和服务端授权。跨网络 authority 若需要传输，须单独设计可撤销、可审计的授权机制；不能把现有 WeakMap token JSON 化。GUI/CLI 不持有模型/provider 凭据、原始 Harness 或直接写 storage 的能力；连接服务所需的客户端认证使用独立 scope。

## 7. Durable patch 与包发布

`patches/pi-durable/<revision>/` 是构建与兼容性输入，不是安装时执行的 runtime package。agent 只使用一份受支持的 patched Durable 实现，不能同时依赖 patch wrapper 和另一份自行解析的上游 Durable。

保留固定 commit、source patch、build lock、回归测试、artifact hash 和追加式 [兼容性账本](PI-DURABLE-COMPATIBILITY.md)。不得修改已安装依赖、fuzz-apply 到新版本、改写旧账本结论或用根 overrides 代替消费者契约。补丁等价行为及移除条件见 [patch contract](../patches/pi-durable/1.0.3-pakka.1/README.md)。

当前 `npm run pack:agent` 的 staging/bundle 路径继续有效。任何目录或打包调整都必须验证安装产物；不改用已被 guard 拒绝的 hoisted workspace raw pack。私有 package 保持私有，文档采用不构成发布或推送授权。

每个库维护真实 exports、声明、构建范围和依赖。版本根据公开行为/DTO/schema 的兼容变化推进，不能让相同 `0.1.0` 代表任意新字节和不同受支持行为。未发布开发产物另外固定 commit、tarball SHA/integrity、patch identity 和运行工具链；版本号不能替代构建身份。

## 8. 外部组件与验收

Dynamite 专项已由用户授权延期，先完成核心迁移再处理；[已确认问题与 DC-01–DC-12 功能目标](DEFERRED-DYNAMITE-COMPATIBILITY.md) 保留。延期不代表兼容通过、不解除其他门禁、不允许默认装配。

`@pakka/dynamite` 继续位于 [mapleluvr/pakka-dynamite](https://github.com/mapleluvr/pakka-dynamite)。其 engine/ports 与 Pakka adapter 可以在同一包内分层；目前不再拆成多个 npm 包。默认算法不依赖 MAS；未来委派摘要作为可选 job backend，继续受宿主 inference/source 权限约束。

`integrations/dynamite` 保存可执行消费者测试和版本配对规则。外部 checkout 放在被忽略的 `artifacts/` 或显式 sibling 路径；固定 git commit，禁止浮动 HEAD 作为放行输入，不提交机器绝对路径、共享 node_modules 链接或开发 tarball。现有已审计 Durable vendor tarball 是明确例外。

必须同时保留 source/workspace 回归与仓库外安装验收。安装消费者不携带根 overrides、不解析 workspace 私有源码、不加载 oracle；检查实际 exports/声明/依赖，并对本地确定性 HTTP 与真实 storage 断言效果。

权限、持久化、scope、wire 或恢复边界改变时，需要可重复的失败先行回归，以及实施阶段的独立只读对抗复审。证据记录实际 commit/产物、请求与工具次数、终态、原始存储、命令结果和残余限制；测试数量本身不能证明产品能力。纯文档修改检查内容、链接与格式，不要求重跑无关模型集成矩阵。

## 9. Repository 拆分规则

| 组件                                | 当前选择                                     | 重新评估的条件                              |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------- |
| agent / gate 职责 / Durable adapter | 同仓、同包                                   | 存在真实独立消费者、稳定端口和独立发布需要  |
| Durable patch                       | Pakka 内版本化 patch                         | 有其他 downstream 消费者和独立发布/回归流程 |
| MAS 服务与 DevPack                  | 同仓、分包                                   | 契约稳定且能够适配其他宿主                  |
| Dynamite                            | 保持现有独立仓库                             | 通过固定版本的跨仓验收维护兼容              |
| GUI / pi-pocket 收编                | 计划为单一 `@pakka/webui` 产品包，与主仓维护 | 出现稳定公开协议、独立交付和真实拆仓需要    |
| CLI / server                        | 同仓应用                                     | 出现独立维护、发布或部署需求                |

独立 package 可以拥有自己的版本而留在同仓；独立进程也可以由同仓应用启动。只有消费契约、release 和集成验收均可独立时才拆 repo。GUI fork 保留上游历史与可复核的版本；本规范不假定未经调查的 pi-pocket transport/API 已兼容 Pakka。
