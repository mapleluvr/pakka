# Verification - Host Strategy Control Component

Environment: Windows, Node 24.15.0, npm 11.12.1, TypeScript 7.0.2; exact eight-package Pi runtime cohort 1.0.3. Baseline: `4c79c57a2b151f9e9d74177747d5586bd81a3dac`; lane: `migration/host-control` in the assigned isolated host worktree.

This is a generic host component, not a completed Dynamite integration or full Kappa product. The strategy algorithm, plugin/default composition and independent integration review belong to later lanes. No paid model calls, user credential reads/changes, Pi source patches/private-method overrides, sibling checkout edits, pushes or publication occurred. The component is committed locally as requested by the lane contract.

## Executed Gates

| Command | Latest result | Evidence |
| --- | --- | --- |
| `npm run check` | Passed | `artifacts/host-control/recovery-check.log` |
| `npm run build` | Passed | `artifacts/host-control/recovery-build.log` |
| `npm test` | **82/82 passed**, no skipped/cancelled tests; original 22 preserved | `artifacts/host-control/recovery-tests-2.log` |
| `npm run format:check -- --end-of-line auto` | Passed | `artifacts/host-control/recovery-format-2.log` |
| `npm run smoke:package` | Passed: external tarball install, public declarations, six localhost requests | `artifacts/host-control/recovery-package.log`, `artifacts/package-smoke/` |
| `git diff --check` | Passed | No whitespace errors |

The plain default-LF format command reports CRLF differences in untouched Windows baseline files. The explicit auto-end-of-line gate validates style without unrelated line-ending churn. Newly edited sources were formatted. The API declaration block in `docs/STRATEGY-API.md` was compared exactly against `src/types.ts` (`artifacts/host-control/api-match.log`).

One first recovery full-suite run, launched concurrently with other gates, had three seed failures before any HTTP with `Connection error.` (`recovery-tests.log`). The same tests passed alone (`recovery-seed-repro.log`) and the subsequent serial full run passed 82/82. The underlying transient localhost transport cause was not established; no production retry or test retry was added to hide it.

## Real HTTP Evidence

The final full-run manifest contains **87 fixtures, 139 localhost HTTP requests, zero fixture server errors** (`artifacts/host-control/recovery-http-inventory.json`). Multiple fixtures are used for table-driven storage/bootstrap cases. It contains 117 main requests, 21 summary-model requests with actual `max_tokens` 64/128, and one explicit fallback request capped at 256 (caller zero means no extra caller cap, not unlimited spending).

The external installed consumer made **six** HTTP requests. Two auxiliary payloads contain actual `max_tokens: 64` and `128`; its main JSONL is byte-for-byte unchanged during those calls. Projection still applies after real reload, `summary: null` omits the source without a placeholder, system text survives, and raw source remains persisted. It also checks a physical artifact receipt and rejects the private adapter subpath.

The external consumer is outside the repository and installs `pakka-agent-0.1.0.tgz` with no root workspace overrides or ancestor workspace resolution. Its TypeScript declaration consumer compiles with strict NodeNext settings. The installed inventory verifies coding-agent, ai, agent-core, tui, chord, codemode, mcp and telemetry all **1.0.3**. The tarball and consumer paths, SHA/integrity and install/declaration/dependency/runtime logs are recorded under `artifacts/package-smoke/`.

## Coverage

| Area | Behavioral evidence |
| --- | --- |
| Original C2/permission/lifecycle boundary | All 22 baseline tests retained without rewriting their oracles: native steer/follow-up, drain/cancel, idempotency, physical receipt, tool side effect/storage failure, reentrancy, recovery |
| Binding authority | Wrong principal, missing strategy, artifact-only projection, exact hook ownership, deactivated/copied/stale authority |
| Atomic frame | Raw ID/parentage, effective context edits, system/loadout checkpoints, excluded bash and versioned scoped records |
| Request gate | Projector throw, copied basis, missing entry, protected target and owner revocation send no next HTTP; reload installation is idempotent; own writes require explicit basis rebase |
| Native protocol | Changes to call IDs/names/arguments, forged/dangling/reversed pairs and range splits rejected; valid text reduction preserves native declarations/IDs/arguments on wire; protected mid-pair checkpoint survives |
| Explicit omission | Existing summary reduced to no replacement text without source resurrection; remaining tail/checkpoints survive; complete native pair can be omitted, split pair/checkpoint-crossing/stale job cannot |
| Source jobs | Normal tail growth succeeds; target/previous-context edits, completed candidate edits, generation change, newSession, owner revocation, navigation ABA and disposal prevent publication/future attempts |
| Inference | Separate explicit grant, sanitized allowlist, finite budgets, consumed 64/128 wire caps, explicit ordered fallback with fixed input, unknown usage/cost and pending reservations observable; no main transcript/C2 pollution |
| Storage | Strict namespace/version receipts; partial/truncated/missing whole journal directory or file fail closed; real readonly append fault returns unknown and blocks model replay; spent budget survives reload/re-activation/process reopen |
| Transition fault | Same-session late audit write uncertainty during reload stays latched; explicit newSession can recover while the previous session's audit remains faulty |
| Tool invocation | Old explicit scope and async-local no-argument frame refresh both refused across lifecycle changes |
| Trusted reopen | Physical Pakka-owned identity/entry/record preservation under new authority; absent/corrupt/foreign requested reopen never falls back to a new session; C2 claims are not reconstructed |

