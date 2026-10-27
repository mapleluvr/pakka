# Invite Role 主题菜单补齐

用户在 `2dbccff` 之后实查 People & Invitations 指出 Invite Role 仍为原生 select，授权同理变更。本轮只补该字段，不把先前分组菜单记录回写为已覆盖它。

- [change](../../openspec/changes/polish-webui-invitation-role-menu/)、[proposal](../../openspec/changes/polish-webui-invitation-role-menu/proposal.md)、[design](../../openspec/changes/polish-webui-invitation-role-menu/design.md)、[tasks](../../openspec/changes/polish-webui-invitation-role-menu/tasks.md)。
- 全部 delta：[devin-frontend](../../openspec/changes/polish-webui-invitation-role-menu/specs/devin-frontend/spec.md)。对应主 spec 仍在活动谱系：[采用](../../openspec/changes/adopt-devin-frontend/specs/devin-frontend/spec.md)、[设置](../../openspec/changes/correct-webui-settings-and-name/specs/devin-frontend/spec.md)、[前端规范](../../openspec/changes/adopt-webui-frontend-guidelines/specs/devin-frontend/spec.md)、[分组/创建控件](../../openspec/changes/polish-webui-grouping-and-creation-controls/specs/devin-frontend/spec.md)、[文案](../../openspec/changes/simplify-webui-explanatory-copy/specs/devin-frontend/spec.md)。按前置谱系顺序归档。
- [frontend state](../state/frontend.md#创建与导航) 与本地计划同步。角色仍为原四种，沿用邀请命令、一次性 redeem、scope/ttl 和服务器授权；没有模型输入。产品/测试候选 `ba2b2f0` 的受影响 9/9、完整 666/664 pass/0 fail/2 skip，及保留的 RED/样式覆盖失败、来源身份和新 45010 预览见[固定验证记录](../verification/WEBUI-INVITATION-ROLE-MENU.md)。旧 45009 资产保持原始 bytes。

采用现有 Menu 与 Icon，不追加控件体系或新权限层；同页仅该角色字段是下拉，其他页面 select 不在本轮声称完成。

后续用户指出短角色值不应占满整行：在 `c7a9bf3` 之后采用 Appearance 式左标签/右侧紧凑控件、内容适宽且不窄于按钮的右缘菜单。由[design 后续纠偏](../../openspec/changes/polish-webui-invitation-role-menu/design.md#后续布局纠偏基线-c7a9bf3)与[tasks 第4节](../../openspec/changes/polish-webui-invitation-role-menu/tasks.md#4-紧凑同行布局纠偏)承接，新候选 `e447e82` 受影响 6/6、全量 666/664 pass/0 fail/2 skip，build/check 通过。截图/三项 RED/原始日志和新 45011 预览的精确 bytes 复验见[紧凑布局记录](../verification/WEBUI-INVITATION-ROLE-MENU.md#后续appearance-式紧凑同行布局)；不覆盖 ba2b2f0 的旧图或通过结论，旧 45010 资产不变。
