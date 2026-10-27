# WebUI 分组菜单与创建入口验证

## 范围与候选

基线 `0758992`，先前 Session 创建候选 `440e9cc` 的实现/结果由[原记录](WEBUI-SESSION-CREATION.md)承接。本轮独立变更复用现有 Menu、移除系统 select，并把首页 New Conversation / New Session 做成透明平级入口、中间灰色短竖线。sidebar 的现有选中样式不属用户三图中圈出的首页入口，不改其原生导航语义。

产品固定于 `04fcf4a`，测试补正 `59ff465` 对产品零 diff。构建、类型、受影响 41/41 及旧消费者补正 12/12 通过；首轮全量 664/656 pass/6 fail/2 skip，六项均为文案变更后旧断言，原失败及最小测试修正保留。`59ff465` 最终完整重跑 664 项：662 pass、0 fail、2 个既有 Windows 跳过项，exit 0；该候选 build/check 通过，不套用前一候选结果。

## 实测与失败

- 最初真实 browser RED：系统 SELECT 及 New Session 单边色块两项失败。20px 菜单文字另获真实 RED：行文字 13px，trigger 18.5714px；已改为相同 type token。
- 共用 Menu 的定位先于可见提交时，初始 focus 未落到真实行；改为可见位置提交后再聚焦，保留 Escape/Tab 的不同退出语义。
- 原菜单/分组/Sheet 相关 3/3，最终受影响组 41/41。覆盖 dark/light、1440/360/390、20px；实际 popup 与现有 org menu 的背景/前景/阴影/圆角相同，箭头/Home/End 只浏览，Enter/点击才持久化；Escape 不保存并回触发器，Tab 自然离开。两种投影/跨 Session 文件夹与刷新恢复仍走真实后端。
- 首页通过真实文字 Range 和 SVG bounds 检查中心、间距、24px 图标、44px 点击区、透明背景和分隔线；取消创建不留资源、不计模型请求。sidebar 遮挡截图的中间失败保留，修正取证的真实关闭步骤，不用隐藏 DOM 代替用户动作。

## 证据与边界

用户三图与初始首页图位于 [evidence](evidence/webui-navigation-controls/)。最终原始日志、JSON/PNG 和内容身份已同候选封存，见[逐件 manifest](evidence/webui-navigation-controls/manifest.json)与[公共 source snapshot](evidence/webui-copy-simplification/source-snapshot.json)；不把早期工作树截图或纯静态审计算作固定版本验收。新预览 `http://127.0.0.1:45009` 使用产品 `04fcf4a` 的独立数据/profile/本地 responder；15 静态资源精确匹配冻结 checkout hashes。Windows CRLF 与 canonical Git 的差异另行记录，不把两者混为 byte 相等。截图已实际读取：首页两个透明入口对齐且由灰色短竖线分隔，手机浅色菜单显示原有主题行及 SVG 勾选。

此轮只改前端/测试；不新增协议、ACL、依赖或另一套创建路径。按用户本会话指令不安排独立复核。指定 `agent-workspace-linux` 隔离桌面未检索到，独立 GUI 为 BLOCKED；ordinary browser 只是实际功能/几何及截图检查，不能冒充指定 GUI。

归属：[change summary](../changes/webui-grouping-and-creation-controls.md)、[proposal](../../openspec/changes/polish-webui-grouping-and-creation-controls/proposal.md)、[design](../../openspec/changes/polish-webui-grouping-and-creation-controls/design.md)、[tasks](../../openspec/changes/polish-webui-grouping-and-creation-controls/tasks.md)、[全部 delta](../../openspec/changes/polish-webui-grouping-and-creation-controls/specs/devin-frontend/spec.md)。同一最终候选的文案项另见[文案验证](WEBUI-COPY-SIMPLIFICATION.md)。
