# 核心集成：归档变更完整索引

M1–M6 与后来可选 Dynamite 配对保留各自 headless/产物范围；不表示当前 WebUI 已验收。完整形成记录由下列 OpenSpec 归档维护，本页不再复制原架构页正文。当前契约见[架构](../development/ARCHITECTURE.md)，固定事实见[历史验收](../archive/README.md)。

## M1：Conversation 资源与 authority

- [change 目录](../../openspec/changes/archive/2026-10-12-conversation-scoped-runtime/)、[proposal](../../openspec/changes/archive/2026-10-12-conversation-scoped-runtime/proposal.md)、[design](../../openspec/changes/archive/2026-10-12-conversation-scoped-runtime/design.md)、[tasks](../../openspec/changes/archive/2026-10-12-conversation-scoped-runtime/tasks.md)。
- 全部 delta：[conversation-runtime](../../openspec/changes/archive/2026-10-12-conversation-scoped-runtime/specs/conversation-runtime/spec.md)。
- 相关主 spec：[conversation-runtime](../../openspec/specs/conversation-runtime/spec.md)。

## M2：同 Session MAS

- [change 目录](../../openspec/changes/archive/2026-10-13-same-session-mas/)、[proposal](../../openspec/changes/archive/2026-10-13-same-session-mas/proposal.md)、[design](../../openspec/changes/archive/2026-10-13-same-session-mas/design.md)、[tasks](../../openspec/changes/archive/2026-10-13-same-session-mas/tasks.md)。
- 全部 delta：[same-session-mas](../../openspec/changes/archive/2026-10-13-same-session-mas/specs/same-session-mas/spec.md)。
- 相关主 spec：[same-session-mas](../../openspec/specs/same-session-mas/spec.md)。

## M3：跨 Session／worker

- [change 目录](../../openspec/changes/archive/2026-10-13-recoverable-multi-session/)、[proposal](../../openspec/changes/archive/2026-10-13-recoverable-multi-session/proposal.md)、[design](../../openspec/changes/archive/2026-10-13-recoverable-multi-session/design.md)、[tasks](../../openspec/changes/archive/2026-10-13-recoverable-multi-session/tasks.md)。
- 全部 delta：[recoverable-multi-session](../../openspec/changes/archive/2026-10-13-recoverable-multi-session/specs/recoverable-multi-session/spec.md)。
- 相关主 spec：[recoverable-multi-session](../../openspec/specs/recoverable-multi-session/spec.md)。

## M4：DevPack

- [change 目录](../../openspec/changes/archive/2026-10-13-mas-devpack/)、[proposal](../../openspec/changes/archive/2026-10-13-mas-devpack/proposal.md)、[design](../../openspec/changes/archive/2026-10-13-mas-devpack/design.md)、[tasks](../../openspec/changes/archive/2026-10-13-mas-devpack/tasks.md)。
- 全部 delta：[mas-devpack](../../openspec/changes/archive/2026-10-13-mas-devpack/specs/mas-devpack/spec.md)、[same-session-mas](../../openspec/changes/archive/2026-10-13-mas-devpack/specs/same-session-mas/spec.md)。
- 相关主 spec：[mas-devpack](../../openspec/specs/mas-devpack/spec.md)、[same-session-mas](../../openspec/specs/same-session-mas/spec.md)。

## M5：认证应用

- [change 目录](../../openspec/changes/archive/2026-10-14-authenticated-mas-apps/)、[proposal](../../openspec/changes/archive/2026-10-14-authenticated-mas-apps/proposal.md)、[design](../../openspec/changes/archive/2026-10-14-authenticated-mas-apps/design.md)、[tasks](../../openspec/changes/archive/2026-10-14-authenticated-mas-apps/tasks.md)。
- 全部 delta：[authenticated-mas-apps](../../openspec/changes/archive/2026-10-14-authenticated-mas-apps/specs/authenticated-mas-apps/spec.md)、[recoverable-multi-session](../../openspec/changes/archive/2026-10-14-authenticated-mas-apps/specs/recoverable-multi-session/spec.md)。
- 相关主 spec：[authenticated-mas-apps](../../openspec/specs/authenticated-mas-apps/spec.md)、[recoverable-multi-session](../../openspec/specs/recoverable-multi-session/spec.md)。

## M6：集成产品

- [change 目录](../../openspec/changes/archive/2026-10-14-integrated-mas-product/)、[proposal](../../openspec/changes/archive/2026-10-14-integrated-mas-product/proposal.md)、[design](../../openspec/changes/archive/2026-10-14-integrated-mas-product/design.md)、[tasks](../../openspec/changes/archive/2026-10-14-integrated-mas-product/tasks.md)。
- 全部 delta：[authenticated-mas-apps](../../openspec/changes/archive/2026-10-14-integrated-mas-product/specs/authenticated-mas-apps/spec.md)、[integrated-mas-product](../../openspec/changes/archive/2026-10-14-integrated-mas-product/specs/integrated-mas-product/spec.md)。
- 相关主 spec：[authenticated-mas-apps](../../openspec/specs/authenticated-mas-apps/spec.md)、[integrated-mas-product](../../openspec/specs/integrated-mas-product/spec.md)。

## 显式可选 Dynamite 配对

- [change 目录](../../openspec/changes/archive/2026-10-15-optional-dynamite-product/)、[proposal](../../openspec/changes/archive/2026-10-15-optional-dynamite-product/proposal.md)、[design](../../openspec/changes/archive/2026-10-15-optional-dynamite-product/design.md)、[tasks](../../openspec/changes/archive/2026-10-15-optional-dynamite-product/tasks.md)。
- 全部 delta：[integrated-mas-product](../../openspec/changes/archive/2026-10-15-optional-dynamite-product/specs/integrated-mas-product/spec.md)、[optional-dynamite-product](../../openspec/changes/archive/2026-10-15-optional-dynamite-product/specs/optional-dynamite-product/spec.md)。
- 相关主 spec：[integrated-mas-product](../../openspec/specs/integrated-mas-product/spec.md)、[optional-dynamite-product](../../openspec/specs/optional-dynamite-product/spec.md)。

历史失败 Dynamite 配对仍见[延期与失败记录](../archive/investigations/DEFERRED-DYNAMITE-COMPATIBILITY.md)，后来有界支持见[固定配对验收](../verification/DYNAMITE-PRODUCT-ACCEPTANCE.md)；两者不相互覆盖。
