# Pakka

Pakka 将 Pi Durable 的 Conversation、权限、持久化与 MAS 协作能力接到默认 WebUI 入口及公开 SDK。

## 当前工作

[长期投递记录](changes/long-lived-deliveries.md)与[本机维护交付](changes/local-maintenance-and-delivery.md)按操作者授权从原 PR #4 重组至独立干净分支；对应[持久化结果](verification/LONG-LIVED-DELIVERIES.md)和[维护结果](verification/LOCAL-MAINTENANCE-DELIVERY.md)保留原候选身份，原始证据已在受限本地目录打包保全。新交付继续承接原 PR #6 的有界观察，完成覆盖核对后再关闭被替代 PR 和清理远端旧分支；PR #5 暂缓处理。

[本地验证证据与提交检查](changes/local-verification-evidence.md)已通过 [PR #7](https://github.com/mapleluvr/pakka/pull/7) 合入 dev：Git 只跟踪关键信息与完整本地证据包整体 hash，原始证据不上 GitHub，云端由用户处理。后续工作按[贡献指南](../CONTRIBUTING.md)从最新 `origin/dev` 建立独立分支。

本地执行安排在已忽略的 `docs/.temp/active-plan.md`；文件缺失时从所属 tasks 接续。

## 产品后续入口

- [Runtime 与默认入口](../openspec/changes/enable-product-runtime-and-launcher/tasks.md)：受控长上下文/重试、附件、长期容量治理；固定结果见[验证记录](verification/PRODUCT-RUNTIME-LAUNCHER.md)。
- [资源压力](../openspec/changes/add-local-maintenance-and-delivery/tasks.md#near-term-resource-pressure)：WebUI/多 Runtime 内存测量、按字节观察、活跃实例预算及独立 worker/OOM 恢复。
- [工作台导航与本机恢复](../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md)：维护与登录由本轮接续，可寻址设置及逐页交互仍待办。
- [前端交付](../openspec/changes/adopt-devin-frontend/tasks.md)与[服务生命周期](../openspec/changes/pakka-webui/tasks.md)：各自未完成的产品与验证范围。
- [Compresser 会话](../openspec/changes/add-compressor-repair-session/tasks.md)：原生并发、修复和封存的后续工作；组合条件见[当前声明](state/compressor-session.md)。
- [验证文档整理](../openspec/changes/streamline-verification-and-patch-state/tasks.md)：方法补充与历史材料整理的待决定事项。

## 阅读与维护

- [README](../README.md)介绍产品和启动；[文档导航](README.md)提供使用、API 与开发入口。
- [state](state/README.md)承载采用的预期并映射详细契约；[开发规范](development/README.md)和[Git 工作流](development/GIT-WORKFLOW.md)维护操作方法。
- [changes](changes/README.md)索引形成记录，完整 proposal/design/tasks/specs 由 [OpenSpec](../openspec/changes/)管理；[verification](verification/README.md)保存固定结果，[追加式兼容性账本](PI-DURABLE-COMPATIBILITY.md)保存 Pi 变更身份。
