# 前端交互

详细场景见 [devin-frontend spec](../../openspec/changes/adopt-devin-frontend/specs/devin-frontend/spec.md)，形成记录及全部关联变更见[采用摘要](../changes/devin-frontend-adoption.md)。本页描述跨页面关系；服务字段与调用条件由对应领域细则维护。

## 基座与真实状态

pakka-webui 的对应原生界面行为以 [Devin 离线生产前端](https://github.com/mapleluvr/devin-ui-comparison/tree/ed20cec0aef82daa22aa50da19597b7ba1607e02/reference-dump)为绝对参考，页面操作及其适用条件由生产代码、真实 DOM 和相应运行证据确定。[视觉基座](https://github.com/mapleluvr/devin-ui-comparison/tree/ed20cec0aef82daa22aa50da19597b7ba1607e02/clean-room/current)提供页面结构、尺寸、留白和层级输入；Pakka 的 API、权限与真实状态绑定到对应事件和状态中。排版与交互质量采用[前端开发规范](../development/FRONTEND-GUIDELINES.md)及所保存的 Atlassian、Vercel 指南。

- shell 使用参考 app-shell、300px sidebar、primary navigation、Sessions、footer、hero/composer、conversation、menus/palette 和 settings-view。
- `apps/webui/web/reference.css` 保持参考 commit 的 Git blob 字节，UTF-8 LF，SHA-256 为 `084adce8bc6e1feab314b301f57ddac0bab5081cfa08d1c911addece9bdb9974`。
- 生产页的布局样式由参考基座及独立的产品附加样式组成。默认 shell/hero/导航/菜单几何取固定参考 CSS；产品附加样式承接认证、原生工具结果、专属字段、用户字体偏好、浏览器字号缩放与触控可访问性。
- 身份、会话、模型、目录、消息和状态来自实际授权响应。
- 页面切换、查看和筛选处理本地呈现与授权读取；模型输入由明确的发送动作提交。各页面操作使用同一资源与原请求身份、权限校验、native 调度和 unknown 核对契约。

## 页面与操作

| 位置               | 预期行为                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 组织/账号菜单      | 显示当前人类；提供获准的 People/invite/settings 与退出                                                                  |
| Primary navigation | 由已安装的工作区页面与通用命令入口组成                                                                                  |
| Sessions           | 真实列表、选择和当前 incarnation；搜索/归档/刷新进入 palette 或 options                                                 |
| 首页 composer      | 创建并打开真实 Conversation；显式 Send 提交模型输入；创建结果未确认时保持原请求核对状态                                 |
| Conversation head  | 实际标题和下方 cwd；管理动作收进精简 options                                                                            |
| 消息与工具         | 参考 message/avatar/byline/tool-card 结构，接入原生 history/live/receipt；保留 live、合法不可预览 part 和工具跨载体身份 |
| 模型按钮           | 列出宿主批准、当前角色可配置的模型；已有工作或队列时拒绝变更                                                            |
| cwd                | 入口为 Conversation 标题下的当前路径；选择器限定批准目录，仅 Use this directory 明确应用所选目录                        |
| Send caret         | 工作输入使用原生 Prompt/Steer/Follow up 调度；Team chat 使用独立的人类协作通道                                          |
| Palette            | 会话搜索、命令、主题和导航共用参考层级，保留键盘与焦点行为                                                              |
| Settings           | 左下角按钮单击进入独立配置页，默认 Appearance；页内分类导航连接配置、凭据、人员、通知和扩展                             |

设置页的 Conversation 分类在选中会话后可用，人员管理入口按管理员权限呈现。手机分类栏支持横向滚动。Back to app 返回原页面并保留会话和未发送草稿。详细场景及命名契约见[设置与命名 delta](../../openspec/changes/correct-webui-settings-and-name/specs/devin-frontend/spec.md)，采用记录见[变更摘要](../changes/webui-settings-and-name.md)。

模型/cwd 持久化、批准 roots、incarnation 和配置拒绝的详细条件由[开发契约](../development/WEBUI-DEVELOPMENT.md#独立选择模型和-conversation-工作目录)维护。

### Conversation 可观察状态

- 仅以授权 DTO 的 `live.busy`、`live.message`、`live.tools`、`entries` 和输入回执驱动工作呈现。进行中的消息以 `data-live=true`/`message-live` 区分；只有 busy 且存在该消息时，消息列末尾显示紧凑的 Streaming。合法但不支持内联预览的 `image/*` 以中性占位和 MIME 文本保留，不能静默消失；未知 DTO 仍由协议闭锁。
- 工具调用在 `toolCall.id`、`live.callId`、`toolResult.toolCallId` 三个载体间与来源 Conversation 组成同一键：历史用 `sourceConversationId ?? conversationId`，live 用当前 Conversation。卡片暴露 `data-source-conversation`，live 与持久声明并存时只显示一卡，live 状态取原 DTO，输出从同卡可读；找不到当前声明的结果保留有标识的孤儿卡。不同 Conversation/fork 的相同 ID 不跨域合并；更新与分页保留已展开卡片，流式 toolCall 初次落盘也维持同型父层及调用键。原生结果 `isError:true` 在折叠卡内仍以显式 error 标记可辨，不靠颜色单独表达。
- Send 禁用保持原判定并分别说明只读、提交中、视图未就绪和 Prompt 生成中原因。原生 Stop 在发送组主位；停止请求不代替 `busy=false` 的实际结束，持续忙碌提供有界再次停止。Steer/Follow up 的原生调度不被串行化。
- receipt 保留原生 reason；只有 `reason:"blocked"` 以 blocked 和指导修改输入呈现，`aborted` 表示撤回，其他未回答统一中性 not delivered，不从自由文本 reason 猜测 policy refusal 或撤回；reason 缺省时不伪造属性值。`unknown` 以 needs review 和指导先核对呈现，保留原状态及请求身份。blocked 不是权限 denied。本批不改变回执清除时机。
- Sessions 行运行状态不能由只有 `version`/`archived` 的列表 state 推导；所需协议与服务扩展另行变更。此切片的形成记录与范围见[逐页调优设计](../../openspec/changes/improve-webui-navigation-and-local-recovery/design.md#61-2026-10-24-conversation-状态可观测性批次)。

## Team

Team 是 MAS 工作区页面，与工作台共享界面语言、导航和输入组件。数据与操作条件见 [MAS](mas.md)。

1. Team 从主导航直接进入；共享 sidebar，采用单层页头和 **Graph / Activity / Agents** 视图切换。
2. Graph 使用中性色 surface、细边线、12px 圆角和 compact 图标。节点给出成员名、生命周期与至多两行摘要。
3. 创建与通信使用可区分的有向关系层；关系及显式回复关联取自授权 DTO。计数打开对应的 Activity 范围。
4. 桌面选择成员后在右侧约 320px inspector 展示身份、状态、来源和 **Open Conversation**；次要动作收在 More/Management。快捷输入复用 compact composer 与 native send-caret。
5. 手机 inspector 使用受控底部面板；视图切换在可用宽度内保持同一层级。成员列表和键盘提供等价路径；拖动把手处理布局移动，成员导航目标处理打开动作。
6. 打开成员进入完整 Conversation；返回 Team 保留选择、视图与个人布局。Activity/Agents 与画布共享真实数据，查看和筛选使用授权读取。
7. View options 的隐藏/图层/位置作用于个人呈现；Retire 经过确认和当前权限检查后执行成员生命周期操作。denied 与 unknown 分别按拒绝和待核对状态呈现。
8. 页面分别呈现未选择、加载、空团队、撤权、失败和重连状态；inspector 随成员选择展示对应信息与当前获准动作。

Team 的动态 `board.css` 节点在加载、成功和失败之间保持同一身份。可操作 Board 的挂载以该样式成功 load 为前提；error 时显示可访问 alert 并保持闭锁。重新进入 Team 时同样校验样式就绪状态。

## 响应式与可访问性

- 页面按完整的实际 viewport 响应布局，覆盖桌面、360×600、390×650 和常规手机 390×844；默认最短手机目标为宽∶高 3∶5。
- 侧栏列表独立滚动；抽屉/弹层转换以目标入口可见且可操作为就绪条件。提示完整可读，字号变大后操作仍可达；目录确认区保持在可用屏幕内。
- 图标使用 SVG paths 与公共 Icon。常用图标清楚可见于 24px；独立图标控件有至少 44×44px 点击区域与可访问名称。
- 控件支持键盘操作与可见焦点；模态管理 focus trap/return，支持 Escape/Back 及关闭后焦点返回。导航交接后，关闭与清理只作用于所属弹层实例。
- unknown/pending 操作保留原身份及交互锁；重开后以原 request ID 进行只读核对。

配置页按页面标题、分区标题、控件正文和说明维护相对文字角色，随字体偏好及浏览器基准字号缩放。手机配置控件的触达高度至少为 44px，手机文字输入至少为 16px，并保留更大的阅读偏好。composer 的键盘焦点由输入框或所属输入分组给出可见指示。采用关系和后续差距见[指南变更](../changes/webui-frontend-guidelines.md)及其任务。

## 可检验条件

功能路径由实际服务的正向动作、原生结果与请求/效果计数支持；前端符合性由相同实际 viewport 的参考/候选直接检查、几何和完整差图支持。功能、视觉、安装与独立 GUI 各自满足[交付声明](delivery.md)中的条件。
