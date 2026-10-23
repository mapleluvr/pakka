# Compresser 会话修复与封存

2026-10-23，用户在真实重试观察之后要求保留 Compresser 轨迹，分别设置工具调用错误与其他未解决错误的容忍次数；任一累计达到上限即封存并报告最后一次原因。3 和 4 是用户示例及本轮实验值，尚未发布为公共 API 默认值。用户明确要求优先考察 Pakka／pi-durable；发现基础设施难点时先报告，再考虑自建 loop。

采用的行为条件在[会话状态](../state/compressor-session.md)。完整形成记录位于 [change](../../openspec/changes/add-compressor-repair-session/)、[proposal](../../openspec/changes/add-compressor-repair-session/proposal.md)、[design](../../openspec/changes/add-compressor-repair-session/design.md)、[tasks](../../openspec/changes/add-compressor-repair-session/tasks.md)及全部 [compressor-repair-session delta](../../openspec/changes/add-compressor-repair-session/specs/compressor-repair-session/spec.md)。该新能力尚未归档为主 spec；相关主边界为 [conversation-runtime](../../openspec/specs/conversation-runtime/spec.md)与 [optional-dynamite-product](../../openspec/specs/optional-dynamite-product/spec.md)。已有单次输出由 [add-auxiliary-tool-output](../../openspec/changes/add-auxiliary-tool-output/)及其 [proposal](../../openspec/changes/add-auxiliary-tool-output/proposal.md)、[design](../../openspec/changes/add-auxiliary-tool-output/design.md)、[tasks](../../openspec/changes/add-auxiliary-tool-output/tasks.md)、[全部 delta](../../openspec/changes/add-auxiliary-tool-output/specs/auxiliary-tool-output/spec.md)承接，不被本轮调研隐式替换。

[固定探针记录](../verification/COMPRESSOR-SESSION-FEASIBILITY.md)显示：正常 stop 和工具错误可以通过原生边界继续；provider error 终止当前 run，没有继续返回值。Pakka 普通 managed Conversation 计入主调用额度，不能直接作为原 source job 的辅助会话。封存、错误回数及公开钩子能力已取得实测；完整生产方案和错误自动续跑仍在报告决策点。未实现自建 agent loop，未变更生产源码或依赖。

选用真实本地 provider 的能力刻画、持久化/reopen、实际 Pakka quota、文档链接与 OpenSpec strict 检查。不运行付费模型、GUI 或全量无关产品回归；按用户后续指令不再选用 adversarial review。历史未完成双审仍按原事实保留，不改成通过。
