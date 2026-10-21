# 前端交互

详细场景见 [devin-frontend spec](../../openspec/changes/adopt-devin-frontend/specs/devin-frontend/spec.md)，形成记录及全部关联变更见[采用摘要](../changes/devin-frontend-adoption.md)。本页维护跨页面关系与细则映射，不记录验收进度。

## 基座与真实状态

Pakka-Pocket 以 [Devin 参考](https://github.com/mapleluvr/devin-ui-comparison/tree/ed20cec0aef82daa22aa50da19597b7ba1607e02/clean-room/current)的页面结构、尺寸、留白、层级和交互为主体，把 Pakka 的 API、权限与真实状态绑定到事件和状态中。适配限于必要的产品字符串、元素和真实能力接入，不以保留另一套控件堆叠为前提改造参考壳层。

- shell 使用参考 app-shell、300px sidebar、primary navigation、Sessions、footer、hero/composer、conversation、menus/palette 和 settings-view。
- `apps/webui/web/reference.css` 保持参考 commit 的 Git blob 字节，UTF-8 LF，SHA-256 为 `084adce8bc6e1feab314b301f57ddac0bab5081cfa08d1c911addece9bdb9974`；不格式化或用 CRLF 工作副本替换。
- 原型没有的认证、原生工具结果和专属字段使用独立附加样式。生产页不加载 pocket/workbench/devin 三层布局覆盖；附加样式不重新定义参考 shell/hero/导航/菜单的几何。
- 身份、会话、模型、目录、消息和状态来自实际授权响应。不填充演示成员、虚构套餐/配额、PR 或未接入服务。
- 切换页面和视图不产生模型工作。资源与请求身份、权限、native 调度和 unknown 核对不因换界面而改变。

## 页面与操作

| 位置               | 预期行为                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| 组织/账号菜单      | 当前人类、获准 People/invite/settings 与退出；不另堆身份条                                          |
| Primary navigation | 已安装的工作区页面与通用命令入口；不另建旧插件导航区                                                |
| Sessions           | 真实列表、选择和当前 incarnation；搜索/归档/刷新进入 palette 或 options                             |
| 首页 composer      | 创建并打开真实 Conversation；显式 Send 才提交模型输入；创建结果未确认时只查原请求，不自动重建或续发 |
| Conversation head  | 实际标题和下方 cwd；管理动作收进精简 options                                                        |
| 消息与工具         | 参考 message/avatar/byline/tool-card 结构，接入原生 history/live/receipt                            |
| 模型按钮           | 仅宿主批准、当前角色可配置的模型；工作中不变更，不虚构 Thinking 档位或登录发现                      |
| cwd                | 只从 Conversation 标题下进入批准目录选择器；浏览/关闭不应用，明确 Use this directory 才变更         |
| Send caret         | 原生 Prompt/Steer/Follow up 与独立 Team chat；steering 不串行化，人类聊天不进模型                   |
| Palette            | 会话搜索、命令、主题和导航共用参考层级，保留键盘与焦点行为                                          |
| Settings           | Appearance、配置、凭据、人员、通知、扩展使用独立页面与分组卡片，不塞入通用旧右侧面板                |

模型/cwd 持久化、批准 roots、incarnation 和配置拒绝的详细条件由[开发契约](../development/WEBUI-DEVELOPMENT.md#独立选择模型和-conversation-工作目录)维护。

## Team

Team 是使用同套界面语言的 MAS 页面，不声称来自已观察的 Devin MAS 功能。数据和操作边界见 [MAS](mas.md)。

1. Team 从主导航直接进入，同一 sidebar、单层页头和 **Graph / Activity / Agents** 切换，不叠 Graph/Log 与 Canvas/List 两套工具栏。
2. Graph 使用中性色 surface、细边线、12px 圆角和 compact 图标。节点给出成员名、生命周期与至多两行摘要，不塞入完整回复。
3. 创建与通信使用可区分的有向关系层；只绘制授权 DTO 支持的关系。计数能打开相应 Activity 范围，不从文本相似性猜回复。
4. 桌面选择成员后在右侧约 320px inspector 展示身份、状态、来源和 **Open Conversation**；次要动作收在 More/Management。快捷输入复用 compact composer 与 native send-caret。
5. 手机 inspector 使用受控底部面板；视图切换保持同一层级且不制造横向溢出。成员列表和键盘提供等价路径；拖动把手不吞导航点击。
6. 进入同一完整 Conversation；返回 Team 保留选择、视图与个人布局。Activity/Agents 与画布共享真实数据，查看和筛选不提交模型工作。
7. View options 的隐藏/图层/位置是个人呈现；Retire 是有确认、有权限检查的真实生命周期操作，不把 denied/unknown 改成成功。
8. 未选择、加载、空团队、撤权、失败、重连都有明确状态；不以默认展开的多层 details 和另一套表单替代 inspector。

Team 的动态 `board.css` 节点在加载、成功和失败之间保持同一身份。样式未就绪前不挂载任何可操作 Board；load 后才能挂载 Graph/Activity/Agents，error 时显示可访问 alert 并保持闭锁。重新进入页面同样受此边界约束，不能靠盲等或暴露未样式化按钮代替。

## 响应式与可访问性

- 桌面与手机按实际 viewport 响应；默认最短手机目标为宽∶高 3∶5，检查 360×600、390×650，并覆盖常规 390×844。页面不强制比例或裁切实际视口。
- 侧栏列表独立滚动；抽屉/弹层转换中，遮挡内容不应作为已开放入口。提示完整可读，字号变大后操作仍可达；目录确认区不落到可用屏幕外。
- 使用 SVG paths 与公共 Icon，不以 Unicode/emoji 代图标。常用图标清楚可见于 24px；独立图标控件有至少 44×44px 点击区域与可访问名称。
- 键盘、焦点可见、模态 focus trap/return、Escape/Back 与关闭后焦点返回有明确行为；清理旧弹层不能关闭刚打开的新页面。
- unknown/pending 操作保留原身份及交互锁；重开后只读核对，不通过分配新 request ID“恢复”。

## 可检验条件

功能路径使用实际服务和本地确定性 provider；外观以相同 viewport 的参考/候选直接检查、几何与无掩盖差图分别支持。必须保留正向动作、请求/效果计数和可归属的原生结果，不能仅以零请求证明功能存在。功能、视觉、安装与独立 GUI 是不同门禁，具体条件由[交付声明](delivery.md)维护。
