# Git 协作与项目元数据

2026-11-07，用户要求把工作区 GitRules.md 并入 Pakka 的开发/贡献规范，并按 state-evo 同步项目入口。此前 dev 已按明确指令直接从 feat/webui-launcher 的 `065823c` 初始化；初始化来源和实际远端核对保留在设计记录，main 保持原提交。

完整记录：[change](../../openspec/changes/adopt-git-workflow-and-project-metadata/)、[proposal](../../openspec/changes/adopt-git-workflow-and-project-metadata/proposal.md)、[design](../../openspec/changes/adopt-git-workflow-and-project-metadata/design.md)、[tasks](../../openspec/changes/adopt-git-workflow-and-project-metadata/tasks.md)、[全部 delta](../../openspec/changes/adopt-git-workflow-and-project-metadata/specs/product-documentation/spec.md)；相关主规范为 [product-documentation](../../openspec/specs/product-documentation/spec.md)。本 change 的增量场景在活动目录中维护，归档时按 OpenSpec 同步主规范。

采用结果由[交付声明](../state/delivery.md)映射到 [Git 开发规范](../development/GIT-WORKFLOW.md)，[贡献指南](../../CONTRIBUTING.md)和 [PR 模板](../../.github/pull_request_template.md)提供操作入口。README、AGENTS 和 OpenSpec context 使用同一分支与验证条件；OVERVIEW 收回为当前工作入口，形成经过与固定结果沿既有 changes/verification 索引查阅。

本次调整明确日常检查选用与批量集成 dev 的推送前强制检查条件。产品实现与固定验证证据保持原身份，实际检查及工作 PR 状态由上述 tasks 承接。
