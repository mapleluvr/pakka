# Verification — accepted headless strategy integration

The integrated Pakka/Dynamite migration passed independent review on 2026-10-09: `ok_with_notes`, no remaining findings. Runtime heads reviewed were Pakka `f9578776a46c2c07ae783dd97ee75adcb3b5d3af` and Dynamite `bd45756f272cd2d4af3c0b9e55fc2587e8bf4678`. Later delivery commits update documentation and formatting configuration only.

| Final validation                               | Result                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Full Pakka source suite                        | 112/112; no skips/cancellations                                                             |
| Full Dynamite source suite                     | 334/334; no skips/cancellations                                                             |
| Isolated installed tarballs                    | Host 112/112, Dynamite integration 37/37                                                    |
| Independent installed adversarial checks       | 19 asserted cases passed                                                                    |
| Clean Dynamite git-archive bootstrap           | Explicit host tarball, npm ci, typecheck/build and 37/37 integration                        |
| Public declarations and build identity         | Strict NodeNext passed; 50 installed JS/declaration files matched current source builds     |
| Dependency inventory                           | All eight Pi runtime packages exactly 1.0.3                                                 |
| Pakka check/build and Dynamite typecheck/build | Passed                                                                                      |
| Pakka format:check                             | Passed after explicitly configuring `endOfLine: auto`; no runtime/source formatting rewrite |

Review covered pre-write zero-effect adoption checks, physical reconciliation of every settled adoption, no replay after an artifact rollback, and multiblock source/context edit/recompression whose next real request matches flush/status. Earlier incomplete-output, unknown-usage, cancelled-job retention and bootstrap-documentation fixes remain green. No Pi source patches, credentials or paid calls were used.

The review's default-LF formatting command failed for 25 unchanged Windows CRLF files. `core.autocrlf=true` caused the checkout difference; the explicit `endOfLine: auto` configuration makes the ordinary command pass without changing runtime files. Earlier localhost connection and Windows initialization incidents were preserved; their underlying environmental cause remains unproven. No such infrastructure failure occurred in the final independent review.

The complete verdict, source/installed logs and prior failure evidence are archived outside temporary consumers under `D:/Projects/kappa/kappa-experiments/pakka-dynamite-migration/DELIVERY/`. The strategy delivery scope and runnable instructions are in the sibling `pakka-dynamite/docs/MIGRATION-RESULTS.md`. Package-source tests and bootstrap scripts are committed; generated evidence remains local and private.

Storage claims remain bounded to single-writer recovery. This delivery does not implement full C2 crash recovery, multi-process transactions, exactly-once billing, arbitrary provider/extension compatibility, TUI/CLI/RPC or bulk legacy import. The host still has no dependency on Dynamite.

## Historical host-component verification

The following records the earlier host-only lane and its 82-test gate, before cross-package integration and independent correction passes. Its counts and pending-review wording are historical rather than the current delivery status.

# Verification - Host Strategy Control Component

Environment: Windows, Node 24.15.0, npm 11.12.1, TypeScript 7.0.2; exact eight-package Pi runtime cohort 1.0.3. Baseline: `4c79c57a2b151f9e9d74177747d5586bd81a3dac`; lane: `migration/host-control` in the assigned isolated host worktree.

This is a generic host component, not a completed Dynamite integration or full Kappa product. The strategy algorithm, plugin/default composition and independent integration review belong to later lanes. No paid model calls, user credential reads/changes, Pi source patches/private-method overrides, sibling checkout edits, pushes or publication occurred. The component is committed locally as requested by the lane contract.

## Executed Gates

