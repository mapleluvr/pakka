# 辅助推理 Tool Calling 输出

用户于 2026-10-23 授权调研并实现 Dynamite P2/P3/P4 的 Tool Calling 生产。本轮采用一个声明式 output tool 的受控辅助推理契约，Dynamite 在独立仓库将 P1 和图/注释/线索持久化到同一来源绑定的 block。

完整记录：

- [change](../../openspec/changes/add-auxiliary-tool-output/)、[proposal](../../openspec/changes/add-auxiliary-tool-output/proposal.md)、[design](../../openspec/changes/add-auxiliary-tool-output/design.md)、[tasks](../../openspec/changes/add-auxiliary-tool-output/tasks.md)。
- 全部 delta：[auxiliary-tool-output](../../openspec/changes/add-auxiliary-tool-output/specs/auxiliary-tool-output/spec.md)。该新能力的主 spec 尚待归档生成。
- 有关主 spec：[optional-dynamite-product](../../openspec/specs/optional-dynamite-product/spec.md)继续定义原已接受的可选产品范围；本轮的库能力不构成其新版产品接受。
- 预期与细则：[Runtime state](../state/runtime.md)、[Strategy API](../reference/STRATEGY-API.md)。Dynamite 本身的采用声明在其独立仓库 docs/state/artifacts.md，形成经过在 docs/changes/tool-calling-artifacts.md。

本轮选用与实际差距由 tasks 承接。[固定验证记录](../verification/AUXILIARY-TOOL-OUTPUT.md)保存实际结果、RED/GREEN、版本与归档身份；两次指定独立复审均因 B 的模型注册/路由失败而未完成；A 原始报告、失败回执和父审可达性判断均由该记录承接。代码与执行验证已完成，完整双审、最终接受及主 spec 归档仍是明确差距。
