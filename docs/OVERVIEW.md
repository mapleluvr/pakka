# Pakka

Pakka 将 Pi Durable 的 Conversation、权限、持久化与 MAS 协作能力接到默认 WebUI 入口及公开 SDK。

## 当前工作

[本地验证证据与提交检查](changes/local-verification-evidence.md)已采用：验证目录只跟踪关键信息和本地证据包整体 hash，原始证据不上 GitHub，云端由用户接管；每次提交及 PR 创建/更新前检查完整产物。规范同步与检查已完成，[PR #7](https://github.com/mapleluvr/pakka/pull/7) 等待评审/集成；[所属 tasks](../openspec/changes/adopt-local-verification-evidence/tasks.md)保存实际结果。现有 PR 及已发布证据的清理另行处理。

[Git 协作与项目元数据](changes/git-workflow-and-project-metadata.md)已通过 [PR #2](https://github.com/mapleluvr/pakka/pull/2) 合入 dev；[所属 tasks](../openspec/changes/adopt-git-workflow-and-project-metadata/tasks.md)保留原结果。当前无产品源码修改；后续工作按[贡献指南](../CONTRIBUTING.md)从最新 `origin/dev` 建立独立分支。

本地执行安排在已忽略的 `docs/.temp/active-plan.md`；文件缺失时从所属 tasks 接续。

## 产品后续入口

以下是可接续差距，其采用范围和任务状态以所链接记录为准：

- [Runtime 与默认入口](../openspec/changes/enable-product-runtime-and-launcher/tasks.md)：受控长上下文/重试、附件、长期容量治理；已交付入口的固定结果见[验证记录](verification/PRODUCT-RUNTIME-LAUNCHER.md)。
- [工作台导航与本机恢复](../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md)：登录恢复、可寻址设置及交互待办。
- [前端交付](../openspec/changes/adopt-devin-frontend/tasks.md)与[服务生命周期](../openspec/changes/pakka-webui/tasks.md)：各自未完成的产品与验证范围。
- [Compresser 会话](../openspec/changes/add-compressor-repair-session/tasks.md)：原生并发、修复和封存的后续工作；组合条件见[当前声明](state/compressor-session.md)。
- [验证文档整理](../openspec/changes/streamline-verification-and-patch-state/tasks.md)：方法补充与历史材料整理的待决定事项。

## 阅读与维护

- [README](../README.md)介绍产品和启动；[文档导航](README.md)提供使用、API 与开发入口。
- [state](state/README.md)承载采用的预期并映射详细契约；[开发规范](development/README.md)和[Git 工作流](development/GIT-WORKFLOW.md)维护操作方法。
- [changes](changes/README.md)索引形成记录，完整 proposal/design/tasks/specs 由 [OpenSpec](../openspec/changes/)管理。归档时同步主 specs 与引用。
- [verification](verification/README.md)保存固定候选结果；[追加式兼容性账本](PI-DURABLE-COMPATIBILITY.md)保留 Pi 变更身份。已完成历史通过这些记录查阅。