## Failing-First History

The exact filters are present in each log's npm header. Related tests share runs, not assertions.

- `red-1.log`: 21 behavior failures before the binding/inference API, requested reopen and gate existed. `green-2.log` exposed a real wire-field mismatch: 64 was in `max_completion_tokens`, not the required `max_tokens`. Public compatibility configuration fixed it; `green-3.log` passed the first 43 cases.
- `red-2.log`: source-change immediate abort, missing/partial journal recovery and two-phase lifecycle notices failed; `green-4.log` confirmed the fixes.
- `red-3.log`: a source job could mint authority across a protected checkpoint; target-range validation fixed it. Artifact faults, budget persistence and fixed fallback were also real-provider regression checks.
- `red-4.log`: duplicate/nonfinite/unlisted bootstrap model definitions were accepted; validation now rejects before HTTP.
- `red-5.log`: removing an entire owned journal directory could silently recreate records; separate durable ownership markers close this gap.
- `red-6.log`: a protected system checkpoint between a valid call/result pair was mistakenly rejected; it is now preserved.
- `red-7.log`: synchronous plan mutation after return escaped to the wire, and pending reservations were invisible; immutable plan snapshot and unknown pending audit fixed both.
- `red-8.log`: unpriced usage incorrectly asserted zero cost; unpriced cost is now null.
- `red-9.log`: an audit write fault during reload was cleared by transition success. Parent independently reproduced this RED. Session-attributed failure latches fix the race.
- `red-10.log`: three positive null-omission HTTP cases and reload storage latching failed; `green-10.log` passed all selected omission/transition controls, followed by the complete 82-case run.

The baseline's older `artifacts/tdd/` evidence remains available for its initial C2 slice. Generated logs are ignored by Git; committed test sources and scripts are the durable reproduction.

## Evidence Locations

- `docs/STRATEGY-API.md`: exact public declarations, minimal binding/projector/artifacts/job example, rebase and lifecycle instructions.
- `packages/agent/src/types.ts`: source-authoritative public types, exported via `src/index.ts`.
- `artifacts/host-control/`: baseline, failing-first/intermediate/final recovery gate logs and HTTP inventory.
- `artifacts/integration/manifest.jsonl`: final full-run fixture directories; each archive includes requests, view, server errors, raw session JSONL, strategy journals and ownership markers when present.
- `artifacts/package-smoke/`: external pack/install/declaration/version/runtime evidence and consumer path.

## Interpretation Limits

Main input `committed` means physical Pi entry readback, not fsync or a successful whole run. Journal batches are fsynced and read back, but directory/crash durability, tamper resistance, multi-process locking and C2 crash recovery are not claimed. The physical-write probe uses a genuinely readonly temporary journal file on Windows, not a fake persistence result; portability of that particular fault injection to privileged POSIX environments is not established.

The adapter is tested against OpenAI-completions-compatible localhost providers and Pi 1.0.3. Other provider APIs, complete preprocessing/extension/TUI/RPC compatibility, a hostile Node sandbox, original Kappa suite equivalence and cross-package Dynamite integration are outside this component. Jobs have bounded calls and best-effort abort, not cost rollback; a failure without usage is unknown, never zero billing. Strategy implementations must retain job scopes on inference-derived applications and revalidate persisted plans under fresh authority after reload/reopen.

Independent review is still required by the parent before integrated acceptance. No full-product completion claim is made.
