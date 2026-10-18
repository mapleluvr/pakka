# Integrated host — first slice

> **Deprecated — 历史初版计划。** 本文保留最早一轮 host slice 的目标与边界。当前操作见[文档导航](../../README.md)，运行契约见[架构](../../development/ARCHITECTURE.md)与[API 参考](../../reference/README.md)；历史地位与迁移规则见[归档索引](../README.md)。

Baseline: ../kappa-experiments/pi-sdk-1.0.3-investigation/RESULTS.md (four independently replayed public-SDK probes).

1. npm workspace / @pakka/agent, pinned Pi 1.0.3; no TUI placeholder implementation.
2. Runtime-concealed Pi adapter, host DTOs, default resource discovery disabled, in-memory owned settings, no native automatic compaction/retry.
3. Identity-bound clients, exclusive strategy hooks, opaque revision snapshots, owner/policy context commits with post-await revalidation.
4. In-process C2 admission ledger and host-prepared text pipeline; native core steering/follow-up; physical-entry readback distinguishes input commitment from successful whole-run execution.
5. Revoke before lifecycle awaits; clear only provably queued objects; replacement and ABA invalidate old snapshots. Preserve uncertain state rather than allowing automatic replay.
6. Integration tests: confinement/discovery, owner vs artifact-only, cut/edit -> real HTTP, policy approval races, reload during active work, switch with queued input, drained-before-append cancellation, same-text distinct identities, host-preprocessing/native-steering composition, tool side effect then storage failure.
7. Build/typecheck/test, external packed-consumer smoke, documented command/API examples and residual gaps.

Explicit initial limits: no complete Pi extension/skill/template/image preprocessing, no arbitrary Pi extension loading, no exact legacy treeRevision, no fsync/crash-safe ledger, no hostile Node sandbox. Control APIs and configured tool/preprocessing functions are trusted; plugin-facing clients have only granted operations. The stable client identity is distinct from per-operation capability snapshots.
