# Pakka

Pakka 将 Pi 的 Conversation、权限、持久化和 MAS 服务接到可选的 pakka-webui Web 工作台。

## 当前工作

[Compresser 会话修复与封存](changes/compressor-repair-session.md)已进入第一版显式启用试行：Dynamite 0.4.0 × agent 0.6.0 在固定 Durable 1.4.0-pakka.1 上运行一个长期容器，以多个 source-job Conversation 服务容器外的业务 Session／Conversation；一个外部 Conversation 可触发多个压缩 Conversation。原生 steer／失败边界接续保留轨迹，每次请求计入原辅助额度并保留回执；两类 Session 累计错误达到容忍值即封存。真实进程中断后的未确认工作在可信解除旧 writer 锁后重开为 quarantined，不自动重发。见[当前状态](state/compressor-session.md)、[隔离修正后的试行验证](verification/COMPRESSER-SESSION-TRIAL-ISOLATION.md)、[设计](../openspec/changes/add-compressor-repair-session/design.md)与[剩余任务](../openspec/changes/add-compressor-repair-session/tasks.md)。[1.4 能力探针](verification/COMPRESSOR-SESSION-1.4-FEASIBILITY.md)与[初轮 1.0.3 证据](verification/COMPRESSOR-SESSION-FEASIBILITY.md)保留原范围。

[Dynamite P2/P3/P4 受控 Tool Calling 生产](changes/auxiliary-tool-output.md)的实现及已选执行验证保留在[原任务](../openspec/changes/add-auxiliary-tool-output/tasks.md)和[验证记录](verification/AUXILIARY-TOOL-OUTPUT.md)。两次部分复审保留原始失败；按用户后续指令不再使用 adversarial review，历史未完成协议不改写为通过。

当前为[设置路由、前端调优与本机管理员恢复](changes/webui-navigation-and-local-recovery.md)准备采用方案，见[proposal](../openspec/changes/improve-webui-navigation-and-local-recovery/proposal.md)、[design](../openspec/changes/improve-webui-navigation-and-local-recovery/design.md)和[统一 tasks](../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md)。提案待确认，恢复入口和新路由尚未实现。

设置直达、命名及[规范采用与首批排版/焦点改进](changes/webui-frontend-guidelines.md)已实现；结果留在[指南 tasks](../openspec/changes/adopt-webui-frontend-guidelines/tasks.md)和[设置 tasks](../openspec/changes/correct-webui-settings-and-name/tasks.md)。后续队列由上述统一 tasks 承接。

生产 package.json/lock 已选择 Pi AI/Chord/Telemetry `1.4.0` 与捆绑的 Durable `1.4.0-pakka.1`；[cohort 任务](../openspec/changes/prepare-durable-1-4-0-patch/tasks.md#4-后续产品接入)和追加兼容性账本记录本次接入与存储范围。开发 verification 的选用见[交付声明](state/delivery.md#verification-的选用)。

后续文档工作是确定通用测试方法补全与 verification 历史瘦身的采用方案，见[本轮评估](../openspec/changes/streamline-verification-and-patch-state/design.md#验证方法与进一步瘦身)和[待决定任务](../openspec/changes/streamline-verification-and-patch-state/tasks.md#4-待决定的后续方案)。

- **预期**：[state](state/README.md)，包括 [Durable 源补丁](state/durable-patch.md)。
- **产品后续工作**：[前端交付任务](../openspec/changes/adopt-devin-frontend/tasks.md)、[服务与生命周期任务](../openspec/changes/pakka-webui/tasks.md)。
- **本地执行安排**：`docs/.temp/active-plan.md`；文件缺失时从上述 tracked 任务接续。
- **方法与记录**：[验证方法](development/VERIFICATION.md)、[固定验证记录](verification/README.md)。
- **完整导航与变更**：[文档导航](README.md)、[changes](changes/README.md)。

## 保留 OpenSpec 组织方式

完整变更在 [OpenSpec changes](../openspec/changes/)维护 proposal、design、tasks 与 `specs/**/spec.md`，完成后按其生命周期归档并合入 [主 specs](../openspec/specs/)。

每条 docs/changes 摘要完整引用相关 change、proposal、已有 design、tasks、全部 delta 及有关主 spec；归档时同步引用。state 维护预期与细则映射，OpenSpec tasks 承接实际差距和具体工作。
