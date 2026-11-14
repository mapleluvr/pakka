# API 参考

这些文档面向装配代码、库消费者及扩展实现者。对外调用以包的 public exports 和对应声明为准，例子中的路径、资源标识和额度需要按实际宿主配置替换。

| 接口                                                  | 文档                                                      |
| ----------------------------------------------------- | --------------------------------------------------------- |
| 多 Conversation runtime、受控 catalog、模型与目录配置 | [Runtime API](RUNTIME-API.md)                             |
| 执行环境、原生文件/Shell 工具与 invocation 能力       | [执行环境 API 与用法](../guides/EXECUTION-ENVIRONMENT.md) |
| 策略 binding、projection、artifacts 和辅助 inference  | [Strategy API](STRATEGY-API.md)                           |
| 同 Session MAS membership、A2A、寿命与回执            | [MAS API](MAS-API.md)                                     |
| 跨 Session broker、受控 enrollment、worker 和恢复     | [Broker API](BROKER-API.md)                               |
| 模型侧工具、指令及 Web facets                         | [MAS DevPack API](MAS-DEVPack-API.md)                     |
| 显式可选策略的产品装配                                | [Dynamite 配置 API](DYNAMITE-PRODUCT-API.md)              |
| History Book、固定产物与原 entry 读取、可选记史及馆员 | [History Book 与图书馆协作](../guides/HISTORY-LIBRARY.md) |
| Wiki、来源、权限与原生知识工具                        | [Memo API](MEMO-API.md)                                   |
| Server/client/CLI 的应用层装配                        | [应用指南](../guides/MAS-APPLICATION-API.md)              |

[架构](../development/ARCHITECTURE.md)说明身份、权限和失败边界；[Web 扩展开发](../development/WEBUI-DEVELOPMENT.md)说明公开 UI、Backend 与 Client 插槽。Team 的关系、观测与交互契约见 [MAS state](../state/mas.md)和[前端预期](../state/frontend.md#team)。

版本配对见[集成入口](../../integrations/dynamite/README.md)；形成与固定结果由[变更记录](../changes/README.md)及[验证入口](../verification/README.md)承接。
