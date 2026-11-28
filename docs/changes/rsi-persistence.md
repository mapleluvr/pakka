# RSI 长期工单持久化

用户确认工单服务承担通用提交、编辑、分派、进度、结果与恢复；workflow 与 Memo 独立。审查 #5 时发现完整空间 JSON 的累计容量及全量读取成本，以及无 receipt 的 pending/unknown 运行缺少核对路径。

随后依据已采用的 [Dynamite 持久化](../state/dynamite-persistence.md)，选择原 Session SQLite、分记录数据、多记录原子提交、原请求回执和固定派发计划恢复。Dynamite 当前的全历史 cache 不作为有界读取模板。MAS admission hook 可能有效果，原请求查询与发送分别定义。

采用的当前声明在 [RSI](../state/rsi.md)。完整形成材料为 [proposal](../../openspec/changes/persist-rsi-ticket-records/proposal.md)、[design](../../openspec/changes/persist-rsi-ticket-records/design.md)、[tasks](../../openspec/changes/persist-rsi-ticket-records/tasks.md)；delta specs 为 [runtime-records](../../openspec/changes/persist-rsi-ticket-records/specs/runtime-records/spec.md)、[rsi-tickets](../../openspec/changes/persist-rsi-ticket-records/specs/rsi-tickets/spec.md)、[same-session-mas](../../openspec/changes/persist-rsi-ticket-records/specs/same-session-mas/spec.md)、[webui-extension](../../openspec/changes/persist-rsi-ticket-records/specs/webui-extension/spec.md)。既有薄层场景在 [add-rsi-ticket-layer](../../openspec/changes/add-rsi-ticket-layer/specs/rsi-tickets/spec.md)，MAS 主契约在 [same-session-mas spec](../../openspec/specs/same-session-mas/spec.md)。

实施中确认 WebUI 扩展宿主仍有 512 笔累计操作门槛，因此同批把操作回执拆为独立记录，保持小型设置文档和原处理器未知效果语义。只读订阅以权限范围的小变化标记刷新当前页；旧工单迁移要求冷备份后显式启用。runtime-records、rsi-tickets 和 webui-extension 为活动新增能力，尚无同名主 spec。

原 #5 固定源码与历史验证描述按原版本保留；本轮实际结果见[验证摘要](../verification/RSI-PERSISTENCE.md)及所属 tasks；独立复审、全仓与安装消费已通过，分支交付以 dev 为目标。
