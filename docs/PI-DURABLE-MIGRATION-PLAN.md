# Pakka → Pi Durable 迁移计划

状态：可执行方案  
日期：2026-10-11  
目标：让 `pi-durable` 成为 Pakka 的默认生产后端。  
基线：Pakka 当前没有实际用户、没有必须保留的线上会话；旧 `AgentSession` 适配器保留为测试 oracle，不作为生产回退。

相关文档：

- [Architecture / contract](./ARCHITECTURE.md)
- [Strategy Control API](./STRATEGY-API.md)
- [Pi Durable compatibility ledger](./PI-DURABLE-COMPATIBILITY.md)

## 0. 决策与范围

### 0.1 迁移决策

迁移采用直接切换：

```text
Pakka public API
    → DurableAdapter
    → Pi Durable Harness / tasks / storage
    → pi-ai provider
```

旧路径只用于：

- 运行同一场景的差分测试；
- 解释旧契约的历史语义；
- 在迁移期间定位行为差异。

不做：

- 旧路径与 Durable 双写；
- 生产运行时自动回退到 `AgentSession`；
- 没有数据需要时的旧 JSONL 批量导入；
- 为了伪造兼容而复制 Durable scheduler；
- 对 `node_modules` 做未记录的直接修改。

### 0.2 迁移的对象

迁移对象是 Pakka 现在公开的 host/client/strategy 契约，不是 `pi-coding-agent` 全部功能。当前明确不属于本次迁移完成条件的能力，必须继续保持显式关闭或明确标注未实现：

- Pi 原生 extensions、skills、prompts、themes 和自动 resource discovery；
- 完整 TUI/CLI；
- RPC 认证和可序列化 capability；
- 多进程 C2 崩溃恢复；
- 任意 provider 家族的兼容；
- 动态运行时修改模型策略；
- Dynamite 算法和默认策略集成。

如果执行中决定加入其中任何一项，必须另开设计条目，不得顺手混入迁移提交。

### 0.3 完成定义

迁移完成必须同时满足：

1. `createHost()` 默认创建 Durable-backed host，旧 adapter 不在默认运行时路径中。
2. Pakka 公开 DTO、receipt、权限和 strategy API 的可观察语义已由测试固定。
3. provider payload、provider call 数、tool execution 数和物理存储 receipt 都有证据。
4. 无法证明的效果报告为 `unknown`，不能被转换为成功、零成本或可安全重试。
5. generation 权限拒绝不会因普通 `beforeRequest` 异常继续 dispatch。
6. 每次 Pi Durable 升级都能根据兼容性账本重新运行同一套验证。

## 1. 目标架构

### 1.1 适配层边界

新增或重写 `packages/agent/src/durable-adapter.ts`，只依赖 Pi Durable 和公开 Pi-ai 类型。`host.ts` 继续拥有 Pakka 的 principal、grant、capability、receipt 和生命周期状态机；Durable 负责持久 task/session 执行，适配层负责把两边的状态翻译成 Pakka DTO。

适配层不得向外暴露 Durable Harness、task 实例、数据库连接、Pi 私有对象或可序列化 authority token。

目标依赖方向：

```text
host.ts / strategy-control.ts
        ↓ Pakka-owned interfaces
DurableAdapter
        ↓ public Durable API
Pi Durable
        ↓ public pi-ai Models
provider
```

旧 `PiAdapter` 继续编译并进入 oracle test fixture，但不得被新 host 通过 fallback 隐式调用。

### 1.2 两个明确的控制角色

迁移期间把现有职责显式命名为：

- **Context Arbiter**：`real_context.write` 的唯一最终仲裁者。多个策略可以产生候选，但最终 request projection 只有一个 owner 决定。
- **Artifact namespace writer**：策略只能写自己持有的 `sessionId + strategyId + journalKind` namespace；不同 namespace 不互相覆盖，是否允许并行由 journal 事务决定。

Context Arbiter 不是新增多用户 ACL，也不是把 Runtime 权限按 principal 隔离。Runtime 仍是单 Profile；principal 是调用入口身份。

## 2. 功能语义任务

以下任务按语义编号。每项都必须有实现、定向测试和至少一个可复核 trace。

