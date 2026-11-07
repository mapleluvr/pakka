# 采用 Git 协作规范并同步项目入口

## Why

操作者要求把工作区 `GitRules.md` 纳入 Pakka 的开发与贡献规范，并按 state-evo 更新元数据和 README。`dev` 已从完成的 `feat/webui-launcher` 初始化，但仓库内尚无完整贡献入口，现行“验证可选”说明也未覆盖批量集成的强制检查条件。OVERVIEW 累积了已完成历史与固定结果，影响当前工作定位。

## What Changes

- 以 `docs/development/GIT-WORKFLOW.md` 维护工作分支、dev 集成和 main 发布 PR 的完整授权及操作规则。
- 新增 CONTRIBUTING 和 PR 模板，同步 README、AGENTS、OpenSpec context 及开发导航。
- 由交付 state 映射分支职责和门禁，明确日常检查选用与批量集成强制检查的适用条件。
- 收短 OVERVIEW，将形成记录、剩余任务与固定候选结果放回对应入口。

## Impact

范围是文档、协作元数据和 PR 模板；产品源码、依赖版本、构建配置、固定证据及既有发布历史保持原身份。本次交付从独立工作分支提 PR 到 dev，合并与发布由各自授权承接。
