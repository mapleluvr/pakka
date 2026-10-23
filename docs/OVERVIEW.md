# Pakka

Pakka 将 Pi 的 Conversation、权限、持久化和 MAS 服务接到可选的 pakka-webui Web 工作台。

## 当前工作

当前为[设置路由、前端调优与本机管理员恢复](changes/webui-navigation-and-local-recovery.md)准备采用方案，见[proposal](../openspec/changes/improve-webui-navigation-and-local-recovery/proposal.md)、[design](../openspec/changes/improve-webui-navigation-and-local-recovery/design.md)和[统一 tasks](../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md)。提案待确认，恢复入口和新路由尚未实现。

此前设置直达、命名及[规范采用与首批排版/焦点改进](changes/webui-frontend-guidelines.md)已实现，仍未提交；结果留在[指南 tasks](../openspec/changes/adopt-webui-frontend-guidelines/tasks.md)和[设置 tasks](../openspec/changes/correct-webui-settings-and-name/tasks.md)。后续队列由上述统一 tasks 承接。

后续文档工作是确定通用测试方法补全与 verification 历史瘦身的采用方案，见[本轮评估](../openspec/changes/streamline-verification-and-patch-state/design.md#验证方法与进一步瘦身)和[待决定任务](../openspec/changes/streamline-verification-and-patch-state/tasks.md#4-待决定的后续方案)。入口精简、视觉生成物本地化与 Durable 源补丁声明已经完成。

- **预期**：[state](state/README.md)，包括 [Durable 源补丁](state/durable-patch.md)。
- **产品后续工作**：[前端交付任务](../openspec/changes/adopt-devin-frontend/tasks.md)、[服务与生命周期任务](../openspec/changes/pakka-webui/tasks.md)。
- **本地执行安排**：`docs/.temp/active-plan.md`；文件缺失时从上述 tracked 任务接续。
- **方法与记录**：[验证方法](development/VERIFICATION.md)、[固定验证记录](verification/README.md)。
- **完整导航与变更**：[文档导航](README.md)、[changes](changes/README.md)。

## 保留 OpenSpec 组织方式

完整变更在 [OpenSpec changes](../openspec/changes/)维护 proposal、design、tasks 与 `specs/**/spec.md`，完成后按其生命周期归档并合入 [主 specs](../openspec/specs/)。

每条 docs/changes 摘要完整引用相关 change、proposal、已有 design、tasks、全部 delta 及有关主 spec；归档时同步引用。state 维护预期与细则映射，OpenSpec tasks 承接实际差距和具体工作。
