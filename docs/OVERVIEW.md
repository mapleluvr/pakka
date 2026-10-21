# Pakka

Pakka 将 Pi 的 Conversation、权限、持久化和 MAS 服务接到可选的 Pakka-Pocket Web 工作台。

## 当前工作

Devin 前端已有固定候选，完整交付仍未通过。下一项是补足安装消费者进程诊断，分别核对 Browser 停点、Windows 文件系统与独立验收环境；不归并成界面时序问题。

- **预期**：[state](state/README.md)。
- **差距与交接**：[实施状态](PAKKA-POCKET-STATUS.md)；本地 `docs/.temp/active-plan.md`，缺失时从实施状态恢复。
- **变更摘要**：[changes](changes/README.md)。
- **使用与技术文档**：[完整导航](README.md)。
- **本轮整理与恢复**：[清理记录](verification/DOCUMENTATION-CLEANUP.md)；不是产品验收。

## 保留 OpenSpec 组织方式

完整变更继续在 [OpenSpec changes](../openspec/changes/)维护 proposal、design、tasks 与 `specs/**/spec.md`，完成后按其生命周期归档并合入 [主 specs](../openspec/specs/)。

**docs/changes 只作总结，不另建完整变更正文。每条总结必须完整引用所涉及的 OpenSpec change 目录、proposal、存在的 design、tasks、全部 delta spec，以及有关主 spec；跨多次变更就逐项列全。** 归档时一并更新这些引用。state 负责当前预期和细则映射，未完成/失败状态不能因归档或文档整理消失。
