# Compresser 会话修复与封存

2026-10-23，用户在真实重试观察之后要求保留 Compresser 轨迹，分别设置工具调用错误与其他未解决错误的容忍次数；任一累计达到上限即封存并报告最后一次原因。3 和 4 是用户示例及本轮实验值，尚未发布为公共 API 默认值。用户明确要求优先考察 Pakka／pi-durable；发现基础设施难点时先报告，再考虑自建 loop。

用户随后澄清容器和基数：Pakka-dynamite 维护一个长期存在的 pi-durable Session，称 Compresser Session；其中的多个 Compresser Conversation 为容器外的业务 Session／Conversation 提供压缩服务。一个外部 Conversation 可以触发多个独立的压缩 Conversation，绑定各自 source job／上下文；不预设 Conversation 数限制。这取代“每个 source job 一个 Session／仅 root Conversation”的建议。既有两类累计容忍与封存仍按 Session 作用域保留，未采用由代理自行提出的 Conversation 级策略变更。

采用的行为条件在[会话状态](../state/compressor-session.md)。完整形成记录位于 [change](../../openspec/changes/add-compressor-repair-session/)、[proposal](../../openspec/changes/add-compressor-repair-session/proposal.md)、[design](../../openspec/changes/add-compressor-repair-session/design.md)、[tasks](../../openspec/changes/add-compressor-repair-session/tasks.md)及全部 [compressor-repair-session delta](../../openspec/changes/add-compressor-repair-session/specs/compressor-repair-session/spec.md)。该新能力尚未归档为主 spec；相关主边界为 [conversation-runtime](../../openspec/specs/conversation-runtime/spec.md)与 [optional-dynamite-product](../../openspec/specs/optional-dynamite-product/spec.md)。已有单次输出由 [add-auxiliary-tool-output](../../openspec/changes/add-auxiliary-tool-output/)及其 [proposal](../../openspec/changes/add-auxiliary-tool-output/proposal.md)、[design](../../openspec/changes/add-auxiliary-tool-output/design.md)、[tasks](../../openspec/changes/add-auxiliary-tool-output/tasks.md)、[全部 delta](../../openspec/changes/add-auxiliary-tool-output/specs/auxiliary-tool-output/spec.md)承接，不被本轮调研隐式替换。

## 基础设施评估（历史范围）

[初轮固定探针](../verification/COMPRESSOR-SESSION-FEASIBILITY.md)使用 1.0.3-pakka.1；其 provider error 终止当前 run、普通 Pakka managed Conversation 计入主额度的结论保留为该版本的历史测量。

用户随后将 1.4.0 指定为设计评估基准。[新版隔离实验](../verification/COMPRESSOR-SESSION-1.4-FEASIBILITY.md)使用固定 1.4.0-pakka.1 归档和同 cohort 公开依赖：18/18、51 次真实本地 HTTP、native/server reports 均为 0。afterResponse(error) 内排入受限原生 steer，配合 afterFailedRun: continue，由原生失败边界继续同一 Conversation；keep 与未排入纠错的 continue 两个对照均不额外请求。精确 3/4 次封存、混合计数、完整替换反馈、重开和迟到结果均已测量。

因此推荐复用原生 hooks/inbox/scheduler，当前没有采用自建 agent loop 或追加 generation 补丁的必要。单个 Compresser Conversation 的任务可以跨多个 native run，不能以第一次 submission 的失败或 done 当作该任务终态，也不能把一个任务完成当成整个长期服务容器完成。18 个实验每例仅含一个 root Conversation，没有验证新增的跨 Conversation 来源隔离、共享计数和外部服务接入；这些项目继续列在产品任务中。源 job 辅助额度端口、回执与崩溃恢复，以及单独的生产 cohort 接入仍待实现；生产源码和依赖未变更。

当时选用真实本地 provider 的能力刻画、持久化/reopen、实际 Pakka quota、文档链接与 OpenSpec strict 检查；没有运行付费模型、GUI 或全量无关产品回归。按用户后续指令不再选用 adversarial review；历史未完成双审仍按原事实保留。

## 第一版执行试行

用户随后授权开始实施。采用 bootstrap 显式创建的 createCompresserSession 冻结 facade：物理 Session、Conversations、provider 和文档均由 adapter 持有；Dynamite 的各业务 Conversation service 通过受限 source-job 端口维护逻辑压缩生命周期。一个共享容器可服务多个外部 Session，一个外部 Conversation 可产生多个独立内部 Conversation。两类容忍值都必须显式给出，未把示例 3/4 变成默认值。

SourceJob.converse 复用原生 inbox/steer/afterFailedRun，逐次经过原辅助额度、来源复查和 reservation/completion。Dynamite 显式 compressionSession: { maxCalls } 选择固定模型的工具模式，并关闭该 job 的外层 primitive retry/fallback。P1/P2/P3/P4 完整候选最终与业务 Session 的 run/block 原子写入；容器的修复轨迹和策略记录与业务产物分开。

试行补齐共享阈值、同源多 job／跨 Session 隔离、迟到 sibling 拒绝、预算、撤权/取消、未知写入和真实进程中断后的封存/quarantined。旧 writer 锁由可信恢复显式处理，未确认效果不重发。两个写入域之间仍不声称崩溃事务或自动接续未知任务；历史 SQLite 迁移和新配对的可选 server 装配继续列在 tasks。

本次也协调 [cohort 变更](../../openspec/changes/prepare-durable-1-4-0-patch/)、[proposal](../../openspec/changes/prepare-durable-1-4-0-patch/proposal.md)、[design](../../openspec/changes/prepare-durable-1-4-0-patch/design.md)、[tasks](../../openspec/changes/prepare-durable-1-4-0-patch/tasks.md)、全部 [durable-request-policy delta](../../openspec/changes/prepare-durable-1-4-0-patch/specs/durable-request-policy/spec.md) 与 [development-verification delta](../../openspec/changes/prepare-durable-1-4-0-patch/specs/development-verification/spec.md)。生产 cohort 选择 1.4.0；旧归档、历史配对和旧账本原文保留。Durable 1.4 的必需公开依赖包含 pi-codemode；它不等于旧 oracle 或给模型增加执行工具。

[固定试行验证](../verification/COMPRESSER-SESSION-TRIAL.md)保存最终私有归档身份、执行选择、RED/GREEN、原始失败和范围。新状态表述在[会话状态](../state/compressor-session.md)，公共端口在[Strategy API](../reference/STRATEGY-API.md)。本次选用全仓源码、外部安装、真实 localhost、进程中断、类型/构建及文档/OpenSpec 检查；没有付费模型、用户凭据或 adversarial review。
