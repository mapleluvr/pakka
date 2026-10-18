# kappa-dynamite → Pakka 迁移方案

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [当前产品状态](../../PAKKA-POCKET-STATUS.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

## 0. 调查范围与结论

调查基线：`mapleluvr/kappa-dynamite` main **028d48e97651c11954503caf2275d580edb379de**（2026-09-25），对照当前 Pakka v0.1 和实际安装的 Pi 1.0.3 发布包。

**建议保留为独立默认策略包 `@pakka/dynamite`，不要搬进 agent 内核，也不要直接加载旧 Pi/Kappa extension 入口。**

这补全了此前仅看 Kappa monorepo 时遗漏的产品实现面。Pakka v0.1 的 owner/cut/edit/队列机制并没有替代 Dynamite：后者真正实现了请求投影、reduce、异步摘要、侧车存储和计费归因。迁移不是换 import，也不是把所有 flush 改成 commitCut。

本轮只做源码调查、原测试复跑和兼容性小实验，未迁移生产代码、启用真实模型、改写用户历史或发布包。

## 1. 关键语义：Dynamite 不是 cut 策略

正常链路：

```text
完整宿主历史 + Dynamite records
             ↓
窗口 / protected tail / reduce / trigger
             ↓
请求投影：标号、摘要替换、原文清空、已 reduce 摘要移除
             ↓
本次模型请求
```

- 原始 JSONL 不裁剪；正常路径不调用 commitCut，也不写宿主 compaction entry。
- 异步生成的 block 先作为候选落盘，只有后续 trigger 才提交进入请求。
- block 正文与 run/reduce/cursor 写在独立 sidecar，以 `atHostEntryId` 绑定宿主祖先链。
- `ctx_reduce` 与用户命令共用 reduce 队列；排队不代表已从请求消失。
- `/compact` 是 deprecated no-op。
- 现有 `branch_summary` / `compaction` 是不透明边界，不编号、压缩或 reduce。

证据：`src/index.ts:313–449`、`runtime.ts:onContext/commitTrigger`、`projection.ts:project`、`store.ts:foldRecords`、`docs/ctx-runtime-model.md`。

把这些行为替换成 Pakka 现有 cut，会改变可见源条目、侧车锚点、窗口及恢复语义；改成逐条 context_edit 也会改变持久化与触发时序。保留这些 primitive 供其他策略使用，但不是 Dynamite 的正常实现通道。

## 2. 目标包关系

```text
产品 composition root（例如 apps/pakka，未来）
    ├── @pakka/agent       通用身份 / 权限 / 生命周期 / Pi adapter
    └── @pakka/dynamite    默认策略实现，经宿主端口工作

未来 @pakka/tui → 命令与只读视图；不读取 Pi 对象或自行写策略文件
```

agent 不反向 import dynamite，避免产品策略与内核形成依赖环。dynamite 只依赖 Pakka 的插件契约类型/端口；Pi SDK、凭据、原生 session 仍留在 agent 内部。

默认加载是产品 bootstrap 的显式选择，而不是重新打开 Pi 的扩展发现。当前 Pakka 的 `noExtensions` 等限制应保留。已有用户选择的其他策略时，不再偷偷启动第二个 projector。

建议保留逻辑策略 ID `default-context-strategy`，由 bootstrap 绑定实现与 principal；不再用可变 extension path 当授权身份。默认包没有权限豁免，必须获得两个 hook 的 lease。

## 3. 文件迁移矩阵

| 原模块                                                                  | 处理                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `tags.ts`, `protected-tail.ts`, `queue.ts`, `window.ts`, `tokenizer.ts` | 保留算法及测试；针对新的规范化 DTO 跑兼容回归                                                                                   |
| `entries.ts`, `projection.ts`                                           | 保留 step、标记、保留 tool-call 结构、最长前缀等规则；改用宿主给出的 provenance，并保护 Pi 1.0.3 system/tool 状态边界           |
| `accounting.ts`                                                         | 保留计算及 estimator seam，但补 request/projection/model 版本配对；差分归因不能称为精确单条计费                                 |
| `store.ts`                                                              | 保留 record schema、codec、fold、block 编号规则；拆出 FS，写入走有权限与版本约束的 artifact port                                |
| `snapshot.ts`                                                           | 从宿主一次性 frame + artifact snapshot 构造，不再同时读多个 getter 和直接读文件                                                 |
| `runtime.ts`                                                            | 保留触发和状态机；拆分 planning、artifact commit、request projection、background completion，移除自行写盘和无宿主监管的后台任务 |
| `compressor.ts`                                                         | 保留窗口输入、结果形状和结构校验；由受控 inference service 执行调用并记录费用/失败不确定性                                      |
| `summarizer.ts`                                                         | 保留 Summarizer seam；旧 getAuth/compact 注入方式换为不暴露凭据的宿主调用端口                                                   |
| `config.ts`                                                             | 保留默认值、校验和规范化；IO/变更授权由宿主管理，并提升配置版本                                                                 |
| `claim.ts`                                                              | 重写为 Pakka 策略注册/lease，不保留可选 ownership 和失败后继续投影                                                              |
| `tool.ts`                                                               | 保留 schema、文案与目标解析；执行转给当前策略服务，绑定 tool-call 的 session/generation/request/principal                       |
| `panel.ts`                                                              | 保留 rows 与 applyPanelChange 等纯逻辑，渲染以后由 Pakka TUI 接管                                                               |
| `index.ts`, `host-modules.d.ts`                                         | 替换旧接线；删除 Kappa aliases/宽泛 ambient 声明与 as-never 假兼容；真正对 Pakka 契约编译                                       |
| package metadata                                                        | 不依赖 kappa.extensions/pi.extensions 自动发现；构建正常 ESM 包与明确入口                                                       |

“没有 Pi import”不等于“纯函数或已有权限隔离”：runtime/snapshot/store/config 目前仍直接拥有 IO 或生命周期行为，因此不能只重写 index.ts。

## 4. Pakka 必须补的宿主端口

以下是设计目标，不是当前已有 API。

### A. Provenance 完整的只读 ContextFrame

v0.1 View 只有 id/type/role/text，缺少 parentId、完整 content、toolCallId、usage、系统/工具声明、模型参数；无法支持真实 Dynamite。

需要一个同一时刻生成的冻结 frame，包含：

- session identity、generation、branch/navigation revision、owner lease、request/projection/config/artifact 版本；
- raw entries 的结构与稳定来源 ID（用于祖先链、编号、原始计费等）；
- `buildSessionProjection().entries` 的 sourceEntry → effective messages 对应（用于实际工作上下文）；
- 当前请求中系统状态、边界、临时消息的来源说明；
- 主请求实际 usage、对应 request/model/projection 标识，以及合法模型的 contextWindow 等元数据。

不能从现有 View.text 重建 content，也不能把 raw entry 的消息当成 context_edit 后的有效消息。system 状态不占原文编号；历史已分配的编号不能因新增元数据条目而漂移。

### B. 受控 request projection

新增独立请求边界入口，而不是调用 idle-only 的 Client.commit：请求装配本来就发生在 busy run 中。

建议流程：

```text
Pi canonical projection
 → adapter 构造不可变 frame
 → 激活策略提出 ProjectionPlan
 → host 校验 owner lease / frame / artifacts / source targets / 结构
 → host 应用到本次请求并记录 projection receipt
 → provider
```

Plan 应显式表达标签、文本清空、源范围→summary artifact 替换等操作，保留来源关系；不直接允许插件持有或改写 Pi 对象。

必须保护：

- 所有 system/tool 声明与 checkpoint，不只是第一条 system；中途声明变化也是受保护边界；
- tool-call/result 配对及顺序，不能靠删掉一条 assistant 留下孤立 result；
- 外来 branch/compaction 边界、未纳入快照的在途尾部；
- 请求入参及原始存储不被别名修改。

SDK 接点需在 adapter 内使用公开的 request/context callback 机制，并保留 Pi 已安装的 canonical/loadout/forced-prompt pipeline。不改私有方法，不把普通 extension runner 当权限闸。

**特别注意 fail-closed：**Pi 1.0.3 的 ExtensionRunner.emitContext 会捕获 handler 异常并继续。因此“在普通 context handler 中 throw”本身不保证请求被阻止。接线验收必须观察未授权/错配/写盘失败时 HTTP request count 为零，而不能只断言有错误日志。最终控制性失败必须传播到可阻断本次调用的宿主边界。

策略完成一次投影后，还要防止后续 hook 再改写；Pakka 不开放任意 native context_with_system / before_provider_request handler。

### C. Artifact store 与发布事务

`context_artifacts.write` 目前只是占用名，没有真正的写门禁。需要带身份/lease/scope/version 的命名空间存储，范围限定于该策略及目标 session。

- run/block/reduce/cursor 的策略写入全部走端口，不把 dataDir 任意写权限当 capability。
- 生成候选需要 artifacts 权；将候选/reduce 发布为实际投影还需要 real_context 权。
- reduce apply + cursor 应作为一笔可恢复的逻辑批次，附 transaction/revision/receipt，而非假设一次 appendFileSync 等于原子事务。
- 校验计划后才能发布 active artifact revision；磁盘不确定时不可假装已成功应用，也不可默默恢复全量原文。
- 不沿用“任意坏行静默跳过”的写后恢复判断：区分可恢复尾部截断、内部损坏和未知 schema，并给出明确结果。
- 已撤权任务的费用由宿主 audit 服务记账；不能为了记录费用恢复旧策略的写权限。

宿主不必理解 Dynamite 全部 record 语义，但要拥有持久化边界、来源记录和授权；策略继续负责算法与可重放数据解释。

### D. Scoped background inference

`autoCompress` 当前是在 onContext 内 void-start，一个运行时内部 Set 负责并发。迁移后应由宿主管理 job、取消、超时、模型 allowlist、预算及实际 attempt 次数。

可复用公开 Pi `compact()` / `generateSummaryWithUsage()` 作为**生成摘要的计算 helper**，但不能调用主 AgentSession.compact()。摘要返回候选产物，不直接切主会话。

plugin 不能拿 modelRegistry、auth headers/env/apiKey 或一个绕过预算的 raw compact 函数。宿主解析模型/凭据并调用 provider，返回结构化结果与 usage receipt。1.0.3 compact 还有可选 retry/callbacks/sessionId 参数，不能把原来的外层 3 次尝试误认为总共 3 次 HTTP 请求。

**两种版本契约必须区分：**

- 当前请求的 ProjectionPlan：严格匹配 frame/request/artifact revision。
- 异步摘要候选：主对话正常追加尾部时仍可完成，不能要求“等于开始时的全局 epoch/leaf”。应检查 session、generation、owner lease、branch navigation、源条目有效性及内容版本；允许不相关尾部增长。

branch A→B→A、reload、newSession、owner deactivate/reactivate 必须使旧 job 无效；即使所有源 ID 又出现也不能自动恢复旧 authority。旧 job 的 late result 只能成为 superseded/audit 结果。

原实现只检查 sourcesStillUsable，而且读失败返回 true；没有 owner/generation/navigation lease。它不满足这个新契约。失败但拿不到 usage 的调用也不应被当成“确认花费为零”。

### E. Commands / tools / status

当前 Pakka 拒绝 slash 输入、无命令 registry，tool execute 只提供 args/signal 并返回字符串；不能直接注册旧命令或依赖第五个 Pi ctx 参数。

增加：

- typed `reduce` / `flush` / `info` / `configure` 操作；未来 CLI 的 slash 与 TUI/RPC 只是传输层；
- 带请求身份、generation 和工具调用 scope 的工具执行 envelope；过期调用不能向新会话排 reduce；
- structured tool result/error 与只读 status DTO；
- model/user source、requesting principal、执行策略分别归因，不能让模型参数自行声明身份；
- `/ctx-info otherSession` 通过受限 session/artifact 读取，不默认扫所有项目文件。

配置修改是用户/宿主控制操作，不是 ctx_reduce 工具获得的附带能力。

## 5. 必须改变的旧兼容行为

1. `index.ts` 中 claim 失败后仍 projection：改为不启动 projector/不写 artifacts/不发起摘要。若产品已选择其他策略就交给它；不能双写。
2. ownership API 缺失时继续运行：Pakka 包启动时校验契约版本，缺能力就明确 unsupported。
3. projection 错配或异常后默认原请求直通：活动策略的控制失败应阻断请求；用户显式禁用策略可另行定义 identity projection，不能混为一谈。
4. `sourcesStillUsable` catch→true：改为不确定候选不可发布，费用/结果隔离保留。
5. active writer 的控制不要扩散到整个 default package：默认身份同样需要 grants，模型调用同样受预算控制。

## 6. 已运行的证据

### 原仓库测试

在未修改的上述 commit 上运行 npm test：**157/157 通过**。日志：`artifacts/dynamite-upstream-tests.log`。这些是 host-free 测试，不加载原 index.ts，不证明 aliases、UI 或宿主集成可用。

### Pi 1.0.3 兼容性小实验

程序：`artifacts/dynamite-analysis/compat-probes.mjs`；结果：同目录 `compat-probes.json`。

使用实际发布包的 SessionManager 与未修改的 Dynamite project 函数，没有真实模型调用：

| 条件                                                             | 旧映射        | provenance 映射对照             |
| ---------------------------------------------------------------- | ------------- | ------------------------------- |
| 无 system、无 edit 的基线                                        | aligned=true  | —                               |
| history 含 system，模拟 Pi context hook 的无-system输入          | aligned=false | aligned=true                    |
| 已 appendContextEdit，实际请求含 EDITED，raw entry 仍是 ORIGINAL | aligned=false | aligned=true，输出不含 ORIGINAL |

旧 `viewFrom()` 使用 buildContextEntries + sessionEntryToContextMessages，而 1.0.3 的有效贡献在 buildSessionProjection.entries 中。只换 import 保留旧 view 就会触发 Dynamite 的“错配→不投影”。

对照程序的 non-system 过滤只是对齐证明，**不是完整 system/checkpoint 恢复实现**，不代表已经有可安装的 adapter。

### 计费归因的合成对照

构造账面 prompt 1000→1100，其中中间投影移除 400、新增 500。当前 accounting 报 newWork=100，phaseResets=0。

这是确定性算术例，不是真实 provider 计费测试。它说明仅靠“prompt 下降”无法检测所有投影版本改变；应记录版本边界并把无法精确分解的量标为估计/未归因。账单总量是观测值，组内分摊与队列释放量仍是推导值，不应宣称逐条精确测量。

## 7. 实施顺序及验收

### M0：抽出策略包，锁定行为基线

保留原 157 项用例作为基线，移植纯逻辑；IO 与 host wiring 先通过 typed ports 隔离。保持 autoCompress=false，保留现有可选行为默认值，不顺手改变算法。

默认参数：65%（clamp 80%）、reduce 队列 30000 tokens、protected tail 10 steps 或 20000 tokens（steps≥2）、压缩窗口 20000–60000 tokens；超大单 step 的例外要显式测试。

### M1：先完成手动闭环

补 ContextFrame、request projection、artifact store、受控 reduce/flush/info 与最小工具 scope。新建真实 Pi 会话：编号→排队→flush→下一次 HTTP 请求改变；JSONL 原消息不变，不新增 host compaction。

负例：非 owner/仅 artifact owner、丢 system、跨工具边界、context_edit 错配、错 session、artifact 写盘失败。断言原文不会静默重新发送，禁止路径没有额外 HTTP/文件副作用。回归 Pakka 原 C2 drain/cancel/steer 行为。

### M2：后台摘要与费用闭环

接 scoped inference 与 job manager。真实本地 HTTP 生成摘要，先候选不生效，下次 trigger 才生效；摘要请求不能写入主输入 admission ledger 或触发递归压缩。

用可控 deferred provider 验证：正常尾部增长可以接收候选；A→B→A、reload、owner 替换、session 替换、源内容被 edit 后拒绝旧候选；计费仍被记录。验证 timeout/retry 总预算和 late completion。

### M3：恢复与既有数据迁移

Pakka 目前没有 existing-session open/resume。先补这个能力再迁移宿主 JSONL + Dynamite sidecar 成对数据；只迁 sidecar 不能恢复条目锚点。

导入保留 sessionId、entryId、parentId、历史 blockId、已有编号语义和 schema provenance。新 blockId 从所有历史分支的最高号继续。备份源文件，输出 import report，不覆盖 ~/.kappa 配置/凭据，不无提示重命名或重写旧存储。

验证分支切换、重启重放、截断日志、重复导入、无效 source 与 usage/projection 配对；恢复前可以在新建会话中试用，但不能宣称旧会话无损迁移。

### M4：产品默认装配与 UI

在 composition root 显式装配 Dynamite，并允许替换/禁用；默认包抢占失败不能继续工作。TUI 复用 panel 行逻辑，通过 typed config 操作写配置。外部 tarball consumer 安装 agent + dynamite，验证类型、exports、精确 Pi cohort 及 HTTP 闭环。

## 8. 不应包装成“迁移已完成”的已有缺口

原仓库自己已注明：独立 P1 内容质量校验、P2/P3/P4 导航产物、B_previous_recent、同一步中多 tool result 的精细归因都未完成；当前 verifySummary 只检查非空与至少 80 字符。

还有“前缀已因外来 cut 失效，但仍继续为后续无法应用的窗口付费”的已知缺口。迁移时应增加暂停/说明原因的闸，不能仅搬过来后声称后台预算已受控。

建议优先完成 M1，再做 M2；不要先移植 TUI，也不要以重新启用原生 Pi extension API 换取表面兼容。
