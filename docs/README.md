# Pakka 文档导航

接续从 [OVERVIEW](OVERVIEW.md)开始：读相关预期，再依据实现和验证结果推进。

| 需要                         | 入口                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| 当前预期与有效约定           | [state](state/README.md)                                                             |
| 实现差距和下一步             | [实施状态](PAKKA-POCKET-STATUS.md)，本地 `docs/.temp/active-plan.md`                 |
| 形成/调整与完整 change＋spec | [changes 摘要](changes/README.md) → [OpenSpec](../openspec/changes/)                 |
| 使用工作台和 Team            | [WebUI](guides/WEBUI-GUIDE.md)、[Team](guides/MAS-BOARD.md)                          |
| 装配 headless 应用           | [应用配置](guides/MAS-APPLICATION-API.md)、[支持边界](guides/MAS-PRODUCT-SUPPORT.md) |
| 公共 API 和开发方法          | [reference](reference/README.md)、[development](development/README.md)               |
| 核对固定版本事实             | [verification](verification/README.md)、[历史阶段](archive/README.md)                |
| 清理清单和外置材料恢复       | [整理记录](verification/DOCUMENTATION-CLEANUP.md)                                    |

## 维护边界

- state 描述产物的当前预期并映射详细契约，不描述完成进度。
- OpenSpec 保留完整变更及 proposal/design/tasks/specs/归档生命周期；docs/changes 只摘要并完整引用。
- guides、reference、development 各维护实际操作、接口和方法。
- verification、当前 visual-primitives 与追加式 [Pi Durable 账本](PI-DURABLE-COMPATIBILITY.md)保存证据，不反向定义目标。
- 本地计划/草稿在忽略的 `docs/.temp/`；既有 runner 仍输出到忽略的根 `artifacts/`，不为目录统一改产品脚本。
- 重复计划/草图和无用探针已备份后移出；不再以 plans/design 的旧兼容入口维持另一套目录。

state 不等于已实现，task checkbox/目录归档不证明验收。详细更新关系见[文档维护](development/README.md#文档维护)。
