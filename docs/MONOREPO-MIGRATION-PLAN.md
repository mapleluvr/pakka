# Pakka monorepo 与 MAS 迁移计划

状态：M1–M6 核心迁移已验收（带明确 notes），后续恢复 Dynamite 专项，分支为 `feat/monorepo-mas-migration`。M0 的固定源码/tarball 消费门禁已建立，已确认配对失败；用户明确授权将 Dynamite 专项标记为 **deferred / 未处理**，先完成 M1–M6 核心迁移，再处理兼容性。功能目标、原始失败身份与恢复条件见 [DEFERRED-DYNAMITE-COMPATIBILITY.md](DEFERRED-DYNAMITE-COMPATIBILITY.md)。这不是 M0 passed，也不解除其他权限/持久化/恢复门禁。不创建空包、不更名 `@pakka/agent`、不发布。

约束见 [MONOREPO-CONVENTIONS.md](MONOREPO-CONVENTIONS.md)；现有宿主行为见 [ARCHITECTURE.md](ARCHITECTURE.md)。[PI-DURABLE-MIGRATION-PLAN.md](PI-DURABLE-MIGRATION-PLAN.md) 记录此前后端切换，[MIGRATING-DYNAMITE.md](MIGRATING-DYNAMITE.md) 是早期算法迁移调查；它们不能替代本计划对当前版本的再验收。

## 1. 基线与目标

本计划调查基线：

| 输入               | 固定身份与范围                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pakka              | `6c77632`，`@pakka/agent@0.1.0`，Durable 默认生产后端；当前 Host 对应一个 storage scope 和一个活动 Conversation                                         |
| Durable            | `1.0.3-pakka.1`，上游 `d78dc83d633229d12f8b79631384c4c2717c399f`；hash 和构建身份以 `patches/pi-durable/1.0.3-pakka.1/artifact.json` 为准               |
| Dynamite           | `mapleluvr/pakka-dynamite`，调查 commit `5ff775aee041fe63a82a7fcd1d108d17c206da4e`，`@pakka/dynamite@0.1.0`                                             |
| 既有验证           | Pakka 127/127、Durable 定向 105/105、外部消费者 7 次本地 HTTP 是此前基线；不是未来 MAS 的放行结果                                                       |
| 历史 Dynamite 配对 | 已记录验收基于 Pakka `f9578776a46c2c07ae783dd97ee75adcb3b5d3af` 与 Dynamite `bd45756f272cd2d4af3c0b9e55fc2587e8bf4678`，不能推导当前 Durable 配对已通过 |

目标是在既有受控宿主之上提供：同 Session 多 Conversation、跨 Session 的 MAS 服务、可选 MAS DevPack，以及 CLI/server/GUI 可以消费的协议。每个 agent 都能在被授予的范围内通信和申请资源；创建、配置、steer、停止与退役仍按资源所有权和 capability 执行。

目录迁移不改变以下承诺：Pi handles 留在 adapter；普通未知存储与副作用失败关闭；原生 steer/follow-up timing 保留；projection 与 source job 继续重验；策略不持有凭据；Dynamite 原始历史与算法边界保持独立。

不在本计划中承诺：全部 Pi extension/provider 兼容、共享 storage 多 writer、分布式事务、exactly-once 外部副作用、完整旧 Kappa 数据导入、物理 Conversation 删除或 `pakka-si`。

## 2. 顺序与阶段边界

```text
M0 当前 Durable × Dynamite 契约与安装验收：deferred，保留失败证据与 DC-01–DC-12

核心迁移：
M1 @pakka/agent 多 Conversation scope 与故障边界
 ↓
M2 @pakka/mas 同 Session 的资源、所有权与 A2A
 ↓
M3 多 Session enrollment、持久投递与独立 worker
 ↓
M4 @pakka/mas-devpack 可选 extension
 ↓
M5 server 协议、client 与操作员 CLI
 ↓
M6 集成产品验收（不装配 Dynamite）；按需要接入 GUI 和评估独立 repo
 ↓
恢复 Dynamite 专项：版本化映射、完整兼容矩阵、真实产物与产品配对
```

