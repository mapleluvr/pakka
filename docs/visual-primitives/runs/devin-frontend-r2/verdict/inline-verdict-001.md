# R2 直接检查反馈 001：Extensions 行缺少参考组件样式

- 被检查源码：`f6e7f97b946684be542e77fda71abab71e5df60f`。
- 证据：`artifacts/devin-r2/fixed-adoption/palette/extensions-360.png`（360×600）；同轮桌面图为 `extensions-1440.png`。归档时需保持源图哈希；这是主代理直接检查，不是独立 GUI 验收。
- 在手机图 x=12–230、y=185–300 的登记列表内，标题／ready 状态和 Disable／Reload 裸按钮堆叠，后两个按钮没有间距。它能操作，但不是参考的 Settings card/row 组件，也不满足可读的触控区域。
- 修复目标：用参考 `.settings-card`／`.settings-card-row` 组织注册项；用已有 native-field 按钮语言，明确状态与动作分组，手机允许自然换行。不得改写 reference.css，不恢复旧 modal 或工具列表，不改动注册控制的权限或回调。
- 保留事实：首页几何、palette 结构、原生显式 Send、history slot 交接、Team 单页三视图的已验证约束不变。
- 不增加 mask 或排除区域。尚无可用的指定独立 GUI／正式 masked-diff 验收，不能把这次直接检查写成那些门禁通过。
- 路由：refining-with-feedback → drafts/feedback-draft-001.md → inline-replication。

固定候选的后续 wide 运行已在修改源码前主动取消；保留部分日志，不计算通过率。安装检查已经失败于旧 `.pocket-display` 选择器，原日志中实际卡片文字已显示；安装消费者必须另行沿新入口复测，而不是据此宣称安装通过。
