# 使用与装配指南

| 使用场景                                               | 文档                                                  |
| ------------------------------------------------------ | ----------------------------------------------------- |
| 浏览器里的 Conversation、模型、工作目录与常用面板      | [WebUI 使用与启动](WEBUI-GUIDE.md)                    |
| 用脚本编写协作流程，供人和 Agent 设计、保存与验证      | [协作流程编程](MAS-WORKFLOWS.md)                      |
| 原生文件/命令工具、合作插件与可替换执行驱动 | [执行环境](EXECUTION-ENVIRONMENT.md) |
| Agent 关系画布、活动预览和交流日志                     | [MAS Board](MAS-BOARD.md)                             |
| 显式 server 配置、连接文件、Node/browser client 和 CLI | [MAS 应用配置](MAS-APPLICATION-API.md)                |
| Headless MAS 的产品范围、权限和正常重开                | [MAS 产品支持边界](MAS-PRODUCT-SUPPORT.md)            |
| 受控 Webhook 的认证、投递及去重                        | [Webhooks](WEBHOOKS.md)                               |
| 可选 Dynamite 的固定组合与显式启用                     | [Dynamite 配置](../reference/DYNAMITE-PRODUCT-API.md) |

Web 工作台与 headless server 各有启动与网络边界。模型工具、插件 facets 和策略由宿主分别装配；一个界面入口的存在不授予模型或用户额外能力。

公开类型与接口见 [API 参考](../reference/README.md)，使用与支持条件在各指南内维护。形成与固定版本事实另见[变更](../changes/README.md)和[验证记录](../verification/README.md)。