Dynamite 延期是用户对顺序的明确调整：它不再阻塞 M1–M6，但迁移期间不能默认装配或宣称其兼容。后续阶段可以在端口固定后开发内部纯逻辑；除这个专项外，依赖阶段未通过时，不把后续能力启用为生产默认。每阶段提交可复核的契约变化、实现、行为回归和证据索引；在实现新的权限/存储/恢复边界时完成独立只读对抗复审，再放行依赖该边界的阶段。

不在一次“目录整理”中同时更名、修改算法、重写持久化和加入 UI。应用与 package 只随可执行功能创建，workspace/build/check 配置也在同一阶段加入。

## M0：固定当前跨包兼容契约

### 工作

1. 固定两仓 commit、tarball hash/integrity、Durable patch identity、Node/npm/compiler 和原有测试结果，使用独立本地 HTTP provider 与隔离数据目录。
2. 建立 `integrations/dynamite` 的真实消费测试。外部源码按固定 commit 取得，消费者安装打包产物；不修改 sibling checkout 或依赖根 overrides。
3. 用失败先行回归核对 raw entry/message mapping：当前 Durable frame 使用 `pi.user` 等 kind 和 `model[]`，调查到的 Dynamite adapter 部分 raw-message 路径仍识别旧 `message/custom_message` 形状。确认编号、source provenance、step 边界与有效 context edit，而不是仅编译成功。
4. 在 producer DTO 或 adapter 中选定一个明确、版本化的映射，记录兼容变化。不能为模拟旧形状而复制 scheduler，也不能让算法自行读取原始 Pi storage。
5. 明确 package version 与实际构建配对；改变公开 DTO/行为时更新版本或支持矩阵，更新精确 peer/dev artifact integrity。

### 退出条件

- 实际安装的两个 tarball 完成编号、reduce/flush、压缩候选触发、reload/reopen、源 edit/ABA 与 unknown-storage 回归。
- 下一次真实 HTTP request 的内容、原始历史保留、64/128 wire cap 和零额外 dispatch 的拒绝路径有证据。
- 当前宿主原有 C2/权限/生命周期矩阵通过；生产依赖不含 oracle，私有 import 被拒绝。
- 若存在不兼容，留下原始失败证据和明确的 blocked 配对，不把历史验收数字当作当前结果。

本阶段不依赖 MAS，也不以创建新目录代替跨包闭环。专项现为 deferred：保留以上完整目标与实际失败，先按用户授权推进核心迁移，再以迁移后的版本补齐矩阵；不得把该顺序调整写成通过。

## M1：让 agent 成为多 Conversation 的受控运行时

### 工作

1. 固定受控 runtime ports 与 DTO，区分 Session/storage、Conversation、provider identity 和应用 agent reference。现有单 Conversation Host API 保留明确兼容路径，不把 `sessionId` 无提示改义。
2. 在现有 adapter 内管理多 Conversation；分别维护 context cache、busy/run、inbox/receipt、navigation、lease、request 和 invocation。所有生产 Pi mutable handles 仍留在 adapter。
3. 将 context owner、frame basis、projector、source job、admission 和 artifacts 绑定到目标 Conversation。每次请求拥有独立 permit/check；不能把现有单个 `#request/#permitId` 或 host owner map 原样共享给并发 agent。
4. 策略 journal 使用明确的 Conversation namespace。现有记录只在可证明原属唯一 Conversation 时进行显式映射，保留旧 schema/provenance 与迁移 receipt；不猜测、不覆盖、不借机做 bulk legacy import。
5. 定义 Conversation 预算与 Session 聚合预算，保留旧 consumed/unknown 花费。明示 Context Arbiter 的目标 scope，不扩大其他策略的写权。
6. 区分可归因的 task/run 失败、权限协议失败、Session storage poison 和进程退出。现有 fail-closed 兼容路径保持不变；不能把不明 `onReport` 错误直接降格成局部成功。

### 退出条件

