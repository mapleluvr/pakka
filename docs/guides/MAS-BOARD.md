# MAS Board 使用

MAS Board 由 `@pakka/mas-devpack` 的 Backend、WebUI 和 Client facets 提供。宿主显式启用这些 facets 并组装 MAS 服务后，侧栏的 Extensions 中出现 **MAS team**。界面沿用当前 Appearance 字体、字号与配色。

## 关系画布与成员列表

打开 **Graph** 后，直角卡片表示当前获准查看的 Agent，即对应的 Conversation。卡片名称来自 MAS 成员 key。创建连线按持久化创建记录绘制；选中节点的详情分别列出 **Created by**、**Managed by** 和 **History from**。旧记录缺少创建信息时显示 **Unknown**；被权限过滤的来源不会出现在详情或连线上。

成员的 **Available** 表示可用性。卡片的活动区域另从 Pi 运行观测显示：

| 观测               | 卡片内容                                     |
| ------------------ | -------------------------------------------- |
| 正在等待模型       | Waiting for Model Response                   |
| 公开 thinking      | Thinking... 与原文前段                       |
| 工具调用           | Tool using、工具名与对应 callId 的参数前段   |
| 回复或最近一条回复 | 回复原文前段                                 |
| 模型请求失败       | 提供者原文原因；提供结构化状态码时显示实际码 |
| 已确认会话故障     | Conversation crashed                         |
| 尚无活动           | No activity yet                              |

活动片段有长度上限，完整内容在 Conversation 中。生成完成的回执保持其原生含义；应用回复由显式回复关联标明。

**View options** 中可搜索成员、筛选可用性、分别开关创建和通信图层，并调整缩放。鼠标拖动画布空白处平移；触屏可滚动画布。节点的移动把手可拖动，也可聚焦后用方向键移动。**List** 提供成员列表；**Reset layout** 恢复自动布局。节点位置、缩放、图层、选中项和隐藏关系按当前浏览器、人员与工作区保存。

通信边按发送方向聚合，计数对应可见的持久消息。点击计数或边可打开该方向的交流记录。选择边后可以 **Hide this link**；选择 Agent 后可隐藏该 Agent 的通信线。**Show hidden links** 恢复隐藏关系。隐藏仅影响个人视图，消息投递、历史和额度继续遵循原有契约。新成员及新通信仍可从画布和日志中发现。

退役节点选中后提供 **Hide from Board**，可将该节点及其关联线从个人画布和列表收起。**View options → Show hidden Agents** 显示隐藏数量并恢复节点。偏好绑定当前人员与 Board 的 Session，刷新或切换 Conversation 后继续保留；**Log** 和完整 Conversation 的历史仍可读取。服务重开保持退役状态和历史，不复活成员或重复此前输入。

画布有明确的展示上限；达到上限时提示该范围，**Log** 仍可分页查看完整的获准交流记录。

## 进入 Conversation 与 Agent controls

选中节点后，**Open Conversation** 打开现有完整对话界面。历史读取、输入、原生队列、模型与工作目录继续执行当前人员和资源权限。标题处的 **Back to MAS team** 返回 Board，恢复选中项与布局。

**Agent details** 展示来源并提供 **Agent controls**。控制界面通过独立弹层打开，Board 保留原选中节点和布局；正文独立滚动，顶部关闭按钮保持可达。点击关闭按钮、遮罩或按 Escape 返回 Board，键盘焦点回到打开入口。弹层提供 prompt、steer、followUp、真实 incoming receipt 的 reply，以及获准的 Stop、Retire；原 Conversation 草稿保持原样。

操作结果未确认时，面板锁住新操作。关闭并重开后可用 **Check original operation** 继续只读核对原请求。核对不会自动重发输入；关闭界面也不会撤销已经接纳的工作。

## 交流日志

**Log** 按持久化顺序分页显示消息正文、实际时间、发送端、接收端、模式、发起方式、回执状态和显式回复关联。人类经某 Agent 发送的消息保留该通信端点，同时标为 **Human**。

**Exchange filters** 支持发送端、接收端、prompt／steer／followUp、发起方式、回执状态和正文搜索。**Load more exchanges** 读取更早的一页。隐藏连线的消息继续存在于日志中。

只有发送端和接收端都处于当前可读范围的交流才会返回。Viewer 的日志读取独立于发送权限。列表、搜索、游标和数量都使用同一过滤后的范围；撤权在异步读取完成后再次检查。

## 装配与范围

启用方式沿用 [DevPack API](../reference/MAS-DEVPack-API.md) 的可选 facets 和 `masWorkbenchService`。业务 Agent 的工具仍由批准 profile 单独装配。普通 Conversation 的新建和归档继续使用工作台入口；实际删除仍受独立的删除契约约束。

设计依据见 [MAS Board 第二稿](../MAS-BOARD-DESIGN.md)，实现与验证状态见 [实施记录](../verification/MAS-BOARD-R1.md)。
