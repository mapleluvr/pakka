# 变更摘要与完整 OpenSpec 引用

完整的形成条件、选择、设计、任务与场景由 [OpenSpec](../../openspec/changes/)维护；本目录只提供摘要和完整引用，不复制第二套变更正文。当前预期见 [state](../state/README.md)，实际差距见[工作入口与领域任务](../OVERVIEW.md)。

- [Compresser 会话修复与封存](compressor-repair-session.md)：两类累计错误容忍、轨迹保留和原生基础设施调查；实现路线在报告决策点。
- [辅助推理 Tool Calling 输出](auxiliary-tool-output.md)：来源绑定的结构化候选生产与独立 Dynamite 产物。
- [设置路由与本机恢复](webui-navigation-and-local-recovery.md)：登录恢复闭环、可寻址配置和逐页质量的待采用方案。
- [Invite Role 菜单补齐](webui-invitation-role-menu.md)：人员页复用现有菜单，保留四角色及原一次性邀请授权。
- [分组菜单与首页创建入口](webui-grouping-and-creation-controls.md)：复用主题菜单，平级透明入口与灰色短分隔。
- [UI 文案精简与情境化反馈](webui-explanatory-copy.md)：采用全仓调查推荐，准确名称、短状态和按需信息，保留未确认和风险后果。
- [前端规范与原生行为](webui-frontend-guidelines.md)：采用两份开发指南、直接生产代码参考和第一批可读性/焦点改进。
- [设置与产品命名](webui-settings-and-name.md)：单击进入专用配置页、页内分类与 pakka-webui 命名。
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
