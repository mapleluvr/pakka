# 分组菜单与首页创建入口

2026-10-27 用户以三张实查截图要求分组下拉复用既有菜单、修正 New Conversation 图文对齐，并使首页 New Conversation / New Session 均无圆角色块、由灰色短竖线分隔。用户确认后要求先提交已有创建方案，再另起本变更。

- [change](../../openspec/changes/polish-webui-grouping-and-creation-controls/)、[proposal](../../openspec/changes/polish-webui-grouping-and-creation-controls/proposal.md)、[design](../../openspec/changes/polish-webui-grouping-and-creation-controls/design.md)、[tasks](../../openspec/changes/polish-webui-grouping-and-creation-controls/tasks.md)。
- 全部 delta：[devin-frontend](../../openspec/changes/polish-webui-grouping-and-creation-controls/specs/devin-frontend/spec.md)。
- 对应主 spec 尚未归档；前置活动谱系为 [adopt-devin-frontend](../../openspec/changes/adopt-devin-frontend/specs/devin-frontend/spec.md)、[设置与命名](../../openspec/changes/correct-webui-settings-and-name/specs/devin-frontend/spec.md)、[前端指南](../../openspec/changes/adopt-webui-frontend-guidelines/specs/devin-frontend/spec.md)、[创建与个人导航](../../openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md)。本变更依这些谱系之后归档，不先生成残缺的同名主 spec。
- 当前预期：[frontend state](../state/frontend.md#创建与导航)，开发规范：[frontend guidelines](../development/FRONTEND-GUIDELINES.md)。
- 用户原图：[1](../verification/evidence/webui-navigation-controls/user-1.png)、[2](../verification/evidence/webui-navigation-controls/user-2.png)、[3](../verification/evidence/webui-navigation-controls/user-3.png)。

已有创建代码及固定门禁在 `440e9cc`，完整证据归档截至 `0758992`，见[创建记录](../verification/WEBUI-SESSION-CREATION.md)。其中图文错位已有真实 RED/GREEN；本变更保留其断言，并单独落实菜单复用、入口平级与分隔线。现有 Menu 的定位/外点/Escape/回返继续复用，分组选择仍是相同个人导航操作，Session 原生归属、资源授权、额度、模型输入与 unknown 处理不变。

采用后差距和执行结果由本 tasks 与[固定版本验证记录](../verification/WEBUI-NAVIGATION-CONTROLS.md)承接；不以本摘要或完成清单冒充真实浏览器通过。按操作者 note48 不安排独立复核；指定独立桌面工具不可用时保留 BLOCKED。
