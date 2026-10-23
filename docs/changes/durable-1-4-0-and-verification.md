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
