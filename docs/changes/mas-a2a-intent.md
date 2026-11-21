# MAS A2A 意图分离

采用明确区分被动信息贡献、原生请求和显式关联回复。`inform` 通过公开 `RuntimeRecords` 持久化且不会唤醒收件者；允许的 Runtime context source 仅在该目标之后的自然请求中提供有界来源标注内容。公开生命周期没有绑定确切 GenerationTask 的完成回调，因此 inform 持续保持 pending/at-least-once，不声称已理解或消费。Response 仅在 admission 确定拒绝时释放 provisional reservation；调用方等待期间被撤权不会阻止同 session 服务完成基于 root、fingerprint 和版本 CAS 的无效果清理，但原 client 仍被拒绝。Admission unknown、true 后撤权及 native delivery unknown 继续保留身份绑定。

- [Change](../../openspec/changes/distinguish-mas-a2a-intent/)
- [Proposal](../../openspec/changes/distinguish-mas-a2a-intent/proposal.md)
- [Design](../../openspec/changes/distinguish-mas-a2a-intent/design.md)
- [Tasks and test classification](../../openspec/changes/distinguish-mas-a2a-intent/tasks.md)
- Delta specs: [same-session-mas](../../openspec/changes/distinguish-mas-a2a-intent/specs/same-session-mas/spec.md), [mas-devpack](../../openspec/changes/distinguish-mas-a2a-intent/specs/mas-devpack/spec.md)
- Related main specs: [same-session-mas](../../openspec/specs/same-session-mas/spec.md), [mas-devpack](../../openspec/specs/mas-devpack/spec.md)
- Current declarations: [MAS state](../state/mas.md), [MAS API](../reference/MAS-API.md), [MAS DevPack API](../reference/MAS-DEVPack-API.md)

本 change 记录此次形成及验证范围；当前产品契约同步在 state 与 API，代码未扩展 Durable 私有接口。
