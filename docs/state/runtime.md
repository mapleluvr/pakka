# Runtime 与 authority

## 模块关系

受信任 bootstrap 持有 Host/Runtime 控制权，配置批准 profile、有限预算和存储。调用者接收冻结 DTO 与身份绑定命令；生产 Pi mutable handles 和凭据仅由 `packages/agent/src/durable-adapter.ts` 持有。生产依赖图、dist 和安装产物使用 Durable adapter；AgentSession adapter 位于测试目录，作为 oracle 使用。

Pi 集成使用公开 API。下游 Durable patch 采用版本固定的源补丁、明确基线和可复现构建，通过真实回归并在兼容性账本追加记录；安装产物来自经核验的构建。

本页描述跨模块关系；核心语义与 API 条件由[架构契约](../development/ARCHITECTURE.md)及下表所列领域细则维护。

## 跨模块条件

- Session/Conversation、generation、incarnation、host epoch、admission branch identity 分别用于资源定位、绑定失效与接纳作用域校验。
- client 绑定持有调用身份；操作 capability 绑定有效作用域；可序列化资源引用用于寻址。读取与效果各自校验所需权限。
- prompt、steer、followUp 使用原生各自的 placement/drain 时机。工作中的 prompt 被拒绝，steer 与 followUp 按原生调度接纳。
- 接纳、输入持久化、placement、generation、应用回复和工具效果各自核对。作用域变更且输入尚未转交时可释放接纳；已排队输入的释放以 Durable 精确确认撤回且未发生 placement 为条件。
- 持久化或工具结果未确认时保持 unknown，并按所属失败域关闭。后续核对沿用原请求身份；重新接纳须满足所属契约的明确条件。
- 每次效果前以及异步等待后重新检查 authority、作用域和有效引用。invocation、lease 与其原 Session 和 generation 绑定，失效后拒绝调用。
- reopen 打开经物理路径、所有权、来源、配置和预算校验的原存储；缺失、损坏、异属存储或未确认的 writer claim 使打开失败并保留原状态。持久身份、记录和已消费额度按契约保留；进程内 admission ledger 的寿命随宿主结束，grants、leases 和操作 capability 由受信任 bootstrap 显式创建。
- 策略通过 owner/lease、受控 frame、journal 和有限 inference job 工作；模型与工具效果使用宿主批准的端口和预算。

## 契约定位

| 领域                                   | 详细声明                                                                                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host、策略、admission、失败与存储      | [架构](../development/ARCHITECTURE.md)、[策略 API](../reference/STRATEGY-API.md)                                                                                                       |
| Managed Runtime、多 Conversation、预算 | [Runtime API](../reference/RUNTIME-API.md)、[基础场景](../../openspec/specs/conversation-runtime/spec.md)                                                                              |
| 批准模型与 WebUI 配置边界              | [Runtime 场景补充](../../openspec/changes/pakka-pocket-webui/specs/conversation-runtime/spec.md)、[配置契约](../development/WEBUI-DEVELOPMENT.md#独立选择模型和-conversation-工作目录) |
| HTTP/browser 与独立的人类认证接口      | [应用领域规范](../../openspec/specs/authenticated-mas-apps/spec.md)、[WebUI 桥接补充](../../openspec/changes/pakka-pocket-webui/specs/authenticated-mas-apps/spec.md)                  |
| 单 writer、包依赖与支持范围            | [仓库规范](../development/MONOREPO-CONVENTIONS.md)、[支持矩阵](../guides/MAS-PRODUCT-SUPPORT.md)                                                                                       |
