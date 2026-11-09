# Pakka

Pakka 将 Pi Durable 的 Conversation、权限、持久化与 MAS 协作能力接到默认 WebUI 入口及公开 SDK。

## 当前工作

[RSI 长期工单持久化](changes/rsi-persistence.md) 已完成实现与独立复审：承接 #5 的 UI/Bot/MAS 薄层，采用按记录原子存储、详情分页、原请求核对及显式恢复。当前预期见 [RSI](state/rsi.md)，固定结果见[验证摘要](verification/RSI-PERSISTENCE.md)，分支交付由 [tasks](../openspec/changes/persist-rsi-ticket-records/tasks.md) 接续。

[PR #8](https://github.com/mapleluvr/pakka/pull/8) 已合入 dev；长期投递、本机维护和懒观察的关键结果保留在各自 [verification](verification/README.md)。原始验证证据只在本地归档，Git 仅记录关键结果和整体 hash。

本地执行安排在已忽略的 `docs/.temp/active-plan.md`；文件缺失时从所属 tasks 接续。

## 产品后续入口

- [Runtime 与默认入口](../openspec/changes/enable-product-runtime-and-launcher/tasks.md)：受控长上下文/重试、附件、长期容量治理；固定结果见[验证记录](verification/PRODUCT-RUNTIME-LAUNCHER.md)。
- [资源压力](../openspec/changes/add-local-maintenance-and-delivery/tasks.md#near-term-resource-pressure)：冷浏览/有界观察已交付；完整执行上下文、活跃 Runtime 预算、闲置卸载及独立 worker/OOM 恢复仍需接续。
- [工作台导航与本机恢复](../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md)：维护与登录由本轮接续，可寻址设置及逐页交互仍待办。
- [前端交付](../openspec/changes/adopt-devin-frontend/tasks.md)与[服务生命周期](../openspec/changes/pakka-webui/tasks.md)：各自未完成的产品与验证范围。
- [Compresser 会话](../openspec/changes/add-compressor-repair-session/tasks.md)：原生并发、修复和封存的后续工作；组合条件见[当前声明](state/compressor-session.md)。
- [验证文档整理](../openspec/changes/streamline-verification-and-patch-state/tasks.md)：方法补充与历史材料整理的待决定事项。

## 阅读与维护

- [README](../README.md)介绍产品和启动；[文档导航](README.md)提供使用、API 与开发入口。
- [state](state/README.md)承载采用的预期并映射详细契约；[开发规范](development/README.md)和[Git 工作流](development/GIT-WORKFLOW.md)维护操作方法。
- [changes](changes/README.md)索引形成记录，完整 proposal/design/tasks/specs 由 [OpenSpec](../openspec/changes/)管理；[verification](verification/README.md)保存固定结果，[追加式兼容性账本](PI-DURABLE-COMPATIBILITY.md)保存 Pi 变更身份。