### F-01：依赖与构建基线

- 固定 `pi-durable`、`pi-ai` 及相关 Pi 包的 npm version、resolved URL、integrity 和上游 commit。
- 将版本 cohort 固定在 Pakka agent package 内，不能依赖 workspace root override 的偶然继承。
- 确认 Node/TypeScript 版本满足 Durable 的运行条件。
- 建立 `DurableAdapter` 的 public-only import 检查，禁止私有 subpath、内部 class 和 monkey patch。
- 为兼容性账本增加本次迁移的 `detected` 条目。

### F-02：Host 创建与资源归属

实现 `createHost(options)` 的 Durable 初始化：

- cwd、dataDir、main model、endpoint、apiKey、system prompt 和 tools 显式传入；
- main session、auxiliary model 和 artifact store 的资源归属明确；
- 初始化失败不创建一个看似 ready 的半成品 host；
- `dispose()` 可重复调用，并等待 Durable task/provider 收尾；
- 关闭 provider connection、task subscription 和文件句柄。

### F-03：会话身份与持久化

固定以下身份映射：

- Pakka `sessionId`；
- Durable conversation/session/task ID；
- provider request/session ID；
- artifact journal identity；
- host `generation`、`epoch`、`branchId`。

定义并测试：

- 新建 session；
- 重新打开 Pakka-owned Durable storage；
- 缺失、截断、损坏、foreign 或 provenance 不匹配的 storage；
- 已提交输入、未完成 task、未知 receipt 的重启处理；
- old host 的 capability、grant、lease、C2 idempotency claim 不在 reopen 后复活。

没有用户数据，所以不做旧 JSONL bulk import；如果未来出现真实存量，必须追加独立迁移设计。

### F-04：Pakka public API 映射

逐项实现并保持 `types.ts` 对外语义：

- `createHost`；
- `connect`、principal-bound closures；
- `view`、`subscribe`、`waitForIdle`；
- `reload`、`newSession`、`dispose`；
- `Client.receipt` 的 caller visibility；
- `HostEvent` 的 state/receipt 顺序；
- `View.phase`、busy、session/branch/epoch/generation、lastError、effects。

Durable 原生 DTO 不得直接泄漏到 Pakka public package。

### F-05：Grant、策略 owner 与 Context Arbiter

- `input.submit`、`branch.control`、`real_context.write`、`context_artifacts.write`、`model.infer` 继续独立授权。
- 精确的 `real_context.write` owner 是 Context Arbiter。
- 同一 hook 的重复 claim 被拒绝；失败 claim 不留下半个 owner。
- 非 owner principal 的 edit/cut 仍可在 owner policy 显式批准后提交；`grants=[]` 不是默认的全局 ceiling。
- `context_artifacts.write` 不隐式授予 projection 或 model spending。
- deactivate、reload、newSession 时明确处理 owner、lease 和 projector 的存续/失效。

### F-06：Capability、snapshot 和 ABA

Durable 的 task/source identity 不能直接替代 Pakka capability。继续实现：

- principal-bound opaque capability；
- generation、epoch、sessionId、branchId、leaf、raw entry count 的 fingerprint；
- canonical frame、artifact version、lease 和 lifecycle 变化时旧 capability 失效；
- A→B→A navigation 仍产生新的 branch identity；
- copied/serialized token 没有 authority；
- 所有 awaited policy/provider/storage 操作后重新校验 authority。

### F-07：输入 admission 与幂等

保留 Pakka 的 receipt 状态机：

```text
reserved -> handled
reserved -> queued -> consumed -> committed
reserved -> released
reserved/queued/consumed -> unknown
```

实现并测试：

- ledger key：principal + sessionId + branchId + caller key；
- 相同 key、相同 payload 返回旧 receipt，不产生第二次执行；
- 相同 key、不同 text/mode 报 idempotency conflict；
- 只有 `released` 可在同一 scope 用相同 payload 重试；
- `submit` 已接收但 generation 失败时，input receipt 与 generation result 分开；
- Durable submission idempotency 不能替代 Pakka payload conflict 检查；同 ID 不同 payload 的行为必须由 Pakka 明确控制。

### F-08：输入预处理与三种输入模式

