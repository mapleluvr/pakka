# MAS

## 成员、通信与控制

MAS 将同 Session 的 Conversation 注册为成员，并通过当前绑定身份、owner/grants 和可撤销 lease 提供通信及资源控制。communication、完整 transcript read、driving/steering 和管理分别校验对应权限。

创建记录表示成员已持久创建，readiness 表示原生就绪；业务接纳以就绪为前提。persistent、temporary、task-owned 与 background-owned 各自遵循原生寿命。退休停止接纳并按契约 drain/abort，成员历史继续保留。

相同 principal/source/request 与相同 payload/mode 核对原投递；冲突拒绝。queued、placed、generation 终态、应用回复和 unknown 分别表达投递阶段及确认情况。跨 Session broker 使用固定批准 endpoint、enrollment/outbox 和目标原生接纳，跨端传递冻结数据、逻辑引用与受控命令。输入投递按原身份去重和核对；provider、工具与文件系统效果由各自的效果域单独确认。

## 关系与活动观测

- 节点对应绑定数据源中的真实 Conversation；身份使用完整的 source/Session/Conversation 组合。
- 创建来源、管理来源和 fork 历史来源由各自的显式记录表达。
- 通信投影保留唯一投递、正文、顺序/时间、实际发起者和显式回复关联；资料缺失时标明 unknown/未记录。
- 读取双方交流要求当前两端 read authority；搜索、计数和分页使用已授权投影，异步发布前重新核验两端权限。
- 成员 availability 与运行 activity 分别呈现；公开 thinking、工具 callId/参数、回复和实际错误取自原生受控观测。HTTP 状态与效果确认使用所属服务的结构化结果。
- 进入完整 Conversation 通过普通受授权资源打开链路完成，保留输入、历史、配置及返回选择。
- 个人布局、隐藏和筛选作用于呈现；通信、任务、历史和已接纳操作继续由原服务及其生命周期管理。

## 可选贡献

Team 通过 MAS DevPack 的 Backend/WebUI/Client facets 提供，与其他扩展使用同一公共接口。宿主分别选择界面贡献和 Agent tools/instructions。移除界面清理其导航和订阅；成员、历史和已接纳工作继续由 MAS/Runtime 管理。页面结构见[前端交互](frontend.md#team)。

## 契约定位

| 领域                        | 详细声明                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 同 Session 身份、接纳、寿命 | [MAS API](../reference/MAS-API.md)、[领域场景](../../openspec/specs/same-session-mas/spec.md)                |
| 跨 Session 与 worker        | [Broker API](../reference/BROKER-API.md)、[恢复场景](../../openspec/specs/recoverable-multi-session/spec.md) |
| DevPack Agent contribution  | [DevPack API](../reference/MAS-DEVPack-API.md)、[基础规范](../../openspec/specs/mas-devpack/spec.md)         |
| 可选 WebUI/Backend/Client   | [facet 补充](../../openspec/changes/pakka-webui/specs/mas-devpack/spec.md)                                   |
| 关系、交流、实时活动与返回  | [关系工作台场景](../../openspec/changes/mas-board-relationship-workbench/specs/mas-devpack/spec.md)          |
