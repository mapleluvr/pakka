# 设置路由、前端调优与本机管理员恢复

2026-10-23 用户要求将前端下一步与管理员恢复纳入同一变更流程。本方案先闭合本机登录恢复和明确反馈，再实现可寻址设置与逐页质量改进。目前为待确认提案，恢复入口和新路由尚未实现，state 正文继续表达已采用的约定。

- [change](../../openspec/changes/improve-webui-navigation-and-local-recovery/)。
- [proposal](../../openspec/changes/improve-webui-navigation-and-local-recovery/proposal.md)、[design](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md)、[tasks](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md)。
- 全部 delta：[authenticated-mas-apps](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/authenticated-mas-apps/spec.md)、[devin-frontend](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md)。
- 相关主 spec：[authenticated-mas-apps](../../openspec/specs/authenticated-mas-apps/spec.md)。
- 前端能力尚在活动 lineage：[Devin 前端](../../openspec/changes/adopt-devin-frontend/specs/devin-frontend/spec.md)、[设置与命名](../../openspec/changes/correct-webui-settings-and-name/specs/devin-frontend/spec.md)、[指南采用](../../openspec/changes/adopt-webui-frontend-guidelines/specs/devin-frontend/spec.md)；归档顺序见新 tasks。
- 当前映射：[frontend state](../state/frontend.md)、[webui state](../state/webui.md)、[runtime state](../state/runtime.md)；来源与实施方法见[前端开发规范](../development/FRONTEND-GUIDELINES.md)。

现场认证证据、默认 10 分钟/旧会话撤销的设计理由、单 writer、平台文件保护与未知交付的取舍集中在 design，不由本摘要替代。

2026-10-24 仅采用 [Conversation/composer 状态可观测性 P0](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#61-2026-10-24-conversation-状态可观测性批次) 切片：真实 live/part 保形、按来源 Conversation 统一工具卡、禁用/停止原因及 receipt reason 指引。Sessions 行运行状态因 DTO 缺口另待协议变更，恢复入口和设置路由仍待确认。实现候选与独立复核结果见 [P0 验证记录](../verification/WEBUI-INTERACTION-P0.md)，原调查终稿与渲染核对材料保留在调查目录 `D:\Projects\TempProjects\pakka-webui-investig\`。