- `prepareInput` 的 `handled`、`text`、异常和空文本语义保持不变；
- prompt、steer、followUp 分别映射到 Durable 的对应调度能力；
- prompt 只能在 idle 时开始；steer/followUp 只能在 active run 时进入队列；
- generation/lifecycle 变化期间完成的旧 preparation 不能转移到新 scope；
- 输入文本不携带 identity、permit 或隐藏 authority。

### F-09：主 generation 与 provider request

- 只使用公开 Pi-ai Models/provider 入口；
- request context 由 Durable 当前 source 生成，Pakka projection 在正确的 request boundary 应用；
- model、system prompt、tools、thinking level、max tokens 和 session identity 可在 wire trace 中核对；
- 禁止隐式 transport/model retry；
- provider failure、timeout、abort 和 unknown delivery 的 task/receipt 终态分别定义。

### F-10：Generation `beforeRequest` fail-closed 门禁

这是迁移阻断任务，不允许用普通 throw 假装完成。

首选方案是为 Pi Durable 增加正式的 typed result：

```ts
// proposed upstream API
export type BeforeRequestResult =
	| undefined
	| { readonly messages: readonly Message[] }
	| { readonly block: string };
```

`{ block }` 必须保证：

```text
input submission -> committed（若输入已经接收）
generation -> blocked
providerCalls -> 0
稳定 reason/receipt 被持久记录
host 不因正常拒绝进入 failed
```

要求：

- 在 Durable 自己的 task、重试、恢复和 receipt 测试中证明；
- Pakka 锁定已验证的上游 commit；
- 在 API 尚未具备前，不能把 `beforeRequest` throw 作为安全门禁。

`PolicyModels` / `ModelGateway` 可以作为过渡适配器，但必须覆盖全部实际模型入口，并明确其拒绝是 task failure 还是 native blocked。不能用全局 permit、无效 model、空消息或私有 scheduler hack。

### F-11：Context projection 与消息完整性

迁移 `real_context.write` 的完整语义：

- canonical context 与 Durable source snapshot 对齐；
- content-only message patch；
- summary range replacement；
- `summary: null` 表示完整省略，不生成占位文本；
- system、host-summary、checkpoint 和 excluded entry 保护；
- source range 必须连续且不能切断 native call/result 对；
- copied/stale basis、malformed plan、wrong owner 在 provider 前拒绝；
- projector 只能改 request-local clone，不能修改 canonical history；
- inference-derived replacement 必须绑定 job scope；
- reload 后 projector 可按 lease idempotently reinstall，但旧 basis/job 不复活。

### F-12：Tool call、tool result 与副作用

- provider 生成 tool call 后，Durable task 与 Pakka trace 中的 tool call identity 一致；
- projector 可以缩短 tool result 的显示内容，但不能改已有 tool call 的 id、name、arguments 或目标；
- 非法参数改写必须在 HTTP 前阻止，不得重跑工具；
- 合法工具只执行一次；provider retry、task retry 和恢复不得重复产生不可逆副作用；
- tool callback 获得 run-bound invocation scope；旧 invocation 不能在 await 后获得新 session 权限；
- tool error、cancel、timeout 和 late completion 的存储/receipt 状态明确。

### F-13：辅助模型 inference

保留 `model.infer` 与主 transcript 分离：

- allowlisted model key；
- 每 strategy/session 总预算；
- 每 job 调用上限；
- max output tokens 取 model、host policy、caller cap 的最小值；
- 每次尝试先占用 durable budget slot；失败和 unknown 也消耗预算；
- 无隐式 retry/fallback；
- `usageStatus=unknown` 不等价于零成本；`usage.cost=null` 表示未定价；
- auxiliary messages/results 不进入主 C2 transcript、不产生主 input receipt。

验收可使用 `Mapleluv-ChatCompletions/deepseek-flash:high` 做 live provider smoke；不把额度或并发优化列为本迁移的性能任务，但仍必须验证语义上的并发和取消。

### F-14：Source job、快照和迟到结果

