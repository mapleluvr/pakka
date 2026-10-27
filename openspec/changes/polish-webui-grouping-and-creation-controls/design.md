## Context

见 [proposal](proposal.md)。已封存的创建产品为 `440e9cc`，文档/原始证据截至 `0758992`；新变更不重开 Session 生命周期设计。用户截图 1 是 `.navigation-tools select` 的系统展开层，截图 2/3 是首页创建动作。现有 `frontend.js` 导出 `Menu`，已有账号、Conversation、输入模式等消费者；其定位、主题 `.menu/.menu-row`、外点/Escape 关闭及焦点返回可以复用。`reference.css` 保持固定字节，工作在附加样式中进行。

## Goals / Non-Goals

本变更使这一个分组控件复用已存在的工作台菜单，并使首页两个入口无视觉主次。保留已有服务、个人导航版本/unknown 和两个专用向导；配置表单其他 select 的批量替换不在本批范围。按 note48 不运行独立复核，普通 browser 不充当指定独立桌面验收。

## Decisions

1. **复用已有 Menu 与菜单行**，不安装组件库或复制另一套 popup。分组组件保留自己的两个选项及 `apply({kind:"mode"})`；只有确认另一个值才更新，打开/键盘浏览/取消只改 UI。禁用和 unknown 仍由原有 blocked 控制。Menu 只补可选初始焦点与正常 Tab 离开支持；默认消费者原来的定位、外点/Escape 和关闭回返保留，分组 radio 的上下/Home/End 导航由该控件处理。
2. **首页创建动作组成同一小组**，两者同型透明按钮、SVG 24px、至少 44px 触达；灰色短竖线是 aria-hidden 的 CSS 装饰，不是字符图标或第三个控件。保留独立的 Commands 图标入口，窄屏时维持创建组及竖线的关系，允许标签按词换行。全局 `.button/.pill-btn` 和创建表单提交按钮不受外观改动影响。
3. **独立证据**：上轮的图文中心修正已完成，本轮继续保留该测量；新增真实浏览器 RED 固定系统 select、单边色块和缺失分隔。选择、刷新、取消、触屏宽度、dark/light 与 20px 都走真实 `startPocket`，本地 provider 确认无额外推理。共享 Menu 现有消费者加入焦点/Tab 回归。

## Risks / Trade-offs

- 自定义菜单比 native select 多承担键盘与焦点职责 → 测量实际焦点、当前选择、Esc/Tab 和真实持久化，不能仅断言类名。
- 手机与大字号挤压创建组 → 以实际图文中心、分隔线位置、命中区和横向溢出断言及截图约束，而不是只改 padding。
- 菜单复用涉及 frontend 的既有模块引用关系 → 沿用当前消费者方式，不为此建立新组件体系；若实际循环初始化失败，再按真实错误最小处理。

## Migration Plan

静态资产随当前 WebUI 包整体交付，不迁移数据或修改协议。通知 service worker 不缓存应用资产，本轮没有新增缓存列表。原有创建候选/证据保留；新快照单独构建、测试和预览。`devin-frontend` 主 spec 尚未由前置活动 lineage 归档，保留本 change 活动状态，先完成产品而不提前生成残缺主 spec。
