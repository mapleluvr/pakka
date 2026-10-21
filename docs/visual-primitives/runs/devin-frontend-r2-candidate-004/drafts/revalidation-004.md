# 候选 004：固定快照的再验证记录

本文件在验证后整理已执行事项，不补写事前视觉设计。继承原 R2 的 [接入草案](../../devin-frontend-r2/drafts/adoption-001.md)、[反馈草案](../../devin-frontend-r2/drafts/feedback-draft-001.md)和[原 verdict](../../devin-frontend-r2/verdict/inline-verdict-001.md)；参考身份见本轮 [oracle manifest](../oracles/oracle-manifest.json)。

## 保留的事实

- 前端主体采用指定 upstream commit 的真实结构、CSS 与 palette／Settings；不恢复旧工具栏来迁就选择器。
- 侧栏 300px；首页卡片 688×154；Commands 和 Extensions 改造保留。
- 数据、权限、模型请求和原生 unknown 语义来自 Pakka，不使用演示会话或伪后端。
- Team 没有上游页面 oracle，是同语言的新设计，不与首页做虚假像素比较。
- 不设排除框，不扩大 mask，不缩放截图强行对齐。

## 本轮修订与验证范围

Team 的异步 board.css 造成可操作目标在 CSS 到达时移动，已用真实 HTTP 挂起／503 测试先红后绿；相关源码固定在 6d359b1。手机创建的测试等待修订则只等待实际侧栏动画完成，没有取消产品动画。以上行为结果见 [R2 验证记录](../../../../verification/DEVIN-FRONTEND-R2.md)。本轮没有依据差图再改 shell 几何。

## 实测坐标

坐标采用 pixel、top-left、left-top-right-bottom。浏览器 DOM 测量：[home-desktop-geometry.json](../scripts/home-desktop-geometry.json)。

| 元素 | 实测 |
| --- | --- |
| Sidebar | 0,0,300,900 |
| Card | 526,373,1214,527；688×154 |
| Toolbar | x=539,y=486,w=662,h=28 |
| Hero heading | x=520,y=327,w=700,h=30 |

原草案的手工标注坐标不是本轮 DOM 测量的替代；1px 差异不靠修改 oracle 消除。

## 本轮判读与路线

直接检查与 highlight 点裁剪见 [本轮 verdict](../verdict/inline-verdict-003.md)。原反馈草案将 masked-diff 工具与独立 GUI 一起写为受阻过宽：本机 CLI 可用，已跑无排除框差图；独立 GUI 仍 BLOCKED。保留原历史，使用本轮记录纠正当前状态。

本机图未出现新的 fix-now 项；自动差图仍 feedback-required，不伪造 pass。后续在具备指定独立环境时执行实际 GUI／审查，产生新反馈后另写新 draft。