- 至少两个并发 Conversation 使用不同 projection，真实 HTTP 的消息、permit、工具、receipt 与 source jobs 无串用。
- 相同 strategy ID 在不同 Conversation 的 journal/lease 独立；A 的 reload、导航 ABA、撤权和旧 tool completion 不取得 B 的权限。
- A 的局部失败/abort 对 B 的影响符合显式 ownership；Session 级存储不确定阻断整个对应域。
- 原生 steer/follow-up placement、故意 block、post-tool block、输入 committed 与生成终态的区别保持；禁止路径零未授权 HTTP/写入。
- namespace 迁移、旧 Host API 与隔离安装通过；新的 public schema 和 exports 有版本记录。Dynamite 专项按延期记录保留，不能以其未通过阻塞本阶段，也不能宣称迁移后的 Dynamite 已受支持。

M1 已完成：`@pakka/agent@0.2.0`，156/156 真实回归、隔离 tarball（legacy 7 HTTP / managed 3 HTTP）和两轮独立复审均通过。范围、构建身份与残余限制见 [MIGRATION-M1-ACCEPTANCE.md](MIGRATION-M1-ACCEPTANCE.md)。

## M2：建立同 Session 的 MAS 服务

### 工作

1. 创建 `packages/mas`，实现 registry、membership、资源引用、所有权策略与通信端口。bootstrap 注入 agent 控制端口；MAS 对 caller 返回绑定主体的 client，不返回原始 Harness/Tx。
2. 定义逻辑 owner 和动作策略，区分发现/发送/回复、观察状态、configure/fork/steer/abort/retire。Durable task ownership 保留原义，不能当作 ACL 或可任意重写的 owner graph。
3. 通过 agent 的受控创建操作，在同一次 Durable commit 中提交 Conversation、agent 配置、初始文档与 membership。外部环境准备、provider 自检和启动在 commit 之后执行。
4. 定义 `preparing -> ready -> active` 激活过程和失败中间态。运行时自检不能仅用“注册成功”代替；提交业务输入前核对成员实际 readiness。
5. 实现同 Session A2A：宿主确认来源、明确目标和消息模式、request key/payload 冲突、收件方准入，以及 native submission receipt 的映射。
6. 提供停止准入、abort/drain 和 retire/tombstone。temporary、task-owned 和长期 agent 分别记录寿命；此阶段不物理删除历史或扫描回收共享 storage。

### 退出条件

- 已确认拒绝的创建 commit 不留下已提交成员；commit/adoption 无法确认时保留 unknown，阻断启动并回读核对，不能自动重建或声称回滚成功。commit 成功而 readiness 失败时保留可恢复状态，未进入业务 active。
- 伪造来源、跨主体复用 capability、越权 configure/abort/retire、撤权后的迟到请求全部拒绝且无目标效果。
- A 可以按通信 policy 向 B 发送/回复，而不能据此读取完整 B transcript 或取得管理权；收件方拒绝、限流与预算可观察。
- duplicate/conflicting requests、busy queue、steer/follow-up、超时和已 placed 后 abort 的 receipts 不被错误释放或重试。
- 同 Session 的 task-owned 子树与 background boundary 使用真实 Durable 任务验证。

M2 已验收：`@pakka/agent@0.3.0` + `@pakka/mas@0.1.0`，176/176 全量真实回归、17/17 focused MAS/ownership 回归、隔离 tarball consumer 和两份独立复审通过，P2 均已处理。完整证据与限制见 [MIGRATION-M2-ACCEPTANCE.md](MIGRATION-M2-ACCEPTANCE.md)。M3–M6 的状态见各自阶段。

## M3：多 Session、恢复投递与独立 worker

### 工作

1. 为 MAS broker 提供已有/新 Session placement，记录 storage ownership、incarnation 和 worker reference。新 Session 始终使用独立 storage，一个 storage 只有一个 writer。
2. 新 Session 创建由受信任 bootstrap/worker manager 完成，业务 agent 只能通过 policy 申请。明确同进程与独立 process 配置，不把新 Harness 伪装成进程隔离。
3. 实现 coordinator 的 durable enrollment/activation：各 Session 先准备并回报 readiness，再激活。失败时停止或退役已准备资源，保存补偿与未知结果；没有跨 Session 原子性声明。
4. 定义发送方 outbox、目标侧持久 inbox/admission 和回执 reconciliation。目标身份、payload 冲突检查、submission 创建与去重记录采用明确的原子提交边界，固定 retention 和过期重试规则；现有进程内 C2 ledger 不能承担跨重启去重。重启继续同一 message/request identity，目标使用当前受控权限。
5. 长期回复使用 durable reporter/background task 或 broker state，不保存 invocation-bound handle，不依赖模型文本宣称送达。
6. 创建实际 `apps/server` worker bootstrap/manager 与 IPC 入口，装配受控 agent/MAS 服务。完整对外 server 协议留到 M5；worker 入口须能真实启动、停止和恢复，不能是占位 app。

