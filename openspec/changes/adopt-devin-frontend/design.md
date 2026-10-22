## Context and formation record

This is a retrospective relocation of adopted decisions, not a claim that this OpenSpec change existed during R1/R2. Original source is retained by Git and the cleanup backup. Current behavior is in the delta spec; candidate outcomes remain in their fixed verification records.

# Devin 前端采用的形成与调整

## 记录的身份

本文件接入已有 R2 决策记录，来源是 `e7b7d7c:docs/plans/DEVIN-FRONTEND-ADOPTION-R2.md`，不是本轮重新征求的产品决定。用户明确的主从关系、代理形成的页面映射，以及 MAS 新页面的设计推导在原文中分别保留。

当前前端预期由 [frontend state](../../../docs/state/frontend.md)维护；当前工作由[本 change 的 tasks](tasks.md)承接，候选结果见 [R2 记录](../../../docs/verification/DEVIN-FRONTEND-R2.md)。下面“当前候选”和实施顺序是来源文件的当时记录，不作为今天的待办。

## 选择与依据

- 用户给定参考仓库并否定旧 WebUI 换皮；原型的结构和交互作为主体，真实后端与安全语义保留。
- R1 的功能证据只证明所测路径，不能证明界面采用方向。R2 保留其历史失败/通过身份，而不在旧页面继续叠覆盖规则。
- 参考没有 MAS 页面；Team 的三视图、inspector 和 compact composer 是采用同套界面语言的设计，不是用户提供的 Devin 功能样本。
- 本轮把这些内容分为可直接实施的声明与形成记录；没有将未来浏览器或 GUI 结果补写成当时决策的依据。

## 来源文件

## R2：接入 Devin-like 前端，而不是给旧 WebUI 换皮

### 决策与当前状态

