# MAS

## 成员、通信与控制

MAS 将同 Session 的 Conversation 注册为成员，并通过当前绑定身份、owner/grants 和可撤销 lease 提供通信及资源控制。communication、完整 transcript read、driving/steering 和管理权互不替代。

创建、readiness 与业务接纳分开表达；已持久创建但未就绪的成员不能收到业务工作。persistent、temporary、task-owned 与 background-owned 的寿命保留原生含义，退休停止接纳并按契约 drain/abort，保留历史，不等于物理删除。

相同 principal/source/request 与相同 payload/mode 核对原投递；冲突拒绝。queued、placed、generation 终态、应用回复和 unknown 不互相冒充。跨 Session broker 以固定批准 endpoint、enrollment/outbox 和原生目标接纳组成有界服务，不承诺任意远端 capability transport 或外部效果 exactly-once。

## 关系与活动观测

- 节点对应绑定数据源中的真实 Conversation；source/Session/Conversation 身份不因同名或相同 key 合并。
- 创建来源、管理来源和 fork 历史来源分别表达，不用 owner 或 principal 字符串猜创建线。
- 通信投影保留唯一投递、正文、顺序/时间、实际发起者和显式回复关联；旧资料缺失时标明 unknown/未记录。
- 读取双方交流要求当前两端 read authority；先过滤再搜索、计数和分页，异步发布前重验，不泄漏不可读端点。
- 成员 availability 与运行 activity 分开；公开 thinking、工具 callId/参数、回复和实际错误来自原生受控观测，不解析错误字符串合成 HTTP 状态或推断回滚。
- 进入完整 Conversation 由普通受授权资源打开链路完成，保留输入、历史、配置及返回选择，不为 MAS 绕开宿主权限。
- 个人布局、隐藏和筛选只改变呈现；不改变通信、任务、历史或已接受的操作。

## 可选贡献

Team 通过 MAS DevPack 的普通 Backend/WebUI/Client facets 提供，与非 MAS 扩展使用同一公共接口。Agent tools/instructions 由宿主另行选择；安装界面不自动激活工具。移除界面只清理自己的导航和订阅，不删除成员、历史或已接纳工作。页面的具体结构由[前端交互](frontend.md#team)维护。

## 契约定位

| 领域                        | 详细声明                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 同 Session 身份、接纳、寿命 | [MAS API](../reference/MAS-API.md)、[领域场景](../../openspec/specs/same-session-mas/spec.md)                |
| 跨 Session 与 worker        | [Broker API](../reference/BROKER-API.md)、[恢复场景](../../openspec/specs/recoverable-multi-session/spec.md) |
| DevPack Agent contribution  | [DevPack API](../reference/MAS-DEVPack-API.md)、[基础规范](../../openspec/specs/mas-devpack/spec.md)         |
| 可选 WebUI/Backend/Client   | [facet 补充](../../openspec/changes/pakka-pocket-webui/specs/mas-devpack/spec.md)                            |
| 关系、交流、实时活动与返回  | [关系工作台场景](../../openspec/changes/mas-board-relationship-workbench/specs/mas-devpack/spec.md)          |