### 退出条件

- 在 enrollment 的各持久化边界中断并重开，资源不被重复创建，未 ready 的 MAS 不接收业务工作。
- 在 outbox 写入、目标 admission、回执返回等边界中断，恢复后无重复 admission；丢回执和超时保留可核对的 unknown，不宣称外部效果 exactly-once。
- 同进程两个 Session 的单 storage poison 不污染另一 storage；独立 worker 的进程退出不停止其他 worker。
- worker 关闭后重开保持合法记录和投递身份，重新授予运行时权限；旧 token 不复活，旧 incarnation 消息不投递到替代 agent。记录 retention 到期后的旧 request 必须明确拒绝或重新协商，不能静默当作首次 admission。
- 不能证明单 writer、预算、准入或物理状态时阻断操作；独立进程测试使用本地 provider 和受控退出，不使用真实模型。

M3 已验收，带明确限制：`@pakka/agent@0.4.0` + `@pakka/mas@0.2.0` + private `@pakka/server@0.1.0`，196/196 全量、20/20 定向回归与真实独立 worker/tarball 消费通过；两轮指定 adversarial-review 为 OK with notes，残余项和复审质量更正见 [MIGRATION-M3-ACCEPTANCE.md](MIGRATION-M3-ACCEPTANCE.md)。M4–M6 的状态见各自阶段。

## M4：MAS DevPack 与可选 built-in extension

### 工作

1. 创建 `packages/mas-devpack`，定义版本化安装 descriptor、tools/instructions、激活/卸载和受限 MAS port。最终工具名与 schema 由该阶段契约固定。
2. 向每个被启用的 Conversation 提供创建、发现、发送、请求/回复、状态、停止与退役接口；位置、寿命和隔离为独立维度，申请能否执行由授予的 policy 决定。
3. 选择已有 Session、新 Session 和 temporary 模式时复用 M2/M3 的服务；禁止在 tool 中直接 `Harness.open`、选择任意 filesystem path 或授予自身权限。
4. invocation 绑定实际来源；异步等待后重验目标、lease 和生命期。长期请求返回逻辑 reference/receipt，由持久 reporter 完成。
5. built-in 默认启用、预设和后续 child 的 DevPack 选择由 composition root 显式配置。开启代码不隐含全部 grants；卸载停止新的工具使用和后台权限。

### 退出条件

- 使用真实 Conversation、model tool call 和本地 HTTP 测试全部受支持创建模式及 A2A；不能只由服务直接调用证明 extension 可用。
- 无 DevPack 的 Conversation 不获得工具；被授予 send 的 agent 无法借工具调用取得管理员权。
- late invocation、复制 token、跨 Conversation scope、卸载/撤权与 worker replacement 的请求无未授权效果。
- DevPack 的故障不绕过 gate；临时成员退役后拒绝新消息，历史保留语义明确。
- 安装产物不包含凭据、native handles、私有源码 import 或 import-time server/Session 启动。

M4 已验收，带明确 notes：agent `0.5.0` + mas `0.3.0` + mas-devpack `0.1.0` + private server `0.2.0`，全量 216/216、定向 20/20、真实 native model tool/worker 和隔离 tarball HTTP 7/3/3/3/8 通过；两轮指定 adversarial-review 均 OK with notes。typed denial、post-send unknown、40-slot CAS、ancestor grant 反例及两项 report-only P2 见 [MIGRATION-M4-ACCEPTANCE.md](MIGRATION-M4-ACCEPTANCE.md)。M4 的验收不推定 M5–M6 完成；M5 当前状态见下一节。