当前固定源码候选为 `6d359b1`；R2 主体接入与 Team 重建已实现，但完整验收仍失败／受阻，不等于可合并 main。具体数字、原始日志、安装补测和独立 GUI 边界见 [R2 验证记录](../../../docs/verification/DEVIN-FRONTEND-R2.md)与[候选 004 交付复核](https://github.com/mapleluvr/pakka/blob/200af506913ee38d7a357e5da96ea5e2afc03d67/docs/visual-primitives/runs/devin-frontend-r2-candidate-004/final/delivery-review.md)。

用户再次明确迁移方向：以 `mapleluvr/devin-ui-comparison@ed20cec/clean-room/current` 为前端主体，Pakka WebUI 提供接口、权限和真实状态；对前端只做必要的字符串、元素及事件／状态绑定适配。不把原型改造成旧 Pakka WebUI 的形状。

`32d0d5f` 及其产品源码 `fe02dd2` **不符合这个迁移目标**。它的真实功能测试可证明相应调用路径存在，但不能证明界面采用正确；旧记录里的 NOT_FULLY_ACCEPTED 也不能解释为“只差几项测试就完成迁移”。旧 MAS 演示在新外壳中嵌入旧 Board，是此次方向错误的直接例子。

本文件替代 R1 计划中的产品映射。保留旧提交和日志用于回溯，不覆盖或改写历史测试数字。实现继续在 `feat/devin-like-frontend` 独立 worktree，main 不动。

### 前端主从关系

- **保留主体**：参考的 app-shell、sidebar-header / primary-nav / sessions-area / footer、hero / composer、conversation、menus / palette、settings-view，以及它们的原始尺寸、留白、层级和响应式切换。
- **接口适配**：将公共 Pocket client、SSE、扩展注册与实例生命周期接入这些位置；身份、Conversation、模型、目录、状态、消息均取实际响应。
- **元素级变化**：替换产品名、用户名称、模型与目录；真实会话替代演示会话；导航项绑定已安装能力；缺失能力删除对应元素或明确 unavailable，不虚构 Devin 服务。
- **不再采用**：旧 layout/window/pane/topbar、侧栏常驻搜索／归档／刷新／新建表单、横排全功能按钮、在扩展页上再套同名标题框。不能依靠 pocket.css → workbench.css → devin.css 的覆盖链继续逼近外观。
- 交互与授权分离：移走按钮不移走服务端权限；重做展示不重写 native Prompt / Steer / Follow up、requestId、receipt、unknown reconciliation 或 incarnation 语义。

CSS 以参考 `styles.css` 为独立基线。Pakka 专属字段、认证与工具结果的附加样式单独列出；不得在其中偷偷改变参考 shell／hero／导航／菜单的几何。

### 页面与 API 对应

| 参考位置                  | 真实接入                                            | 适配约束                                                                                                                      |
| ------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 组织触发器及菜单          | 当前人类、角色、People／invites、退出               | 不在侧栏顶部新增身份信息条                                                                                                    |
| Primary navigation        | 已安装工作区页面、命令／扩展入口                    | 仍是相同 nav-row，不再做第二套旧插件导航区                                                                                    |
| Sessions / Recent         | `list` 结果、选择与精确 incarnation                 | 搜索／归档／刷新进入 palette 或 session options，不常驻堆叠                                                                   |
| 首页 composer             | 真实创建入口及明确提交动作                          | 保留 textarea 与 toolbar；不改成单行“会话名称”表单。显式 Send 才允许模型工作；创建 unknown 时只查原请求，不自动重发或继续提交 |
| 模型 chip                 | 宿主批准模型                                        | 不提供 Balanced/Ultra 等虚构档位；工作中拒绝变更                                                                              |
| Conversation head         | 实际标题与 cwd、精简 options                        | cwd 留在标题下；管理项放菜单，不摊成旧工具栏                                                                                  |
| Conversation messages     | native history、reasoning、tools、live SSE、receipt | 使用原型 message/avatar/byline/tool-card 结构，不搬旧 transcript 外框                                                         |
| Send caret                | Prompt / Steer / Follow up / Team chat              | 是原生模式选择，不将 steering 串行化。人类聊天不进模型                                                                        |
| Palette                   | 会话搜索、命令、主题、导航                          | 保留 palette 的视觉和键盘层级，不用旧通用大 Sheet 替代                                                                        |
| Settings                  | Appearance、配置、凭据、人员、通知与扩展设置        | 使用原型独立 settings-view 与分组卡片，不把所有设置塞回旧右侧面板                                                             |
| PR / 升级／仓库等占位元素 | 没有对应后端则删去                                  | 不为填满参考画面编造组织、套餐、PR 或配额                                                                                     |

### MAS Board：同一套界面语言的新页面

参考没有 MAS 页面；以下是 Pakka 的新设计，不声称复制 Devin 已观察功能，也不以旧 Board 为布局模板。

#### 信息架构

1. Primary navigation 的 **Team** 直接进入工作区页面。保留同一 sidebar；主区不出现额外“Commands & extensions”顶栏，也不再套宿主 `MAS team` 标题框后重复插件标题。
2. 单层页面头：左侧 Team 名称／实际 namespace，右侧紧凑 segmented **Graph / Activity / Agents**、view options。消除 Graph/Log 下再叠 Canvas/List 的两层控制栏。
3. 默认 Graph：占用剩余主区的静谧画布，卡片使用同套中性色 surface、细边线、12px 圆角、Inter 与 compact 图标；不是旧方框堆叠。成员名、生命周期状态、最多两行摘要，不把完整回复放进卡片。
4. Creation 为安静实线，communication 为 accent 有向线；条数 badge 选择后可进入过滤后的 Activity。只有实际授权 DTO 才画边，不从文本猜测关系。
5. 单击成员显示右侧 inspector（桌面约 320px、同背景与细分隔线）：身份与实际状态、**Open Conversation** 主动作、上下文摘要；次要管理项在 More 中。没有默认展开的多层 details 与第二套 composer。
6. 真正对话仍进入同一 Conversation 页面；返回 Team 保留视图与选择。若提供快捷输入，必须复用 compact composer 及 native send-caret，不另造旧式 select + Send 操作表单。
7. Agents 是同一数据的紧凑列表；Activity 是带 source / target / receipt 状态的行列表，选择边／成员只改变过滤，不发新模型请求。
8. 窄屏 inspector 为受控底部面板；Graph / Activity / Agents 在同一行且不制造横向溢出。回退、Escape、焦点返回与拖动 handle 各有明确作用；不能拖动吞掉打开会话的点击。

#### 操作与状态

- View options 收纳边层、个人隐藏与视图重置；这些只有个人视图效果。隐藏不等于 retire，不取消已接受任务。
- 生命周期与 native busy 分开显示：available 不等于所有工作都结束；unknown 必须是独立、可核对状态。
- Retire 在 member More 菜单，明确影响并确认；只对当前有权限的人显示。拒绝与 unknown 不改成本地“成功”。
- 未选择／加载／空团队／权限撤销／失败／重连均有设计状态，空态只有真实可用动作，不展示演示成员。
- 同一主体的 API、授权、资源身份、请求与回执语义不变；只改展示与操作入口。

### 实施与验收顺序

1. 建立独立的 R2 浏览器回归：参考主结构与实际几何、单个主输入卡片、折叠／抽屉、palette 焦点及真实调用边界。先对 R1 运行，记录正确失败。
2. 从参考结构和 CSS 接入 shell／首页／会话／palette；删除生产 HTML 对旧布局 CSS 的依赖，不继续叠覆盖。
3. 将真实设置内容放入参考 Settings 路由；扩展菜单与页面直接使用新导航和页面容器。
4. 按本文件做 MAS 新页面与状态，不直接复用旧容器；用真实 MAS + 本地确定性 provider 验证 lineage、消息、打开与返回、视图操作无副作用、撤权和 unknown。
5. 相同视口逐页直接看参考和候选，保存结构／几何与截图差异。功能测试、视觉符合性、独立 GUI 与安装门禁分别报告，任何一个不能代替其他项。

已有 baseline 的 Windows EPERM／bad port／浏览器 unknown 仍保留原状态，不在此次界面重建中随手改安全语义，也不把旧失败当新迁移通过的理由。
