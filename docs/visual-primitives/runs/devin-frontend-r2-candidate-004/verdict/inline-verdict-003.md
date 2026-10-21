# 候选 004：本机视觉核对

## Status

blocked（整体交付）；本机截图的直接检查未发现新的 fix-now 项。不是独立 GUI 验收通过。

## Source context

- 源码：`6d359b13d1b81c29f47495d303c1ed6afe4d0bb2`，固定运行开始时工作区干净。
- 参考及历史约束：`../../devin-frontend-r2/oracles/oracle-manifest.json`、同目录的 `../drafts/adoption-001.md` 与 `../drafts/feedback-draft-001.md`。保留既有主体接入决策，不改成旧 UI 换皮。
- 本轮截图：candidate-004/wide 的真实确定性浏览器用例；不是新造的静态样例。首页与 oracle 均为 1440×900；手机首页 360×600，Team 390×844。

## Blockers

- 指定 `agent-workspace-linux` 独立 GUI 环境当前不可用；本机截图和脚本不补位。
- 指定对抗审查 workflow 缺失。尚未完成独立人工/双边验收。
- 功能/安装门禁以 `docs/verification/DEVIN-FRONTEND-R2.md` 为准；这里的视觉观察不豁免任何失败。

## Fixes worth doing now

本轮直接检查中无新增项。已修复的 Extensions row/button 间距与 Team 样式就绪边界在当前源码保留。

## Diff interpretation

`diffs/home-desktop/summary.json`：1296000 像素全部计分，排除 0，mean 0.007233，338 个组件、0 个高差异条带。自动状态依然为 `feedback-required`，不自行改写。

按 component 面积前五名，用 `vp point` 在 oracle/rendered 的同一点裁剪并直接检查：

| ID | center (px) | 判读 |
| --- | --- | --- |
| 48 | 40,124.5 | 原型 Automations/Security/Review 等演示入口替换为真实 Commands、Sessions；未伪造未实现服务。 |
| 212 | 566.5,432 | 工作请求 placeholder 换成命名 Conversation；与“先创建、进入后显式 Send”的真实 API 语义相符。 |
| 2 | 65,23.5 | 演示 My Team 换成真实 Owner。 |
| 161 | 699,395 | 原型的无后端说明换成真实创建提示。 |
| 163 | 1163.5,395.5 | Prototype notes 换成真实 Sessions 入口。 |

另外直接检查全图热图及 688×154 同坐标卡片裁剪：移除未接入的首页模型、仓库、语音演示按钮与推广卡片造成局部差异；没有为减少分数隐藏它们。主侧栏宽 300px，卡片 x=526/y=373/w=688/h=154，toolbar x=539/y=486/w=662/h=28（本轮 DOM 测量归档）。这组观察支持“基座几何保持、内容做真实接入”，不证明所有差异均已被用户认可。

## Direct inspection

- `annots/rendered-layout.png`、`cropped/*home-card.png`、`cropped/*component-*.png`、`diffs/home-desktop/diff.heatmap.png` 已直接打开。
- `rendered/home-desktop.png`、`home-360.png`：参考卡片、提示语和发送组完整；无横向溢出。
- `rendered/team-desktop.png`、`team-mobile.png`：单层 Team 页头、Graph/Activity/Agents；手机 inspector 为底部面板，没有嵌回旧 Board 头部。
- `rendered/extensions-360.png`：Settings card/row，Disable/Reload 分离，无旧裸文本堆叠。
- `rendered/commands-360.png`：参考 palette；长命令换行，不越界。

## Accepted exclusions / mask problems

无排除框，没有掩码扩大，也未缩放截图强行对齐。原型没有 Team oracle，因此不对 Team 做伪像素等价比较。

## Route

保留本机直接检查记录，等待独立 GUI/审查环境；最终交付记录必须继续标明 BLOCKED。当前没有证据要求再改前端几何。若独立验收产生新问题，进入新的 feedback draft，不修改本轮历史。
