# Pakka 文档导航

日常接续从 [OVERVIEW](OVERVIEW.md)进入：先读相关预期，再结合实际实现和验证安排工作。

## 按用途查找

| 需要                           | 入口                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| 理解应当形成的产品与有效约定   | [state 目录](state/README.md)                                                                |
| 确认实现差距和下一步           | [实施状态](PAKKA-POCKET-STATUS.md)；本地 `docs/.temp/active-plan.md`                         |
| 理解要求怎样形成/调整          | [changes 目录](changes/README.md)与原 OpenSpec change                                        |
| 使用实际工作台或 Team          | [WebUI 指南](guides/WEBUI-GUIDE.md)、[Team 指南](guides/MAS-BOARD.md)                        |
| 装配 headless 应用             | [应用配置](guides/MAS-APPLICATION-API.md)、[支持边界](guides/MAS-PRODUCT-SUPPORT.md)         |
| 查字段、权限和运行 API         | [reference](reference/README.md)                                                             |
| 修改代码、扩展或包边界         | [development](development/README.md)                                                         |
| 核对候选身份、结果和未执行门禁 | [verification](verification/README.md)                                                       |
| 追查旧计划、构造图稿与阶段证据 | [plans](plans/README.md)、[design](design/mas-board/README.md)、[archive](archive/README.md) |

## 文档分工

- **OVERVIEW.md**：一句话定位和当前工作入口。
- **state/**：当前采用的预期；详细 API、场景、开发契约已有明确位置时，在领域页映射，不复制第二套。
- **changes/**：初始形成和采用调整的来路；原 OpenSpec 变更继续沿用原目录和生命周期。
- **.temp/**：本地计划、调查、草稿和实验，默认不提交。正式依据/未完成工作须在可交接位置可见。
- **artifacts/**（仓库根）：既有自动化 runner 的临时输出继续沿用，不为目录统一改测试路径；长期依据再封存到 verification 等正式位置。
- **guides/**：针对实际入口的使用方式；不将未实现目标写成可执行操作。
- **reference/** 与 **development/**：公开接口/技术细则，以及开发和验证方法。
- **verification/** 与 **visual-primitives/**：固定候选的事实证据，不承担当前规格。
- **plans/**、**design/** 与 **archive/**：形成材料、旧阶段和历史依据，明确各页的身份。

[产品状态](PAKKA-POCKET-STATUS.md)、[MAS 设计旧稿](MAS-BOARD-DESIGN.md)、旧 R2 计划和既有 API 保留稳定路径；[Pi Durable 兼容性账本](PI-DURABLE-COMPATIBILITY.md)保持追加式。目录映射与本轮取舍见[文档分工记录](changes/2026-10-21-documentation-system.md)。

## 阅读边界

state 说明目标，不表示已经实现。计划/设计/checkbox 不证明完成；代码也不自动缩小要求。候选报告和用户确认只证明其身份、环境与所测范围，不能沿用为新版本全通过。

需要理解选择再查 changes；需要继续推进则把差距放进 active-plan 和实施状态。详细写作、更新与归档方法见[文档维护](development/README.md#文档维护)。