- job 保存精确 target/previous-context fingerprint，不保存可静默刷新的完整 frame；
- 无关尾部增长可继续；source edit、navigation、ABA、reload、newSession、deactivation、lease 变化和 cancellation 使 job 失效；
- 失效的旧 completion quarantine，不发布 artifact，不沿旧 scope 重试；
- provider 没有 HTTP 发生不代表之前的 input/admission 没有持久副作用；receipt 必须分别记录。

### F-15：Artifact journal 与 namespace

迁移分两步完成：

1. **兼容基线**：保留现有单 writer 语义、版本冲突、hash chain、fsync、物理 readback、ownership marker 和 unknown receipt。
2. **namespace 改进**：把写权限从全局 hook claim 改为 namespace claim：

```text
(sessionId, strategyId, journalKind) -> one writer
```

必须保证：

- 不同 strategy/namespace 可独立写入；
- 同 namespace 仍排他；
- 版本/hash-chain 不跨 namespace 混写；
- read、append、adoption 检查正确 strategy、principal、lease、job scope；
- partial/missing/changed storage latches 当前 host failed；
- unknown receipt 不触发隐式 retry；
- Context Arbiter 的最终 projection ownership 不因 artifact namespace 增加而被绕过。

### F-16：Inference artifact adoption

- `requireArtifactReceipt` 的 job 必须把精确 attempt IDs 绑定到物理 artifact transaction；
- 未完成、foreign、已采用、伪造或不存在的 attempt 被拒绝且无副作用；
- physical receipt 后建立 adoption record；
- reopen 要检查所有历史 adoption transaction；
- 后续普通 append 不能破坏之前 adoption；
- incomplete/unknown storage 不允许恢复旧推理结果并再次 dispatch。

### F-17：Edit、cut、branch 与策略授权

- edit/cut 的 proposal 校验、target branch 和 native entry 类型保持一致；
- owner 直接批准，非 owner 经 owner policy 批准；
- policy await 后重新检查 capability、phase、idle、owner 和 branch；
- edit 的 intent/context_edit 两次物理 append 不伪装成 atomic transaction；部分失败返回 `unknown` 并使 host failed；
- cut 的 authorship、summary、first kept entry 和 token metadata 可恢复；
- branch 生成新的 branch identity 并使旧 frame/job 失效；
- fork 不允许未经验证地等同于 Durable 的 fork API。

### F-18：Lifecycle、取消与失败恢复

- reload：复用当前 session，失效旧 operation basis/job，但保留明确仍有效的 host strategy/projector 配置；
- newSession：创建全新 session/generation，旧 session late fault 不污染新 session；
- dispose：abort、idle、subscription 和 resources 清理；
- transition 并发请求被拒绝；
- queued input 的选择性取消不影响其他 principal 的队列对象和 mode；
- sent provider call 的 abort 是 best effort，不报告为零成本；
- storage failure 后 reload 不把 failed host 伪装成 ready，只有 explicit newSession 可恢复新 scope；
- unresolved effects 统一报告 `unknown`。

### F-19：观察、审计与诊断

每个测试场景至少保存以下四类证据：

```text
1. Pakka public events / receipts
2. Durable submission/task state
3. pi-ai provider request/response payload
4. physical session/artifact storage readback
```

消息 JSON 与宿主事件分开记录。不能用模型最终文本推断 provider 是否调用、工具是否执行或输入是否落盘。

错误必须带有 scope：session、generation、task、attempt、strategy、namespace；旧 session 的 late error 不得覆盖新 session 的 lastError。

### F-20：默认路径切换与旧适配器退场

- `createHost` 默认构造 DurableAdapter；
- old `PiAdapter` 从 production import graph 中移除或隔离到 test-only oracle；
- 不保留静默 fallback；
- package consumer smoke 从干净安装验证，不依赖 workspace override；
- README/architecture/compatibility ledger 中的 backend 描述同步更新；
- 迁移完成后，旧 adapter 只有在继续提供差分价值时才保留，否则另开清理提交删除。

## 3. 执行阶段与提交顺序

### M0：冻结基线

交付：

- Durable 版本、commit、lockfile integrity；
- 旧 adapter 全量测试结果；
- provider trace schema；
- `PI-DURABLE-COMPATIBILITY.md` 的 `detected` 条目；
- 明确所有已知差异和未实现边界。

禁止在 M0 后修改旧测试来消除差异。