| Command                                      | Latest result                                                                 | Evidence                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run check`                              | Passed                                                                        | `artifacts/host-control/recovery-check.log`                               |
| `npm run build`                              | Passed                                                                        | `artifacts/host-control/recovery-build.log`                               |
| `npm test`                                   | **82/82 passed**, no skipped/cancelled tests; original 22 preserved           | `artifacts/host-control/recovery-tests-2.log`                             |
| `npm run format:check -- --end-of-line auto` | Passed                                                                        | `artifacts/host-control/recovery-format-2.log`                            |
| `npm run smoke:package`                      | Passed: external tarball install, public declarations, six localhost requests | `artifacts/host-control/recovery-package.log`, `artifacts/package-smoke/` |
| `git diff --check`                           | Passed                                                                        | No whitespace errors                                                      |

The plain default-LF format command reports CRLF differences in untouched Windows baseline files. The explicit auto-end-of-line gate validates style without unrelated line-ending churn. Newly edited sources were formatted. The API declaration block in `docs/STRATEGY-API.md` was compared exactly against `src/types.ts` (`artifacts/host-control/api-match.log`).

One first recovery full-suite run, launched concurrently with other gates, had three seed failures before any HTTP with `Connection error.` (`recovery-tests.log`). The same tests passed alone (`recovery-seed-repro.log`) and the subsequent serial full run passed 82/82. The underlying transient localhost transport cause was not established; no production retry or test retry was added to hide it.

## Real HTTP Evidence

The final full-run manifest contains **87 fixtures, 139 localhost HTTP requests, zero fixture server errors** (`artifacts/host-control/recovery-http-inventory.json`). Multiple fixtures are used for table-driven storage/bootstrap cases. It contains 117 main requests, 21 summary-model requests with actual `max_tokens` 64/128, and one explicit fallback request capped at 256 (caller zero means no extra caller cap, not unlimited spending).

The external installed consumer made **six** HTTP requests. Two auxiliary payloads contain actual `max_tokens: 64` and `128`; its main JSONL is byte-for-byte unchanged during those calls. Projection still applies after real reload, `summary: null` omits the source without a placeholder, system text survives, and raw source remains persisted. It also checks a physical artifact receipt and rejects the private adapter subpath.

The external consumer is outside the repository and installs `pakka-agent-0.1.0.tgz` with no root workspace overrides or ancestor workspace resolution. Its TypeScript declaration consumer compiles with strict NodeNext settings. The installed inventory verifies coding-agent, ai, agent-core, tui, chord, codemode, mcp and telemetry all **1.0.3**. The tarball and consumer paths, SHA/integrity and install/declaration/dependency/runtime logs are recorded under `artifacts/package-smoke/`.

## Coverage

| Area                                      | Behavioral evidence                                                                                                                                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original C2/permission/lifecycle boundary | All 22 baseline tests retained without rewriting their oracles: native steer/follow-up, drain/cancel, idempotency, physical receipt, tool side effect/storage failure, reentrancy, recovery                                             |
| Binding authority                         | Wrong principal, missing strategy, artifact-only projection, exact hook ownership, deactivated/copied/stale authority                                                                                                                   |
| Atomic frame                              | Raw ID/parentage, effective context edits, system/loadout checkpoints, excluded bash and versioned scoped records                                                                                                                       |
| Request gate                              | Projector throw, copied basis, missing entry, protected target and owner revocation send no next HTTP; reload installation is idempotent; own writes require explicit basis rebase                                                      |
| Native protocol                           | Changes to call IDs/names/arguments, forged/dangling/reversed pairs and range splits rejected; valid text reduction preserves native declarations/IDs/arguments on wire; protected mid-pair checkpoint survives                         |
| Explicit omission                         | Existing summary reduced to no replacement text without source resurrection; remaining tail/checkpoints survive; complete native pair can be omitted, split pair/checkpoint-crossing/stale job cannot                                   |
| Source jobs                               | Normal tail growth succeeds; target/previous-context edits, completed candidate edits, generation change, newSession, owner revocation, navigation ABA and disposal prevent publication/future attempts                                 |
| Inference                                 | Separate explicit grant, sanitized allowlist, finite budgets, consumed 64/128 wire caps, explicit ordered fallback with fixed input, unknown usage/cost and pending reservations observable; no main transcript/C2 pollution            |
| Storage                                   | Strict namespace/version receipts; partial/truncated/missing whole journal directory or file fail closed; real readonly append fault returns unknown and blocks model replay; spent budget survives reload/re-activation/process reopen |
| Transition fault                          | Same-session late audit write uncertainty during reload stays latched; explicit newSession can recover while the previous session's audit remains faulty                                                                                |
| Tool invocation                           | Old explicit scope and async-local no-argument frame refresh both refused across lifecycle changes                                                                                                                                      |
| Trusted reopen                            | Physical Pakka-owned identity/entry/record preservation under new authority; absent/corrupt/foreign requested reopen never falls back to a new session; C2 claims are not reconstructed                                                 |

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

## Pi Durable contract corrections — 2026-10-11

These results supplement the historical AgentSession verification above. The default production
runtime now uses the version-pinned downstream `pi-durable@1.0.3-pakka.1`; it is not an upstream
release or an independently reviewed full-product delivery. See
[compatibility entry DURABLE-2026-10-11-5](PI-DURABLE-COMPATIBILITY.md) and
[the source patch/build contract](../patches/pi-durable/1.0.3-pakka.1/README.md).

| Gate                                                     | Result                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Clean `npm ci --ignore-scripts` + check                  | Passed                                                                            |
| Full Pakka source suite                                  | 127/127; no skips/cancellations                                                   |
| Isolated patched Durable generation/recovery/inbox/tools | 105/105                                                                           |
| Build and format check                                   | Passed                                                                            |
| Outside-repository tarball consumer                      | 7 HTTP calls; blocked request adds zero calls                                     |
| Consumer production dependencies                         | No `pi-coding-agent` or AgentSession oracle                                       |
| Public backend/private subpaths                          | Oracle backend rejected; adapter subpaths rejected                                |
| Request/source authority                                 | Request-scoped checks after hooks and at provider payload boundary                |
| Durable storage                                          | Blocked task/submission persists through reopen; interrupted request reauthorizes |

An intentional projector `{ status: "blocked", basis, reason }` leaves admitted input committed,
adds `receipt.generation = { status: "blocked", reason }`, and leaves the Host ready. It appends no
assistant error entry and does not replay on duplicate input or reopen. The post-tool test proves
that a refusal of the next model request settles already-placed steering too and preserves prior
tool effects. Malformed protocols and unknown storage continue to fail closed.

The former adapter resides only at `packages/agent/test/pi-adapter.ts`, injected by test fixtures;
production construction, imports, compiled output and installed dependencies use Durable only.
Tarballs must be generated with `npm run pack:agent`; hoisted workspace packing is rejected.
The staged pack uses the audited file dependency as input, then publishes an exact-version manifest
and bundles the installed Durable release. The consumer runs with installation scripts disabled
and no workspace overrides.

The 501-input pagination test is a completion/correctness test with a 180-second budget; an isolated
run took about 73 seconds. This is not evidence of equal latency to the original adapter. Automatic
retry and compaction remain disabled; deferred model requests, arbitrary provider families,
full C2 recovery and Dynamite integration are not newly claimed by these fixes.

## Monorepo/MAS M0 — blocked Durable × Dynamite pairing

The first implementation slice is on `feat/monorepo-mas-migration`, based on documentation
commit `84bffb141bc610ed0c322e081c192a0e39508c4b` (production code unchanged from `6c77632`).
The executable gate is `npm run test:dynamite`; pins and limits are in
[integrations/dynamite](../integrations/dynamite/README.md). This is not M0 completion or MAS acceptance.

| Gate                                                             | Initial result                                                                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Pakka check/build/format and source tests                        | Passed; 127/127, no skips/cancellations                                                                          |
| Outside-workspace installation of current host + pinned Dynamite | Passed; actual tarballs, public declarations and dependency inventory verified                                   |
| Installed host smoke                                             | Passed; 7 local HTTP requests, 64/128 caps, zero added blocked dispatch, private imports rejected, oracle absent |
| Installed Dynamite at `5ff775aee041fe63a82a7fcd1d108d17c206da4e` | **Blocked**; 1/6 passed, 5 behavior assertions failed, no skips                                                  |

Initial evidence is `artifacts/dynamite/run-JVQkFr/summary.json`; the hardened gate's complete
rerun is `artifacts/dynamite/run-pANLhY/summary.json`, including both actual tarballs. Both runs
produce the same five compatibility failures and passing host smoke. Eight failing-first
acceptance-parser regressions pass and reject missing/duplicate counts, missing tests,
skip/todo/cancellation and inconsistent pass totals even if a test process returns zero.
The summary records Node 24.18.0, npm 11.16.0, TypeScript 7.0.2, both tarball identities and
the audited Durable `1.0.3-pakka.1` SHA-256. Model tests use only deterministic localhost
providers and isolated profiles, not real credentials or paid endpoints. Source checkouts
are fixed and unmodified; no sibling repository was edited.

The pinned external adapter's `toRuntimeFrame()` (`src/pakka-adapter.ts:31–51`) still maps
legacy `message/custom_message` into algorithm inputs. Current Durable entries are `pi.*`
with `model[]`. The next real request has no numbering, `reduce("#1")` accepts no target,
and compression sends no auxiliary HTTP request. The recovery test fails at its initial
reduce assertion; it is not evidence that reopen itself failed. Matching versions and
successful declaration compilation do not establish behavior compatibility.

The gate intentionally returns nonzero for this pairing. The mapping/version repair and
remaining source-edit/ABA/unknown-storage integration matrix are prerequisites to M1;
production code is not changed to impersonate legacy raw entries. Historical integration
numbers above remain historical and do not override this blocked result.

A fresh-context, read-only adversarial review followed by one bounded follow-up concluded
`OK with notes` for committing the local gate and **blocked** for passing M0. There are no
remaining local gate implementation blockers. Both reports and the parent disposition
are retained beside the final run; this verdict does not waive the remaining M0 matrix
or authorize MAS production capabilities.

## Monorepo/MAS M1 — accepted Conversation runtime

M1 is accepted on `feat/monorepo-mas-migration`, `@pakka/agent@0.2.0`: 156/156 real
production-path tests, zero skipped/cancelled/todo, check/build/format and external tarball
consumption passed. Legacy installed smoke used 7 local HTTP calls and managed runtime
used 3; pure inspection/reopen dispatches zero new HTTP. The final 228-fixture manifest
contains 831 requests and zero provider fixture errors. Two bounded read-only review
rounds converged OK, with exact limitations and identity in
[MIGRATION-M1-ACCEPTANCE.md](MIGRATION-M1-ACCEPTANCE.md).

M1 retains authority isolation, conservative Session and strategy budgets, exact withdrawal
confirmation, physical unknown failure domains and explicit restricted legacy journal mapping.
It does not implement MAS membership/A2A, crash claim recovery, worker or remote protocol.
The earlier M0 prerequisite wording is historical: the user subsequently authorized
Dynamite compatibility to remain **deferred / unresolved** with its complete
[DC-01–DC-12 goals](DEFERRED-DYNAMITE-COMPATIBILITY.md), allowing M1–M6 to proceed.
M0 is not passed, and Dynamite is not loaded or claimed compatible.

## 4.2 Same-Session MAS M2 — accepted

M2 is accepted on `feat/monorepo-mas-migration`: `@pakka/agent@0.3.0` and `@pakka/mas@0.1.0`. The final production-path suite is 176/176, focused MAS/ownership is 17/17, the final authority regressions are 2/2, and the installed tarball consumer passes with legacy/runtime/MAS local HTTP counts of 7/3/3. Evidence, review disposition and limits are in [MIGRATION-M2-ACCEPTANCE.md](MIGRATION-M2-ACCEPTANCE.md).

M2 covers same-Session atomic enrollment/activation, principal/source/owner policy, native prompt/steer/followUp delivery, durable duplicate/conflict receipts, task/temporary/background lifetimes, retirement and unknown persistence. It does not claim cross-Session transaction/transport, independent process workers, DevPack or remote protocol. Dynamite remains deferred and uninstalled.

## Multi-Session broker and workers M3 — accepted with notes

M3 is accepted on `feat/monorepo-mas-migration`: `@pakka/agent@0.4.0`, `@pakka/mas@0.2.0`, private `@pakka/server@0.1.0`. Clean install/check/build/format, 196/196 full tests, 20/20 focused tests, actual independent-process workers and outside-repository tarball consumers passed (legacy/runtime/MAS/broker local HTTP: 7/3/3/3). Reopen after lost admission reuses the same native identity and adds zero HTTP; forced exits retain unknown writer claims.

Two bounded operator-selected adversarial-review passes converged OK with notes, not zero residual risk or a complete product claim. Exact hashes, surviving support limits, nested native receipt decoding note, review attribution/citation corrections and reproduction commands are in [MIGRATION-M3-ACCEPTANCE.md](MIGRATION-M3-ACCEPTANCE.md). DevPack, public protocol/server/client/CLI and Dynamite remain later gates.

## Optional MAS DevPack M4 — accepted with notes

M4 is accepted on `feat/monorepo-mas-migration`: agent `0.5.0`, mas `0.3.0`, mas-devpack `0.1.0` and private server `0.2.0`. Final offline clean staging install/build/check/format, full **216/216**, focused **20/20**, review-fix **8/8** and isolated tarball consumers passed (legacy/runtime/MAS/broker/DevPack **7/3/3/3/8** local HTTP calls). Native model tool calls exercise optional contributions, approved creation locations, real temporary task ownership, reply receipts, bounded ask, revocation and removal. The worker grant-escalation counterexample drops unauthorized peer HTTP from one to zero; 40 distinct fixed slots succeed across one/two service instances on real CAS without provider dispatch.

Two bounded operator-selected adversarial-review passes converge OK with notes, no P0/P1. Both actual structured opinions and all disagreements/citation corrections are retained; final report-only notes are test source/dist hygiene and the documented unapproved-template denied/unknown split. Fixed tarball/SDK identities, raw failing cases, final executable gates and limits are in [MIGRATION-M4-ACCEPTANCE.md](MIGRATION-M4-ACCEPTANCE.md). M4 does not implement public transport/CLI, hostile-code isolation or complete crash recovery. Dynamite stays deferred and uninstalled.
