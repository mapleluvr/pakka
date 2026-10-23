# Durable 1.4.0 补丁与 Verification 选用

按用户要求，以最新观察到的正式 release 制作 1.4.0-pakka.1 独立源补丁，并明确开发中的 verification 为可选活动，跳过由所属记录一次承接。新补丁的制备与 Pakka adapter 的 cohort 接入分开处理。

## 完整变更

- [prepare-durable-1-4-0-patch change](../../openspec/changes/prepare-durable-1-4-0-patch/)。
- [proposal](../../openspec/changes/prepare-durable-1-4-0-patch/proposal.md)。
- [design](../../openspec/changes/prepare-durable-1-4-0-patch/design.md)。
- [tasks](../../openspec/changes/prepare-durable-1-4-0-patch/tasks.md)。
- 全部 delta：[durable-request-policy](../../openspec/changes/prepare-durable-1-4-0-patch/specs/durable-request-policy/spec.md)、[development-verification](../../openspec/changes/prepare-durable-1-4-0-patch/specs/development-verification/spec.md)。

## 当前声明与相关基线

- [Durable patch state](../state/durable-patch.md)、[交付与选用](../state/delivery.md)、[验证方法](../development/VERIFICATION.md)。
- 新 capability 的主 spec 随归档合并建立；相关已存在的运行时契约为 [conversation-runtime](../../openspec/specs/conversation-runtime/spec.md)。
- 原补丁声明与验证文档分工由[前次摘要](verification-and-patch-state.md)完整引用。
- 实际补丁身份见 [artifact.json](../../patches/pi-durable/1.4.0-pakka.1/artifact.json)，追加的来源与运行记录见[兼容性账本](../PI-DURABLE-COMPATIBILITY.md)。

## Compresser 第一版试行中的产品接入

用户授权[Compresser 第一版试行](compressor-repair-session.md)后，本 change 的产品接入任务随之执行：生产 cohort/lock 选择 1.4.0，adapter 显式指定 checkpoint，任务等待使用持久化 timer/sleeping，工具执行映射到 output。策略拒绝由 adapter 自有 MutationDenied 区分，其余不明存储错误继续闭锁；没有手改已安装依赖或新增 SDK generation 补丁。

本次使用新 JSONL 存储并保留旧归档/配对，历史 SQLite schema 2 迁移和回退不作为已验证行为。Durable 1.4 必需的 pi-codemode 依赖与旧 oracle 区分；全部生产 Pi 版本和禁止的 oracle/agent-core/TUI/MCP 由实际安装树核对。

[固定试行记录](../verification/COMPRESSER-SESSION-TRIAL.md)承接新的源码、全仓、真实进程中断和仓库外安装验证，旧的独立 SDK 回归与账本保持原文，不冒充本次重跑。新的生命周期采用由[会话状态](../state/compressor-session.md)、[完整形成记录](compressor-repair-session.md)及其全部 proposal/design/tasks/delta 承接。
