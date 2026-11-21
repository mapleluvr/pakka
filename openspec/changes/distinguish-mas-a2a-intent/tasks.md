# Tasks

- [x] Inspect and preserve the existing uncommitted A2A worktree files before continuing.
- [x] Implement bounded durable `inform` identity, permission/admission checks, target/profile binding, persistence and passive context source using public Runtime APIs.
- [x] Add additive `MasClient.inform()` / `lookupInform()` and `inform` grant without changing native `send` or `mas_ask` signatures.
- [x] Bind each response to one verified root request; preserve same-payload retry identity, reject changed identity/payload and response chains, and bound response reservations.
- [x] Add DevPack `mas_inform` schema, tool and intent instructions.
- [x] Add deterministic persistence, exact-target, no-native-effect, reopen, authority/revocation, response, and real DevPack integration coverage.
- [x] Record the public context-source lifecycle limit: informs stay pending/at-least-once; no model-consumption or completed-generation claim; no Durable private API extension.
- [x] Update MAS state, MAS API, DevPack API, workflow guide, overview, change summary and OpenSpec specifications.
- [x] Build affected workspaces, run focused tests and existing MAS/DevPack regressions; inspect the complete diff and staged index.
- [x] Align RuntimeContextSource with the Runtime-wide 65,536 UTF-16 code-unit aggregate limit without a per-source character cap; count both MAS inform framing markers inside the default and configurable renderer budgets, and verify exact and exceeded boundaries.
- [x] Close reviewer P2: preflight recipient readiness, distinguish retryable explicit refusals from pinned admission/delivery unknowns, retain the single accepted response identity under concurrency, and verify capacity/reopen behavior.

## Test Classification

`packages/agent/test/runtime-context-boundaries.test.ts` is an existing heavy Runtime/provider-boundary suite. The aggregate-only pass/fail cases were added there and selected because they exercise the shared context-source preparation path and real deterministic local HTTP dispatch; no new test-selection entry was needed. `packages/mas/test/a2a-informs.test.ts` is a heavy integration boundary: it uses the real Runtime, SQLite-backed records, native conversations and a local deterministic provider; its exact framing-budget and response-admission state cases are selected with the existing A2A regressions. The response refusal cases verify capacity release, corrected retry after reopen, stable accepted identity, current-admission revalidation on exact retries and fail-closed binding for unknown admission/native delivery. Neither suite is added to the default light/core set. `packages/mas-devpack/test/devpack.test.ts` is also heavy and retains its existing classification; the new tool-path scenario is added to that source-named suite. Existing `mas.test.ts`, `observations.test.ts`, `broker.test.ts` and `inbox.test.ts` are selected as affected regressions for native placement, history, broker and own-inbox behavior.

## P2 Reviewer Follow-up Verification

The 14-file affected MAS/DevPack selection passed 48/48 tests, including all 12 cases in `packages/mas/test/a2a-informs.test.ts`. Agent, Protocol, MAS, MAS DevPack and Server builds plus Agent/MAS/DevPack `tsc --noEmit`, Prettier, strict OpenSpec validation and `git diff --check` passed. An expanded selection including unchanged `packages/mas/test/unknown.test.ts` passed 48 tests and failed its unknown-delivery case with `ERR_SQLITE_ERROR: database is locked`; an isolated rerun reproduced the same failure after its first case passed. This SQLite lock failure is not counted as passed or addressed by the response-reservation change.