## M5：对外协议、客户端与 CLI

### 工作

1. 在真实 remote/browser 消费开始时抽取 `packages/protocol`；serializable commands/events/refs/errors/receipts 使用 runtime schema 和明确的版本协商。
2. 根据消费者需求保留 `@pakka/mas/client` 或抽取 `packages/client`，复用连接、request identity、状态查询、取消与重连。不能把进程内 WeakMap capability 直接序列化。
3. 补全 `apps/server` 对外 transport、认证、来源绑定和授权；保留 worker 管理边界。服务端选择 endpoint/凭据和有限预算，远端只提交受支持的配置引用。
4. 创建 `apps/cli`，调用相同服务/客户端实现；CLI 只做参数、输出和操作员入口，MAS/DevPack/Dynamite 均不反向依赖它。
5. 事件有 Session/Conversation scope、顺序或 snapshot/reconnect 语义；不能假定跨 Session 一个全局 revision。区分 admission、generation、delivery 和 effects 的结果。
6. 加入真实 app workspace/build/check，检查 browser-facing graph 无 Pi、Node storage 或 server-only 实现。

### 退出条件

- 本地真实 server/client/CLI 完成认证、创建、通信、查询、撤权、取消和重连，不仅验证 JSON 形状。
- schema 错误、未知版本、伪造 source、跨身份重放和过期授权拒绝；断连不被当作未送达证明。
- 浏览器消费者能编译并连接，不读取宿主文件；客户端看不到模型凭据和内部 handles。
- 远端 capability 的安全与撤销契约有独立验收；未实现部分继续 unsupported，不能通过可序列化数据冒充 authority。

M5 已验收，带明确 notes：agent `0.5.0` + mas `0.4.0` + mas-devpack `0.2.0` + protocol/client/cli `0.1.0` + private server `0.3.0`，全量 242/242、定向 26/26、真实 browser/server/CLI 与隔离 tarball HTTP 7/3/3/3/8/2 通过；第一轮指定复审 BLOCK 后完成真实反例修复，第二轮两方/closing 均 OK with notes。确定 pre-effect denied、opaque callback effects unknown、严格关联和 report-only P2 见 [MIGRATION-M5-ACCEPTANCE.md](MIGRATION-M5-ACCEPTANCE.md)。clean workspace 须先 build，再 check/test；M6 状态见下一节。

## M6：产品配对验收与 GUI 决策

### 工作

1. 装配实际 server/CLI、MAS/DevPack；本轮 Dynamite 专项 deferred，不装配。default strategy 的选择按 Conversation 独立授予；默认包与用户策略同样遵守 owner/lease/budget。
2. 在隔离消费者中安装实际产物，固定所有构建配对，验证无需 root overrides、workspace paths 或 sibling 源码即可运行。
3. 覆盖同 Session 多 agent、同进程多 Session、独立 worker、task-bound/temporary/长期成员与可选 DevPack 的受支持组合；未支持配置明确拒绝。
4. 如接入 GUI，先调查 pi-pocket 的固定版本、许可、transport 与 fork 维护方式，再选择 `apps/gui` 或独立 repo。GUI 只能消费 M5 协议；保留上游历史，不能直接取得 gate 控制对象。
5. 更新当前 README/architecture/支持矩阵，保留历史账本和验收身份；独立 reviewer 检查真实生产路径、复杂度和具体故障案例，再完成受支持范围的放行。

### 退出条件

- 公开声明、exports、真实 HTTP、tool 次数、原始存储、消息/成员终态、费用 unknown 与恢复结果全部可复核。
- 用户可启动实际入口并观察 MAS，而不必从 library 测试结果推断产品存在。
- patch 升级和核心产品装配有明确消费者回归；没有因 monorepo hoisting 隐藏版本漂移。Dynamite 未升级/未装配，状态单独保持 deferred，待核心迁移完成后验证其升级及产品配对。
- GUI 是否拆仓由稳定协议、独立构建/验收和维护需要决定，不作为 MAS 完成的必需条件。gate 更名、patch 独立发布和 SI 不自动加入范围。

