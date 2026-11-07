# Runtime 与 authority

## 模块关系

受信任 bootstrap 持有 Host/Runtime 控制权，配置批准 profile、有限预算和存储，并可提供原生 Pi Models 或 getter。执行和存储的 mutable handles 由 `packages/agent/src/durable-adapter.ts` 持有；Models、凭据及配置加载器属于可信装配，操作调用者接收冻结 DTO 与身份绑定命令。生产依赖图、dist 和安装产物使用 Durable adapter；AgentSession adapter 位于测试目录，作为 oracle 使用。

Pi 集成使用公开 API。下游 [Durable 源补丁](durable-patch.md)为 generation 提供明确拒绝与请求级检查，包含版本固定的源补丁、基线、构建锁及安装归档；真实回归与兼容性变化分别由构建/集成测试和追加式账本承接。

工具的文件与命令能力通过[执行环境](execution-environment.md)绑定到可信 bootstrap 批准的目标；原生工具及合作插件共享 invocation 校验，模型、存储和插件承载进程各有自己的执行边界。

本页描述跨模块关系；核心语义与 API 条件由[架构契约](../development/ARCHITECTURE.md)及下表所列领域细则维护。

## 跨模块条件

- Session/Conversation、generation、incarnation、host epoch、admission branch identity 分别用于资源定位、绑定失效与接纳作用域校验。
- client 绑定持有调用身份；操作 capability 绑定有效作用域；可序列化资源引用用于寻址。读取与效果各自校验所需权限。
- prompt、steer、followUp 使用原生各自的 placement/drain 时机。工作中的 prompt 被拒绝，steer 与 followUp 按原生调度接纳。
- 接纳、输入持久化、placement、generation、应用回复和工具效果各自核对。普通模型生成错误保留原生失败记录，idle 后可接受明确的新输入或配置修正；存储及未确认执行效果沿所属失败域关闭。字面文本可以以斜杠开头，明确命令使用注册 dispatcher。作用域变更且输入尚未转交时可释放接纳；已排队输入的释放以 Durable 精确确认撤回且未发生 placement 为条件。
- 持久化或工具结果未确认时保持 unknown，并按所属失败域关闭。后续核对沿用原请求身份；重新接纳须满足所属契约的明确条件。
- 每次效果前以及异步等待后重新检查 authority、作用域和有效引用。invocation、lease 与其原 Session 和 generation 绑定，失效后拒绝调用。
- reopen 打开经物理路径、所有权、来源、配置和预算校验的原存储；缺失、损坏、异属存储或未确认的 writer claim 使打开失败并保留原状态。持久身份、记录和已消费额度按契约保留；进程内 admission ledger 的寿命随宿主结束，grants、leases 和操作 capability 由受信任 bootstrap 显式创建。
- 配置可追加新的批准 profile，不替换已有执行定义或目录边界。预算政策使用版本与原请求身份，调整和审计在同一原生事务提交；累计预留及消费不退款、不清零。原 bootstrap 值不覆盖运行期间的管理调整，明确变更 bootstrap 值才形成新政策。审计按版本分页。预算提交前的参数或版本冲突由 `BudgetChangeRefusedError` 表示本次尝试明确拒绝，原请求的已有回执仍独立核对；写入或提交后授权状态未知仍按所属失败域处理。
- 策略通过 owner/lease、受控 frame、journal 和有限 inference job 工作；模型与工具效果使用宿主批准的端口和预算。
- 辅助 inference 可声明一个 output tool；完整且符合 schema 的单次调用作为冻结 DTO 返回，经同一 job/source、预算、completion 与采用回执约束。调用的执行和产物采用由策略的受控端口承担。细则见 [Tool Calling 场景](../../openspec/changes/add-auxiliary-tool-output/specs/auxiliary-tool-output/spec.md)。

## 长期历史与投递

持久化服务于长期任务执行：原请求身份、完整输入、原生回执及历史持续保留。送给模型的上下文由受控策略选取，历史的持久容量与单次上下文窗口分别管理。

同 Session Catalog 按请求 ID 保存独立投递记录，接纳索引只保存成员、顺序指针及每个收件人的未完成工作。新输入的接纳核对该收件人的 queued/placed 集合；已完成历史增长不构成累计次数额度。每次接纳仍满足当前权限、原生调度、预算和单次载荷条件。原请求复用、内容冲突、unknown 和 writer 约束按原身份继续执行。

历史通过有界页读取；按 ID 核对原回执与历史页的选择相互独立。受控迁移在同一原生提交中保存拆分记录和索引，并保留原生 submission、Conversation 与 Session 身份。详细兼容条件见 [MAS API](../reference/MAS-API.md)，采用和迁移依据见[长期投递记录](../changes/long-lived-deliveries.md)。

## 契约定位

| 领域                                   | 详细声明                                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host、策略、admission、失败与存储      | [架构](../development/ARCHITECTURE.md)、[策略 API](../reference/STRATEGY-API.md)                                                                                                |
| Managed Runtime、多 Conversation、预算 | [Runtime API](../reference/RUNTIME-API.md)、[基础场景](../../openspec/specs/conversation-runtime/spec.md)                                                                       |
| 模型目录、Agent 预设与 WebUI 配置边界  | [Runtime 场景补充](../../openspec/changes/pakka-webui/specs/conversation-runtime/spec.md)、[配置契约](../development/WEBUI-DEVELOPMENT.md#独立选择模型和-conversation-工作目录) |
| HTTP/browser 与独立的人类认证接口      | [应用领域规范](../../openspec/specs/authenticated-mas-apps/spec.md)、[WebUI 桥接补充](../../openspec/changes/pakka-webui/specs/authenticated-mas-apps/spec.md)                  |
| 单 writer、包依赖与支持范围            | [仓库规范](../development/MONOREPO-CONVENTIONS.md)、[支持矩阵](../guides/MAS-PRODUCT-SUPPORT.md)                                                                                |