### M1：引入 Durable runtime skeleton

交付：

- Durable 依赖和版本 cohort；
- `DurableAdapter` 创建、dispose、view、waitForIdle；
- 新 host 默认走 Durable；
- 空 session、新输入、普通 text response、基础 storage reopen；
- 旧 adapter 仍可由 oracle fixture 启动。

通过后：`F-01`、`F-02`、`F-03`、`F-04` 基础项完成。

### M2：主输入、receipt、工具与 lifecycle

交付：

- F-07、F-08、F-09、F-12、F-18；
- prompt/steer/followUp、幂等、取消、provider error、tool call 和 recovery；
- normal path 与 oracle 的差分 trace。

未通过 provider payload 或物理 receipt 检查，不进入 strategy migration。

### M3：策略与 Context Arbiter

交付：

- F-05、F-06、F-11、F-17；
- projector、basis、source fingerprint、edit/cut/branch；
- 明确 single Profile 的 Context Arbiter 语义；
- 非 owner policy delegation 的差分测试。

### M4：模型、任务与 artifacts

交付：

- F-13、F-14、F-15、F-16；
- inference budget、job quarantine、artifact adoption；
- 先兼容基线，再启用 namespace writer；
- 两策略不同 namespace 并行写入和同 namespace 冲突测试。

### M5：generation gate 上游变更

交付：

- Durable 原生 `{ block }` API 或等价正式上游契约；
- `providerCalls = 0` 的真实 provider 证据；
- blocked receipt、重试、恢复和输入已提交但 generation 被拒绝的测试；
- 兼容性账本 `patched`、`verified` 条目。

没有 M5 证据，不得宣称权限迁移完成。

### M6：默认路径验收与清理

交付：

- F-19、F-20；
- 干净安装 smoke；
- 全量测试、静态检查、格式检查；
- 旧 adapter oracle 的最终差异清单；
- 默认路径启动、持久化 reopen、失败恢复和升级复测报告。

## 4. 验收层任务

### A-01：静态与边界验收

检查：

- `rg` 无 Durable 私有 import、私有字段访问、monkey patch 和未解释的 `any`；
- public package 不导出 Durable/Pi runtime 实例；
- `npm run check`；
- `npm run build`；
- `npm run format:check`；
- `npm test`；
- 干净 package install/consumer smoke。

### A-02：Host/API 验收

逐项调用 public API，检查 DTO 冻结、principal isolation、receipt visibility、event order 和 phase：

- connect 重复 principal/空 principal；
- grants 缺失时每个操作拒绝；
- view/subscribe/waitForIdle；
- reload/newSession/dispose 重复和并发调用；
- failed host 的 reload 与 explicit newSession；
- old capability、old binding、old job 和 old tool invocation。

### A-03：输入与调度矩阵

至少运行：

| 场景                      | 期望证据                                                     |
| ------------------------- | ------------------------------------------------------------ |
| 首次 prompt               | 一次 submission、一次 provider request、一次 committed input |
| 相同 key/相同 payload     | 原 receipt、providerCalls 不增加                             |
| 相同 key/不同 payload     | conflict、providerCalls 不增加                               |
| steer/followUp            | 正确 native queue mode、正确 drain 顺序                      |
| cancel queued             | selected receipt released，其他队列保持不变                  |
| prepareInput handled      | handled、没有 provider request                               |
| preparation 跨 newSession | old input released，new session 可立即接收输入               |
| provider 503              | 一次 request、无隐式 retry、终态明确                         |
| provider/存储效果不确定   | unknown，不自动 replay                                       |

### A-04：消息与 projection 验收

用带 system、user、assistant、toolCall、toolResult、checkpoint、excluded entry、bash execution 和 context edit 的真实 session：

- 比较 canonical raw storage 和 request-local payload；
- patch 只改变允许的 content/display fields；
- tool call identity、arguments、call/result association 不变；
- summary range contiguous，`null` omission 不生成占位；
- stale/copy basis、wrong owner、system boundary、half tool pair 全部在 HTTP 前拒绝；
- projector 不改变 raw durable history。

### A-05：权限与 Context Arbiter 验收

