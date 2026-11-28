# Pakka 文档导航

接续从 [OVERVIEW](OVERVIEW.md)开始：读相关预期，再依据实现和验证结果推进。

| 需要                         | 入口                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 当前预期与有效约定           | [state](state/README.md)                                                                                                               |
| 当前工作和下一步             | [OVERVIEW](OVERVIEW.md)和所属 OpenSpec tasks，本地 `docs/.temp/active-plan.md`                                                         |
| 形成/调整与完整 change＋spec | [changes 摘要](changes/README.md) → [OpenSpec](../openspec/changes/)                                                                   |
| 本机登录、备份、恢复与升级   | [本机维护指南](guides/LOCAL-MAINTENANCE.md)                                                                                            |
| 使用工作台和 Team            | [WebUI](guides/WEBUI-GUIDE.md)、[Team](guides/MAS-BOARD.md)                                                                            |
| 装配 headless 应用           | [应用配置](guides/MAS-APPLICATION-API.md)、[支持边界](guides/MAS-PRODUCT-SUPPORT.md)                                                   |
| 提交与贡献                   | [贡献指南](../CONTRIBUTING.md)、[Git 协作规范](development/GIT-WORKFLOW.md)                                                            |
| 公共 API 和开发方法          | [reference](reference/README.md)、[development](development/README.md)                                                                 |
| WebUI 原则、目录与设计系统   | [前端规范](development/FRONTEND-GUIDELINES.md)、[架构](development/WEBUI-ARCHITECTURE.md)、[调研](development/WEBUI-DESIGN-SYSTEMS.md) |
| 核对固定版本事实             | [verification](verification/README.md)、[历史阶段](archive/README.md)                                                                  |

通用工单装配与调用见 [RSI API](reference/RSI-API.md)、[可运行示例](../packages/rsi/README.md)。

## 维护边界

- state 描述产物的当前预期并映射详细契约。README 提供产品、使用和贡献入口；AGENTS 与 OpenSpec context 引用同一套协作规则。
- OVERVIEW 保持简短，指向当前实际工作和未完成任务；完成历史与固定结果进入 changes/verification。
- OpenSpec 保留完整变更及 proposal/design/tasks/specs/归档生命周期；docs/changes 只摘要并完整引用。
- guides、reference、development 各维护当前操作、接口和方法。所有产物层正文均可独立阅读，以对象、运行条件和实际行为表述；开发阶段、验收状态、测试计数及形成经过由 changes、archive 和 verification 承接。
- verification 保存固定版本结果，追加式 [Pi Durable 账本](PI-DURABLE-COMPATIBILITY.md)保存兼容性变化。当前补丁产物见 [state](state/durable-patch.md)。
- 本地计划/草稿在忽略的 `docs/.temp/`，视觉生成物在忽略的 `docs/visual-primitives/`；测试持续使用的稳定输入在测试 fixtures。既有 runner 的输出位置按其脚本维护。

state 不等于已实现，task checkbox/目录归档不证明验收。详细更新关系见[文档维护](development/README.md#文档维护)。
