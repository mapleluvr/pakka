# 长期投递记录

采用用户要求：持久化服务漫长任务，完整历史与模型上下文分别管理。同 Session Catalog 以原请求 ID 独立持久保存投递，按收件人的未完成工作接纳。旧累计数值的形成、数据布局与原子迁移依据由完整 OpenSpec 记录承接。

- [Change](../../openspec/changes/retain-long-lived-deliveries/)
- [Proposal](../../openspec/changes/retain-long-lived-deliveries/proposal.md)
- [Design](../../openspec/changes/retain-long-lived-deliveries/design.md)
- [Tasks](../../openspec/changes/retain-long-lived-deliveries/tasks.md)
- [实际验证与候选身份](../verification/LONG-LIVED-DELIVERIES.md)
- [全部 delta：same-session-mas](../../openspec/changes/retain-long-lived-deliveries/specs/same-session-mas/spec.md)
- [相关主 spec](../../openspec/specs/same-session-mas/spec.md)

当前声明见 [Runtime](../state/runtime.md#长期历史与投递)、[MAS](../state/mas.md)和 [MAS API](../reference/MAS-API.md)。此 change 仍为活动变更，尚未归档。
