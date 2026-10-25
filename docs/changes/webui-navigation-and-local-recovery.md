# 设置路由、前端调优与本机管理员恢复

2026-10-23 用户要求将前端下一步与管理员恢复纳入同一变更流程。本方案先闭合本机登录恢复和明确反馈，再实现可寻址设置与逐页质量改进。目前为待确认提案，恢复入口和新路由尚未实现，state 正文继续表达已采用的约定。

- [change](../../openspec/changes/improve-webui-navigation-and-local-recovery/)。
- [proposal](../../openspec/changes/improve-webui-navigation-and-local-recovery/proposal.md)、[design](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md)、[tasks](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md)。
- 全部 delta：[authenticated-mas-apps](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/authenticated-mas-apps/spec.md)、[devin-frontend](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md)。
- 相关主 spec：[authenticated-mas-apps](../../openspec/specs/authenticated-mas-apps/spec.md)。
- 前端能力尚在活动 lineage：[Devin 前端](../../openspec/changes/adopt-devin-frontend/specs/devin-frontend/spec.md)、[设置与命名](../../openspec/changes/correct-webui-settings-and-name/specs/devin-frontend/spec.md)、[指南采用](../../openspec/changes/adopt-webui-frontend-guidelines/specs/devin-frontend/spec.md)；归档顺序见新 tasks。
- 当前映射：[frontend state](../state/frontend.md)、[webui state](../state/webui.md)、[runtime state](../state/runtime.md)；来源与实施方法见[前端开发规范](../development/FRONTEND-GUIDELINES.md)。

2026-10-24 用户在预览中指出 model/profile 与凭据控件粘连，并明确要求主动整检同类排版与 SVG 图标；后续采用固定标题 Title Case 与 Dictate 的 SVG 麦克风，扩展巡检同时补齐公共内容原语的默认呈现。采用范围与实测根因见 [design §6.2](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#62-2026-10-24-主次文字表单与-svg-图标整检)、[tasks §4.2](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#42-主次文字表单与-svg-图标整检2026-10-24) 及 [前端 delta](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md#requirement-compound-labels-and-forms-retain-typographic-separation)。这是已采用的呈现修正，恢复/路由的待确认范围保持独立。候选、RED/GREEN、实际矩阵及未完成的独立门禁见 [排版整检记录](../verification/WEBUI-TYPOGRAPHY-SVG.md)。

同日补报的首页直角焦点框已定位为内部 surface 的 focus-visible 描边，按真实 pointer/Tab 回归改到外层圆角卡片。用户提出的独立创建弹窗与 Session → Conversation 层级另在 [design §6.3](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#63-session--conversation-创建关系调查) 和 [tasks §4.3](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#43-session--conversation-创建方向2026-10-24) 承接；当前单 runtime 的 create 只创建 Conversation，不能将名称修正当作真实 New Session 已交付。

2026-10-25 后续两个按钮截图暴露发送组的外侧 Tab outline 被胶囊 `overflow:hidden` 裁切，已将各动作描边内移并保留首尾圆角；原卡片编辑器焦点与本修复分别验证。真实 RED/GREEN、空输入和 busy/Steer/Stop 矩阵及本候选门禁见[组合按钮焦点记录](../verification/WEBUI-SPLIT-BUTTON-FOCUS.md)，对应上述 design §6.2、tasks §4.2 与前端 delta。

2026-10-25 用户另要求 Model Selection 具有 Pi TUI `/model` 的检索索引体验；本批采用常驻模糊检索、候选循环高亮、Enter 确认、Escape 返回及位置计数，保持模型独立配置边界。直接来源、适配取舍与采用条件见 [design §6.4](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#64-2026-10-25-model-selection-检索索引)、[tasks §4.4](../../openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md#44-model-selection-检索索引2026-10-25) 和[模型索引 delta](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md#requirement-approved-model-selection-has-a-searchable-keyboard-index)。精确候选、真实 provider/浏览器回归、失败修正与预览见[模型索引验证记录](../verification/WEBUI-MODEL-INDEX.md)。

现场认证证据、默认 10 分钟/旧会话撤销的设计理由、单 writer、平台文件保护与未知交付的取舍集中在 design，不由本摘要替代。

2026-10-24 先采用 [Conversation/composer 状态可观测性 P0](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#61-2026-10-24-conversation-状态可观测性批次) 切片：真实 live/part 保形、按来源 Conversation 统一工具卡、禁用/停止原因及 receipt reason 指引。Sessions 行运行状态因 DTO 缺口另待协议变更，恢复入口和设置路由仍待确认。实现候选、复核修复及未完成的双评/GUI 门禁见 [P0 验证记录](../verification/WEBUI-INTERACTION-P0.md) 和 [逐项处置](../verification/evidence/webui-interaction-p0/review-disposition.md)，原调查终稿与渲染核对材料保留在调查目录 `D:\Projects\TempProjects\pakka-webui-investig\`。
