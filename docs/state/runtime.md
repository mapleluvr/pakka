# Runtime 与 authority

## 模块关系

受信任 bootstrap 持有 Host/Runtime 控制权，配置批准 profile、有限预算和存储。调用者只接收冻结 DTO 与身份绑定命令；生产 Pi mutable handles 和凭据只在 `packages/agent/src/durable-adapter.ts` 内持有。AgentSession adapter 仅作测试 oracle，不进入生产 graph、dist 或安装依赖。

只能通过公开 Pi API 集成。下游 Durable patch 必须版本固定、可重建并有真实回归和追加兼容记录；不手改已安装依赖，也不用私有 import/monkey patch 绕过边界。

核心语义的唯一详细维护位置是[架构契约](../development/ARCHITECTURE.md)。本页给出需要与其他模块共同保持的关系，不另定义 API 字段。

## 跨模块条件

- Session/Conversation、generation、incarnation、host epoch、admission branch identity 各自承担不同的失效和定位职责；host epoch 不称为 `treeRevision`。
- 稳定 client 绑定、操作 capability 和可序列化资源引用不同。知道 ref 不获得权限；复制 DTO 不复制能力。
- prompt、steer、followUp 保留原生不同的 placement/drain 时机，不转为等待结束后的串行 prompt。
- 接纳、输入持久化、placement、generation、应用回复和工具效果分开判断。abort 请求、等待结束、文本匹配均不能证明撤回或零效果。
- 不确定持久化/工具结果保持 unknown 并按所属失败域关闭；相同原请求用于核对，不因超时或关闭页面自动发新操作。
- 效果前以及异步等待后重新检查 authority、作用域和有效引用；旧 invocation/lease 不能借新 Session 获得新权限。
- 正常 reopen 校验存储所有权、配置和预算；不隐式修复损坏存储、窃取 writer claim 或重建所有进程内权限。
- 策略只能通过 owner/lease、受控 frame、journal 和有限 inference job 工作，不取得原始 Pi 对象或任意模型通道。

## 契约定位

| 领域                                   | 详细声明                                                                                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host、策略、admission、失败与存储      | [架构](../development/ARCHITECTURE.md)、[策略 API](../reference/STRATEGY-API.md)                                                                                                       |
| Managed Runtime、多 Conversation、预算 | [Runtime API](../reference/RUNTIME-API.md)、[基础场景](../../openspec/specs/conversation-runtime/spec.md)                                                                              |
| 批准模型与 WebUI 配置边界              | [Runtime 场景补充](../../openspec/changes/pakka-pocket-webui/specs/conversation-runtime/spec.md)、[配置契约](../development/WEBUI-DEVELOPMENT.md#独立选择模型和-conversation-工作目录) |
| HTTP/browser 观察，不扩大 v1           | [应用领域规范](../../openspec/specs/authenticated-mas-apps/spec.md)、[WebUI 桥接补充](../../openspec/changes/pakka-pocket-webui/specs/authenticated-mas-apps/spec.md)                  |
| 单 writer、包依赖与支持范围            | [仓库规范](../development/MONOREPO-CONVENTIONS.md)、[支持矩阵](../guides/MAS-PRODUCT-SUPPORT.md)                                                                                       |
