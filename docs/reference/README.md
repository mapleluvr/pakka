# API 参考

这些文档面向装配代码、库消费者及扩展实现者。对外调用以包的 public exports 和对应声明为准，例子中的路径、资源标识和额度需要按实际宿主配置替换。

| 接口                                                  | 文档                                         |
| ----------------------------------------------------- | -------------------------------------------- |
| 多 Conversation runtime、受控 catalog、模型与目录配置 | [Runtime API](RUNTIME-API.md)                |
| 策略 binding、projection、artifacts 和辅助 inference  | [Strategy API](STRATEGY-API.md)              |
| 同 Session MAS membership、A2A、寿命与回执            | [MAS API](MAS-API.md)                        |
| 跨 Session broker、受控 enrollment、worker 和恢复     | [Broker API](BROKER-API.md)                  |
| 模型侧工具、指令及 Web facets                         | [MAS DevPack API](MAS-DEVPack-API.md)        |
| 显式可选策略的产品装配                                | [Dynamite 配置 API](DYNAMITE-PRODUCT-API.md) |
| Server/client/CLI 的应用层装配                        | [应用指南](../guides/MAS-APPLICATION-API.md) |

[架构](../development/ARCHITECTURE.md)说明身份、权限和失败边界；[Web 扩展开发](../development/WEBUI-DEVELOPMENT.md)说明公开 UI、Backend 与 Client 插槽。MAS Board 的关系画布仍在[设计阶段](../MAS-BOARD-DESIGN.md)，稿件中的拟新增投影与当前接口分别标注。

版本配对和证据见[验证入口](../verification/README.md)；早期接口形成过程见[历史资料](../archive/README.md)。
