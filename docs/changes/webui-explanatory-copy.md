# UI 文案精简与情境化反馈

用户以首页 `Send work only after the Conversation is ready.` 发起全仓文案调查，后授权执行 D1–D13 与 Q1–Q8 推荐，并纠正回答中引入项目不存在的产品术语。采用的工作是删去重复教学，以短名称/状态或按需信息承载实际范围和后果，不添加新的产品实体。

- [change](../../openspec/changes/simplify-webui-explanatory-copy/)、[proposal](../../openspec/changes/simplify-webui-explanatory-copy/proposal.md)、[design](../../openspec/changes/simplify-webui-explanatory-copy/design.md)、[tasks](../../openspec/changes/simplify-webui-explanatory-copy/tasks.md)。
- 全部 delta：[devin-frontend](../../openspec/changes/simplify-webui-explanatory-copy/specs/devin-frontend/spec.md)。对应主 spec 尚在活动谱系：[采用](../../openspec/changes/adopt-devin-frontend/specs/devin-frontend/spec.md)、[设置](../../openspec/changes/correct-webui-settings-and-name/specs/devin-frontend/spec.md)、[规范](../../openspec/changes/adopt-webui-frontend-guidelines/specs/devin-frontend/spec.md)、[交互/创建](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md)、[菜单/创建入口](../../openspec/changes/polish-webui-grouping-and-creation-controls/specs/devin-frontend/spec.md)；按前置谱系归档，不提前创建残缺主 spec。
- 采用预期：[frontend state](../state/frontend.md#文案与操作信息)；来源调查：[完整审计及 source manifest](../verification/WEBUI-COPY-AUDIT.md)。

人类通道统一 People Chat/Shared Notes，沿现有 collaboration API 和 chat 模式；项目中既有 MAS 页面不因一句错误的类比被改名或扩展。服务器/设备的短标签、密钥 Session 范围、监听时服务来源、默认收起的额度/Webhook 说明及动作反馈，分别落在实际相关位置。定时工作以 Inputs Submitted 描述提交而非模型完成；不改变原始 state 或副作用。保留未知、部分成功、冲突、截断、真实权限和秘密后果，不新增 ACL 或模型许可。

前一个菜单样式 change 保持独立记录；最终候选需同时跑真实 UI 与完整契约回归。执行状态/失败和固定结果由 tasks 和[版本验证记录](../verification/WEBUI-COPY-SIMPLIFICATION.md)承接。按本会话决定不安排独立复核，独立 desktop 缺失时仍为 BLOCKED。
