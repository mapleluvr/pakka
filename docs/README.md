# Pakka 文档导航

从正在做的事情进入文档：使用工作台、装配应用、开发扩展、讨论设计，或查阅某个版本的历史证据。

## 当前入口

| 想做的事情                            | 从这里开始                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| 使用 Web 工作台、选择模型和工作目录   | [WebUI 使用与启动](guides/WEBUI-GUIDE.md)                                            |
| 确认已有能力、用户已确认项和剩余交付  | [当前产品状态](PAKKA-POCKET-STATUS.md)                                               |
| 装配 headless MAS server、client、CLI | [应用配置](guides/MAS-APPLICATION-API.md)与[支持边界](guides/MAS-PRODUCT-SUPPORT.md) |
| 使用或实现公开 API                    | [API 参考](reference/README.md)                                                      |
| 修改代码或编写 Web 扩展               | [开发入口](development/README.md)                                                    |
| 继续 MAS Board 的关系图设计           | [当前设计第二稿](MAS-BOARD-DESIGN.md)与[图稿导航](design/mas-board/README.md)        |
| 阅读当前实施范围和阶段通过条件        | [当前计划](plans/README.md)                                                          |
| 核对验证方式、固定产物及其证据范围    | [验证入口](verification/README.md)                                                   |
| 查阅早期计划、阶段验收和第一次试写    | [Deprecated 历史资料](archive/README.md)                                             |

## 文档分区

- **guides/**：启动、配置和操作方式，面向当前使用。
- **reference/**：公开接口、权限及运行契约。
- **development/**：架构、仓库规范、扩展开发和验证工作方式。
- **plans/**：仍在执行的范围、依赖和通过条件。
- **design/**：用于讨论和实施准备的设计材料；稿件明确区分现有能力、拟实现能力和构造示例。
- **verification/**：验证导航及仍被固定产品配对引用的证据。
- **archive/**：已被当前文档接替的计划、调查、阶段记录和旧稿，统一标记 **Deprecated**。

根目录保留三个稳定入口：[当前状态](PAKKA-POCKET-STATUS.md)、[MAS Board 当前草案](MAS-BOARD-DESIGN.md)和追加式 [Pi Durable 兼容性账本](PI-DURABLE-COMPATIBILITY.md)。图稿与设计索引位于 `design/mas-board/`。少量带 deprecated 标记的旧路径只承担迁移指引，服务于账本和已打开稿件中的既有引用。

## 怎样阅读状态

当前使用文档说明操作及边界；设计稿描述准备实现的交互；验收记录只证明其指定源码、归档、环境和观察范围。用户确认和自动测试分别记录，各自保留有效结论。

Deprecated 表示该页已退出当前指引位置。历史结果、失败、来源和当时适用的约束保留，当前范围由对应指南、契约和[状态页](PAKKA-POCKET-STATUS.md)说明。OpenSpec 的 specs 与活动 change 继续使用原目录和生命周期。

新增、修订和归档方式见[文档维护约定](development/README.md#文档维护)。
