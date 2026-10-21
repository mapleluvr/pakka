# MAS Board / Team 使用

宿主显式安装 MAS DevPack 的 Backend/WebUI/Client facets 并组装 MAS 服务后，从主导航 **Team** 或 **Commands & extensions → Pages** 进入。界面与 Agent tools 分别装配；没有安装该贡献时，普通 Conversation 工作仍可使用。

当前页面采用 Devin 风格的单层 Team 页头和 **Graph / Activity / Agents**，不再查找旧 Extensions → MAS team、Graph/Log 或 Canvas/List 工具栏。页面预期见[前端声明](../state/frontend.md#team)，当前验证范围见 [R2 记录](../verification/DEVIN-FRONTEND-R2.md)。

## 关系画布与成员列表

**Graph** 用卡片显示当前可读 Agent 对应的 Conversation；**Agents** 是同一数据的成员列表。选择成员后，桌面右侧 inspector、手机底部面板展示身份、当前状态和来源。Created by、Managed by、History from 分开说明；旧记录缺失则保留 Unknown，不从 owner 推断创建。

Availability 表示成员可用性，活动摘要另取原生观测：公开 thinking、工具名和对应 callId 参数、实际回复或公开错误。没有结构化 HTTP 码时不会合成一个；完成回执不等于应用回复。完整内容从 Conversation 读取。

**View options** 提供搜索、成员阶段过滤、创建/通信图层、缩放和 Reset layout。鼠标拖画布空白处平移；节点移动把手可拖动或用方向键。位置、图层、选择和隐藏偏好按当前浏览器、人员与数据源保存。

通信边按方向聚合可见持久投递；点击计数进入相应 **Activity**。选择边可 Hide this link；成员 **More** 可 Hide communication links。View options 的 Show hidden links 恢复关系。退休成员可从个人 Board 隐藏并恢复；这些动作不改变原通信、成员生命周期或历史。

画布有明确上限，Activity 可按授权范围继续分页。加载期间先显示状态；若 Board 样式加载失败，页面显示错误而不开放未就绪控件。

## 进入 Conversation 与 Agent controls

选择成员后点击 **Open Conversation** 进入同一完整对话，模型、cwd、输入和历史仍执行当前资源权限。会话页返回 Team 后保留选择和个人布局。

**More → Member controls…** 打开成员控制界面。输入区采用 compact composer，原生模式由发送旁的菜单选择 Prompt/Steer/Follow up；对实际 incoming peer receipt 可输入正文后 Reply。权限不足的动作不会因打开面板获得授权。

控制界面的 **Management** 提供当前获准的 Stop work 和 **Retire member…**，退休需进一步确认。创建成员由实际 Agent 工具或宿主批准的服务路径发起；不要在 Management 中寻找并不存在的新建表单。

结果未确认时新操作保持锁定。关闭后重开可 **Check original operation** 只读核对原请求，不重新发送，不把关闭当撤回。源 Conversation 的草稿不因观察 Team 被替换。

## 交流日志

**Activity** 按持久顺序分页显示正文、实际记录时间、发送/接收、模式、发起方式、原生回执状态和已保存回复关联。人类经某 Agent 发送仍保留该端点，同时显示 Human；相邻消息不自动配为问答。

Exchange filters 支持方向、模式、发起者和状态，Search 筛选可读正文，Load more exchanges 读取更早记录。隐藏画布连线不隐藏其获准日志。

服务端要求两端都在当前可读范围，先过滤再发布列表、搜索、游标和数量；Viewer 读取不获得 send/reply。异步读取完成后再次检查权限。

## 装配与范围

使用 [DevPack API](../reference/MAS-DEVPack-API.md)的可选 facets 和 `masWorkbenchService`；模型工具由批准 profile 单独启用。只停用 WebUI 不删除 members、history 或已接纳工作。

普通 Conversation 归档/恢复与 MAS retirement 不是物理删除。[MAS state](../state/mas.md)维护资源和观测关系；[设计旧稿](../MAS-BOARD-DESIGN.md)只作来路，[既有实施记录](../verification/MAS-BOARD-R1.md)保留其版本证据，不能代替 R2 的结果。
