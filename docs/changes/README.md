# 变更摘要与完整 OpenSpec 引用

完整的形成条件、选择、设计、任务与场景由 [OpenSpec](../../openspec/changes/)维护；本目录只提供摘要和完整引用，不复制第二套变更正文。当前预期见 [state](../state/README.md)，实际差距见[工作入口与领域任务](../OVERVIEW.md)。

- [Durable 1.4.0 补丁与 Verification 选用](durable-1-4-0-and-verification.md)：版本固定的独立补丁、可重建/安装入口与可选验证记录规则。
- [验证入口与补丁声明](verification-and-patch-state.md)：重复入口清理、视觉生成物本地化、Durable patch state 与验证文档评估。
- [文档系统](2026-10-21-documentation-system.md)：state-evo、OpenSpec 主记录和备份后清理。
- [Devin 前端](devin-frontend-adoption.md)：原型为主体、真实接口、Team 和加载边界；完整验收未通过。
- [WebUI 与 MAS](webui-and-mas.md)：既有两项活动 change 的完整 artifacts/spec 入口。
- [核心集成](core-integration-lineage.md)：七项归档 change、所有 delta 和主 spec。

## 维护约定

每项摘要必须链接确切 change 目录、proposal、已有 design、tasks、全部 delta spec 和有关主 spec；尚无主 spec 时写明，不虚构已归档状态。多 change 摘要逐项列全。归档/改名同时更新摘要及 state 映射。

初始形成、采用补充/替换/撤销的详细理由写入相应 OpenSpec change，并同步 state 与工作安排。实现顺序、局部修复和测试进度留在所属 tasks/active-plan，不为每次活动另造预期调整。

旧草稿和探针已按[清理记录](../verification/DOCUMENTATION-CLEANUP.md)外置备份；固定阶段验收、当前候选与兼容性账本保持各自证据角色。