- 一个 strategy 独占 `real_context.write`；第二个 claim 无部分状态；
- 多 principal 下，owner 直接 commit 成功；非 owner 无 grant 但 policy 批准时 edit/cut 成功；policy 拒绝/抛错时 denied 且无 append；
- artifact grant 不得调用 projection 或 inference；
- 多个候选 projector 只能由 Arbiter 形成最终 request；
- reload/newSession 后 lease、policy、projector 的保留/失效符合规定；
- deactivation 后 old binding/projector/job 不能继续写入。

### A-06：Generation gate 验收

这是硬门槛。用一个 projector 改写既有 toolCall argument：

```text
beforeRequest -> block
input receipt -> committed（若已接收）
generation -> blocked
providerCalls -> 0
new tool executions -> 0
host -> ready
```

同时运行对照：

```text
普通允许 projection -> providerCalls = 1
beforeTool block -> tool execution = 0
provider failure -> 不把 failure 伪装为 authorization denied
```

任何 `beforeRequest throw -> report -> dispatch` 结果都使 A-06 失败。

### A-07：Tool side-effect 验收

- provider 返回一次 tool call，工具执行一次；
- tool 挂起期间 storage 损坏，最终 receipt 为 unknown/failed，不能声称成功；
- abort/reload/newSession 后 late tool completion 不得操作新 session；
- old invocation 缺少正确 scope 时拒绝；
- tool result 显示压缩不改变 canonical execution record；
- provider retry、Durable retry 和业务 retry 的副作用边界可观察。

### A-08：Inference/job/artifact 验收

- 64/128 token 等请求在 provider wire 上保持实际 cap；
- max job calls 和 strategy/session calls 分别耗尽；
- failed、unknown、cancelled attempt 是否占预算可验证；
- source tail 增长允许，source edit/navigation/ABA/reload/newSession quarantine；
- late result 不发布 artifact、不触发新 HTTP；
- adoption receipt 精确绑定 attempt 和 transaction；
- 两个 namespace 并行 append 成功；同一 namespace version conflict；
- missing/partial/changed journal 使 host failed；reopen 先验证所有 adoption。

### A-09：持久化与故障注入验收

对 session、Durable task state、artifact journal 和 ownership marker 分别注入：

- missing；
- truncated；
- malformed JSON/record；
- hash/version mismatch；
- rename/replace race；
- fsync/readback 不一致；
- provider response 已发送但本地 receipt 未确认；
- task 已持久化但进程在 completion 前退出。

每个场景必须回答：

```text
是否有 provider side effect？
是否有 tool side effect？
input receipt 是什么？
task receipt 是什么？
artifact 是否可重放？
host 是 ready、failed 还是新 session 可恢复？
是否允许 retry？
```

### A-10：Lifecycle、fork、compaction 验收

- reload 保留 session identity 但使旧 operation basis/job 失效；
- newSession 新建 identity，旧 late error 不污染新 host；
- branch A→B→A 的 branchId 不复用；
- Durable fork 与 Pakka branch 不一致时明确拒绝或转换，不静默等同；
- compaction 的 source、summary、first kept entry、tool pair 和 authorship 可恢复；
- auto compaction 按 Pakka 的显式配置开启/关闭，不能由 Durable 默认值偷偷改变；
- old summary job 在 source change 后 quarantine。

### A-11：差分验收

旧 `AgentSession` adapter 作为 oracle，对同一脚本运行 Durable adapter。比较：

- public event sequence；
- receipts 和终态；
- provider payload canonicalized 后的 messages/tools/model/options；
- tool executions；
- raw entry identity/parentage；
- artifact records/version/hash chain；
- lifecycle state。

允许的差异必须逐项登记：例如 Durable task ID、内部 storage layout、provider timestamp。未登记的差异视为失败。

差分不要求模型自然语言完全一致；必须比较 wire、state 和 side effect。

### A-12：升级回归验收

每次 Pi Durable 更新执行：

```powershell
npm ls @earendil-works/pi-durable @earendil-works/pi-ai --all
npm run check
npm run build
npm test
npm run format:check
```

然后重新运行 A-03、A-04、A-06、A-07、A-08、A-09 和 A-11。若 package version、resolved、integrity、上游 commit 或上述语义任一改变，先在兼容性账本追加 `detected`，不能先改适配器再补记录。

