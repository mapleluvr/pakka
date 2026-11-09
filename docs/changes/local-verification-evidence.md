# 本地验证证据与提交检查

PR #6 的实际 diff 审计发现，263,283 行新增中有 244,626 行是验证证据；三份 verbose npm pack 输出占 192,208 行。操作者据此明确采用：以后 `verification` 只提交关键信息和完整证据包的整体 hash，证据本地打包保留、不上传 GitHub，云端存储由操作者处理；PR 前总是检查待提交产物。

本次将其落实为每次提交及 PR 创建/更新前的完整产物审查，覆盖暂存区、实际 base 的完整差异、继承提交、行数、大文件、敏感材料和重复输出。此要求独立于是否选用运行时 Verification；不是新增自动 CI/hook 的完成声明。

## 采用与任务

- [完整 change](../../openspec/changes/adopt-local-verification-evidence/)
- [proposal](../../openspec/changes/adopt-local-verification-evidence/proposal.md)
- [design](../../openspec/changes/adopt-local-verification-evidence/design.md)
- [tasks](../../openspec/changes/adopt-local-verification-evidence/tasks.md)
- [product-documentation delta](../../openspec/changes/adopt-local-verification-evidence/specs/product-documentation/spec.md)
- [相关主 spec](../../openspec/specs/product-documentation/spec.md)：由正常 OpenSpec archive 生命周期接续，本次未归档。

[交付 state](../state/delivery.md)、[Git 工作流](../development/GIT-WORKFLOW.md#提交与-pr-产物检查)与[验证方法](../development/VERIFICATION.md#验证记录与本地证据包)维护当前契约；贡献、Agent/OpenSpec 入口和 PR 模板引用同一要求。工作区 GitRules/AGENTS 同步此决定。现有 PR、历史证据与固定 hash 未清理或改写；产品必需的 vendor、源码补丁、构建锁和测试仍按各自契约维护。
