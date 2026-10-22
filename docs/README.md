# Pakka 文档导航

接续从 [OVERVIEW](OVERVIEW.md)开始：读相关预期，再依据实现和验证结果推进。

| 需要                         | 入口                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| 当前预期与有效约定           | [state](state/README.md)                                                             |
| 当前工作和下一步             | [OVERVIEW](OVERVIEW.md)和所属 OpenSpec tasks，本地 `docs/.temp/active-plan.md`       |
| 形成/调整与完整 change＋spec | [changes 摘要](changes/README.md) → [OpenSpec](../openspec/changes/)                 |
| 使用工作台和 Team            | [WebUI](guides/WEBUI-GUIDE.md)、[Team](guides/MAS-BOARD.md)                          |
| 装配 headless 应用           | [应用配置](guides/MAS-APPLICATION-API.md)、[支持边界](guides/MAS-PRODUCT-SUPPORT.md) |
| 公共 API 和开发方法          | [reference](reference/README.md)、[development](development/README.md)               |
| 核对固定版本事实             | [verification](verification/README.md)、[历史阶段](archive/README.md)                |

## 维护边界

- state 描述产物的当前预期并映射详细契约，不描述完成进度。
- OpenSpec 保留完整变更及 proposal/design/tasks/specs/归档生命周期；docs/changes 只摘要并完整引用。
- guides、reference、development 各维护实际操作、接口和方法。
- verification 保存固定版本结果，追加式 [Pi Durable 账本](PI-DURABLE-COMPATIBILITY.md)保存兼容性变化。当前补丁产物见 [state](state/durable-patch.md)。
- 本地计划/草稿在忽略的 `docs/.temp/`，视觉生成物在忽略的 `docs/visual-primitives/`；测试持续使用的稳定输入在测试 fixtures。既有 runner 的输出位置按其脚本维护。
- 重复计划/草图和无用探针已备份后移出；不再以 plans/design 的旧兼容入口维持另一套目录。

state 不等于已实现，task checkbox/目录归档不证明验收。详细更新关系见[文档维护](development/README.md#文档维护)。
