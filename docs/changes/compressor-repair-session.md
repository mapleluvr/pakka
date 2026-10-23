# Compresser 会话修复与封存

2026-10-23，用户在真实重试观察之后要求保留 Compresser 轨迹，分别设置工具调用错误与其他未解决错误的容忍次数；任一累计达到上限即封存并报告最后一次原因。3 和 4 是用户示例及本轮实验值，尚未发布为公共 API 默认值。用户明确要求优先考察 Pakka／pi-durable；发现基础设施难点时先报告，再考虑自建 loop。

用户随后澄清容器和基数：Pakka-dynamite 维护一个长期存在的 pi-durable Session，称 Compresser Session；其中的多个 Compresser Conversation 为容器外的业务 Session／Conversation 提供压缩服务。一个外部 Conversation 可以触发多个独立的压缩 Conversation，绑定各自 source job／上下文；不预设 Conversation 数限制。这取代“每个 source job 一个 Session／仅 root Conversation”的建议。既有两类累计容忍与封存仍按 Session 作用域保留，未采用由代理自行提出的 Conversation 级策略变更。

采用的行为条件在[会话状态](../state/compressor-session.md)。完整形成记录位于 [change](../../openspec/changes/add-compressor-repair-session/)、[proposal](../../openspec/changes/add-compressor-repair-session/proposal.md)、[design](../../openspec/changes/add-compressor-repair-session/design.md)、[tasks](../../openspec/changes/add-compressor-repair-session/tasks.md)及全部 [compressor-repair-session delta](../../openspec/changes/add-compressor-repair-session/specs/compressor-repair-session/spec.md)。该新能力尚未归档为主 spec；相关主边界为 [conversation-runtime](../../openspec/specs/conversation-runtime/spec.md)与 [optional-dynamite-product](../../openspec/specs/optional-dynamite-product/spec.md)。已有单次输出由 [add-auxiliary-tool-output](../../openspec/changes/add-auxiliary-tool-output/)及其 [proposal](../../openspec/changes/add-auxiliary-tool-output/proposal.md)、[design](../../openspec/changes/add-auxiliary-tool-output/design.md)、[tasks](../../openspec/changes/add-auxiliary-tool-output/tasks.md)、[全部 delta](../../openspec/changes/add-auxiliary-tool-output/specs/auxiliary-tool-output/spec.md)承接，不被本轮调研隐式替换。

[初轮固定探针](../verification/COMPRESSOR-SESSION-FEASIBILITY.md)使用 1.0.3-pakka.1；其 provider error 终止当前 run、普通 Pakka managed Conversation 计入主额度的结论保留为该版本的历史测量。

用户随后将 1.4.0 指定为设计评估基准。[新版隔离实验](../verification/COMPRESSOR-SESSION-1.4-FEASIBILITY.md)使用固定 1.4.0-pakka.1 归档和同 cohort 公开依赖：18/18、51 次真实本地 HTTP、native/server reports 均为 0。afterResponse(error) 内排入受限原生 steer，配合 afterFailedRun: continue，由原生失败边界继续同一 Conversation；keep 与未排入纠错的 continue 两个对照均不额外请求。精确 3/4 次封存、混合计数、完整替换反馈、重开和迟到结果均已测量。

因此推荐复用原生 hooks/inbox/scheduler，当前没有采用自建 agent loop 或追加 generation 补丁的必要。单个 Compresser Conversation 的任务可以跨多个 native run，不能以第一次 submission 的失败或 done 当作该任务终态，也不能把一个任务完成当成整个长期服务容器完成。18 个实验每例仅含一个 root Conversation，没有验证新增的跨 Conversation 来源隔离、共享计数和外部服务接入；这些项目继续列在产品任务中。源 job 辅助额度端口、回执与崩溃恢复，以及单独的生产 cohort 接入仍待实现；生产源码和依赖未变更。

选用真实本地 provider 的能力刻画、持久化/reopen、实际 Pakka quota、文档链接与 OpenSpec strict 检查。不运行付费模型、GUI 或全量无关产品回归；按用户后续指令不再选用 adversarial review。历史未完成双审仍按原事实保留，不改成通过。
