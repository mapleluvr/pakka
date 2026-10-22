# M2 Acceptance — Same-Session MAS

> **Deprecated — 历史资料。** 本文保留当时的计划、试写或验证结论，供追溯其条件、版本和产物；现行使用与实施入口见 [当前工作](../../OVERVIEW.md) 与 [文档导航](../../README.md)。deprecated 指本页作为当前指引的地位，历史事实、验收结果及尚有效的约束仍按原范围保留。分类与迁移说明见 [历史资料索引](../README.md)。

状态：已验收，分支 `feat/monorepo-mas-migration`，实现基线 `78dc0b8`；Dynamite compatibility 仍 deferred。最终提交以本文件所在 Git commit 为准。

M2 交付 `@pakka/mas@0.1.0` 与 `@pakka/agent@0.3.0` 的受信任 composition-root API。MAS 只消费 agent 的 frozen DTO/command ports；生产 Pi mutable handles、Tx、storage、task/submission handles 仍只在 `packages/agent/src/durable-adapter.ts`。

## 实现范围

- 同一 Durable Session 内的 atomic Conversation/configuration/membership enrollment。
- `preparing → ready → active` readiness barrier；整 roster activation 是单次 catalog CAS commit。
- principal/source/incarnation 绑定的 frozen `MasClient`，communication grants 与 owner-only configure/fork/abort/retire 分离。
- native prompt/steer/followUp delivery、payload/mode/target conflict detection、persistent request dedup、finite retention/pending admission 和 receipt mapping。
- `persistent`、`temporary`、`task-bound`、`background` 四类 lifetime；task ownership 来自真实 tool invocation，background 使用 Durable background anchor。
- retire 先封闭 admission，再 abort/drain，最后写 retired tombstone；历史 transcript 不删除。inspect 保留已持久化 tombstone，不以 owner task 的 ended 覆盖它。
- Session persistence unknown fail-closed；未知 create/delivery 返回 honest unknown，不做重建或额外 HTTP。
- configure 只选择批准 profile 并发布新 incarnation，旧 reference 失效；fork 需要 owner、idle、合法 cutoff，新成员发布独立 reference。

M2 不实现跨 Session transport/transaction、独立 worker/process、outbox/inbox reconciliation、MAS DevPack、RPC/server/CLI 或 GUI。这些仍由 M3–M6 负责。Dynamite 未装配、未宣称兼容。

## 验证

最终复跑环境：Windows，Node 24.18.0，npm 11（早期 gate 使用 Node 24.15.0）；本地确定性 HTTP provider；不读取用户凭据、不调用付费模型。

| Gate                       | Result                                                              | Evidence                                                        |
| -------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| `npm ci --ignore-scripts`  | passed after stopping repository TypeScript LSP locks               | `artifacts/migration-m2/gate-install-retry.log`                 |
| `npm run check`            | passed                                                              | `artifacts/migration-m2/final-check.log`                        |
| `npm run build`            | passed; agent patch identity verified                               | `artifacts/migration-m2/final-build.log`                        |
| `npm run format:check`     | passed                                                              | `artifacts/migration-m2/final-format.log`                       |
| full `npm test`            | **176/176**, zero failed/skipped/cancelled/todo                     | `artifacts/migration-m2/final-tests.log`                        |
| focused MAS/ownership gate | **17/17**                                                           | `artifacts/migration-m2/final-focused.log`                      |
| authority regression       | **2/2**                                                             | final full/focused suite; `packages/mas/test/authority.test.ts` |
| P2 regression              | old implementation: 3 failures; fixed: **4/4** control tests        | `artifacts/migration-m2/p2-red-verified.log`, `p2-green.log`    |
| installed tarball smoke    | legacy 7 HTTP, runtime 3 HTTP, MAS 3 HTTP; no extra reopen dispatch | `artifacts/migration-m2/final-package.log`, `final-package/`    |
| OpenSpec strict validation | passed                                                              | `artifacts/migration-m2/spec-final.log`                         |
| LSP diagnostics            | clean on changed M2 authority/control paths                         | active final `lens_diagnostics` result                          |

Installed consumer uses both tarballs outside the repository with no workspace source or root overrides. It compiles public declarations, verifies dependency isolation and exercises real local HTTP/storage behavior for activation, delivery, owner policy, retirement and reopen deduplication. Final hashes/integrity, Durable patch identity, source hashes and HTTP fixture summary are in `artifacts/migration-m2/identity.json`; original requests/storage are retained in the fixture manifests. Raw evidence is intentionally ignored by Git.

## Independent review and disposition

- Boundary reviewer recovered run `3f829f3a-e8ef-449d-9280-aca9b40a1969`: **OK**, no reported P0/P1/P2. Report retained as `artifacts/migration-m2/reviews/boundary-review.md`.
- Validation reviewer `f1d830db-9abf-48dc-943f-081fee23aecd`: **OK with notes**, no P0/P1, three P2 findings. Report retained as `artifacts/migration-m2/reviews/validation-final.md`.
- P2-1: retired task/background inspect reported ended. Confirmed with actual owned Conversations; fixed tombstone precedence; both lifetime tests fail against the old implementation and pass after the fix.
- P2-2: old reason survived readiness recovery. Confirmed with a persisted preparing member carrying an old diagnostic; fixed explicit removal. Regression fails old code and passes fixed code.
- P2-3: fork outer validation used a stale snapshot. Native enrollment already checks the source on the commit line. Outer check now reads the current cached reference after refresh; existing owner/configuration/fork HTTP cases pass. This is redundant-check cleanup, not evidence of a prior unauthorized fork.
- JS extra-argument permission bypass was separately reproduced and fixed with a two-argument public send wrapper. Native copied/foreign/ended invocation tests assert zero unauthorized target effects.

The first parallel review attempt timed out/produced no output; it is infrastructure evidence, not approval. Reviews do not waive failing gates or establish stronger claims than runtime evidence: known rejection has no committed member, whereas unconfirmed commit/adoption remains unknown, not a proved rollback. Subsequent independent reviews use the operator-selected `adversarial-review.js` workflow recorded in `AGENTS.md`.

## Residual limits

M2 is same-Session only. A new Harness is not process isolation. Delivery capacity is a non-evicting whole-Session limit; no unsafe expiry reset or automatic record GC. No browser-serializable capability protocol, cross-restart outbox, distributed transaction, physical deletion, exactly-once external effect guarantee or Dynamite mapping. Unknown persistence and external side effects remain fail-closed/unknown.