M6 已在受支持 headless 范围验收：private server `0.4.0`，agent `0.5.0` + mas `0.4.0` + mas-devpack `0.2.0` + protocol/client/cli `0.1.0`；全量 **251/251**、定向 **17/17**、离线 clean staging 及隔离 tarball 消费通过，新增 product consumer 独立验证 **18 次 HTTP / 7 个 native tool-call/result pair**、四种 lifetime、动态 roster 正常 reopen 与 spent quota。第一轮完整指定复审两方/closing 均 OK with notes，候选 P2 被反驳并撤回；没有复审后的代码修改或冗余第二轮。GUI 本轮不创建，Dynamite 仍 deferred，下一步以此核心产物恢复 DC-01–DC-12。固定身份、hardening notes 和剩余限制见 [MIGRATION-M6-ACCEPTANCE.md](MIGRATION-M6-ACCEPTANCE.md) 与 [MAS-PRODUCT-SUPPORT.md](MAS-PRODUCT-SUPPORT.md)。

### Core 后 Dynamite 专项 — 显式可选配对带 notes 验收

保留历史 M0 配对的 1/6、五失败；新配对单独固定为 `agent@0.5.0 × dynamite@0.2.1`，private server `0.5.0`。库基线 `0.2.0` 已通过完整指定复审；实际产品触发后修复了无精确 inference receipt 时错误写 adoption 的边界，未改变核心 tarball或成熟压缩算法。候选执行门禁为核心 255/255、库 345/345、隔离库 47/47（299 本地 HTTP）、产品 5/5（107 HTTP、8 原生 tool call/result），均无 skip/todo/cancel；原有 M6 安装消费者也通过。

当前只允许宿主显式选择初始持久成员，不默认启用，不部署到 private worker 或动态子成员；lease 撤权不等于跨显式重新 bootstrap 的持久权限删除。配置和恢复范围见 [DYNAMITE-PRODUCT-API.md](DYNAMITE-PRODUCT-API.md)。完整指定产品复审已收敛，遗漏门禁脚本的冻结身份已修正并通过 35 文件/2 tarball 验证；B-1 的 P1/P2 分歧、B-2 产品预算正向拒绝观测限制和最终身份见 [验收记录](DYNAMITE-PRODUCT-ACCEPTANCE.md)。只放行此显式有限配对，未把 Dynamite 整体或历史 M0 改成 passed。

## 3. 验证、交付与恢复规则

当前已有命令可以作为 M0 基线：

```powershell
npm ci --ignore-scripts
npm run check
npm run build
npm run format:check
npm test
npm run smoke:package
```

未来 integration/app 命令在实现时加入各自 manifest；本计划不把尚不存在的命令当作可运行交付。测试固定实际 production import、独立数据目录、本地 HTTP 和真实 storage，不读取用户凭据或调用付费模型。

普通检查验证已固定的 patch hash；只有 patch/source/build-input 改变或兼容性失效时才独立重建并跑下游定向矩阵。新增权限/恢复/传输边界先跑针对性的反例，再跑受影响的完整回归和安装消费者；不重复无变化的昂贵矩阵。

每阶段证据至少包含：

- commit、package/contract/schema 版本、tarball SHA/integrity、Durable patch identity 和工具链。
- 必需的失败先行用例、最终结果、本地请求 payload/次数、tool 次数、task/submission/delivery 终态与原始 storage。
- 新增公开边界、数据迁移报告、对旧消费者的影响、未支持配置和 reviewer 未解决问题。

实施阶段的独立 review/fix 轮次预先限定；存在未解决的权限、未知存储或实际效果问题时保持 blocked，并报告证据，不循环到仅凭测试数量宣称完成。

代码回退不能自动回退数据、已发送模型调用、工具效果或已消费预算。数据 schema 变化必须先保存原始输入与迁移记录；reopen 不重建旧 authority；失败 Session 不靠 reload 或重新 new 一个策略实例解除 unknown。阶段未通过时不启用新的默认产品配置，已产生的记录和失败证据保留。

文档落地与实现完成分别记录。本计划的 M0–M6 状态只能在对应产物、运行证据和必要复审完成后更新。