## 5. 放行门槛

### Gate 0：可编译

- 依赖和 lockfile 固定；
- public-only import；
- `npm run check`、`npm run build` 通过。

### Gate 1：可运行

- M1/M2 完成；
- A-02、A-03、A-07 基础项通过；
- provider trace 和物理 session readback 可取得。

### Gate 2：契约等价

- M3/M4 完成；
- A-04、A-05、A-08、A-09、A-10 通过；
- 所有差异已记录并有理由。

### Gate 3：安全语义

- M5 完成；
- A-06 全部通过；
- generation block 有稳定 receipt/终态；
- providerCalls 为 0 的阻断证据不是通过注入未使用的模型路径取得的。

### Gate 4：默认路径

- M6 完成；
- `createHost` 默认只启动 DurableAdapter；
- 无生产 fallback；
- 干净安装 smoke 和升级回归通过；
- 兼容性账本条目为 `verified`。

## 6. 交付物

最终提交至少包含：

1. `DurableAdapter` 及其 public boundary；
2. Durable 版本、commit、lockfile integrity 记录；
3. Context Arbiter 实现和测试；
4. artifact namespace writer、journal transaction 和测试；
5. generation block 的上游变更/固定 commit 及 Pakka 集成；
6. 主路径、tool、inference、lifecycle、recovery 测试；
7. deterministic faux-provider traces；
8. live provider smoke traces，可使用 `Mapleluv-ChatCompletions/deepseek-flash:high`；
9. 旧 adapter oracle 的差异报告；
10. 更新后的 architecture、strategy API 和 compatibility ledger；
11. 干净安装 package consumer smoke 结果。

## 7. 给执行者的嘱托

1. **先读契约，再读实现。** 先读本计划、`ARCHITECTURE.md`、`STRATEGY-API.md` 和兼容性账本，再开始改代码。文档没有证据的地方，先写实验，不要凭 Durable 类型名推断语义。
2. **不要把异常当成权限拒绝。** `beforeRequest` 抛错在已审计 Durable 版本中可能 report 后继续 dispatch；没有 `providerCalls = 0` 证据，就不能称为 fail-closed。
3. **不要修改旧测试来制造等价。** 旧 adapter 是 oracle，不是必须被 Durable 模仿的实现细节；差异要分类、记录、决定，而不是删掉断言。
4. **不要只看模型回答。** 每个重要结论同时检查 Pakka receipt、Durable task 状态、pi-ai wire payload、工具执行记录和物理存储。模型说“没有执行”不是证据。
5. **未知效果就是 unknown。** provider 已发送、storage readback 失败、tool 已可能执行的场景，不能报告成功，也不能为了方便自动 retry。
6. **不使用私有 API 或临时全局状态。** 禁止 private import、monkey patch、伪造 model、空消息绕门禁、全局 permit、复制 Durable scheduler。需要新 task 终态就做正式上游变更，并锁定 commit。
7. **保持单 Profile 假设。** 不要因为 principal 存在就引入多租户 confidentiality ACL；权限问题按 Runtime Profile、Context Arbiter、委托 policy 和明确 grant 解释。
8. **先保留旧语义，再启用改进。** Context Arbiter 可以在迁移时显式化；artifact namespace 可以先兼容旧单 writer，再独立打开多 namespace。不要把两个变化混成一个无法定位的重构。
9. **每次升级先记账。** 先记录 Durable 版本/commit/integrity 和旧基线，再升级或改 adapter。兼容性文档 append-only，旧条目不得被静默覆盖。
10. **每个提交只解决一类语义。** 依赖切换、host lifecycle、input admission、projection、artifact、permission gate 和文档更新尽量拆开，确保失败时可以定位到具体契约。
11. **不要优化不存在的成本问题。** 当前不需要围绕额度、并发或用户迁移成本设计复杂降级；但“允许高并发”不等于可以跳过 race、取消和 authority recheck 测试。
12. **完成前要能回答五个问题：** 哪个请求发出去了？哪个工具执行了？什么数据已经落盘？哪个 receipt 可以重试？哪个权限检查真正阻止了 provider？如果不能回答，任务仍未完成。
