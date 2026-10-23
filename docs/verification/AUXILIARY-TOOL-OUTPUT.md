# Auxiliary Tool Calling — fixed library verification

Date: 2026-10-23. The affected source and installed-consumer checks below have passed; independent dual review is blocked by reviewer routing, so final acceptance and OpenSpec archive remain open. The owning work is [add-auxiliary-tool-output](../../openspec/changes/add-auxiliary-tool-output/tasks.md). This record covers the additive host output channel and the independent strategy library, with OpenAI-completions-compatible deterministic localhost providers. It does not change the [accepted optional server/worker product pairing](DYNAMITE-PRODUCT-ACCEPTANCE.md).

## Identities and scope

- Host: private `@pakka/agent@0.5.1`; source baseline `9cbd1476e61dcc21c1f121acdaa58ef8e91d8168`, plus the source change reviewed in this work.
- Host archive SHA-256: `a11e6a11a31eae00623747c68603349dc7751c527523390e785eb0b2926c5eed`.
- Strategy: private `@pakka/dynamite@0.3.0`; source baseline `dcc378abb839c277f78dc240035bb5c19d6ad318` in the independent `pakka-dynamite` repository. Installed archive SHA-256: `1edc313d857de18dbcf216ce46e406ba3493be7978adab86c53a664cec704f44`.
- Production cohort remains Pi AI/Chord/Telemetry `1.0.3`, bundled Durable `1.0.3-pakka.1`. No installed dependency was hand-edited.
- Historical `dynamite@0.2.1 × agent@0.5.0` evidence remains intact; its strategy-side pairing is saved byte-for-byte as `integrations/pakka/0.2.1-pairing.json`.

The optional `outputTool` is a declaration on one source-bound auxiliary inference, with detached `toolCall` output. Its existing budget reservation, exact attempt receipt, source/lifecycle checks and persistence rules govern acceptance. The adapter executes no returned tool. The public Pi tool stream must expose complete JSON argument deltas, whose strict parse equals the final argument DTO; absent or repaired bytes fail closed. This selected provider path has real HTTP coverage; no other provider family is inferred from it.

## Executed checks

| Object                                | Command/scope                                                                                                                                            | Result                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Host static contract                  | `npm run check`                                                                                                                                          | Passed                                                        |
| Audited host archive                  | `npm run pack:agent -- artifacts/auxiliary-tool-output/final-host`                                                                                       | Passed, SHA above                                             |
| Host strategy regression              | `node --expose-gc --experimental-strip-types --test --test-concurrency=1 packages/agent/test/strategy*.test.ts` with the wildcard expanded by PowerShell | 100/100                                                       |
| Host output-tool regression           | Same runner, `strategy-output-tool.test.ts`                                                                                                              | 10/10                                                         |
| Strategy source runner                | `npm test` from `pakka-dynamite`, consuming the pinned host archive                                                                                      | 369/369                                                       |
| Strategy public types/build           | `npm run typecheck`, build in `npm run smoke:package`                                                                                                    | Passed                                                        |
| OpenSpec                              | `openspec validate add-auxiliary-tool-output --strict`                                                                                                   | Passed                                                        |
| Outside-repository installed consumer | `npm run smoke:package -- D:/Projects/pakka` from `pakka-dynamite`                                                                                       | 56/56; 348 local HTTP; 0 provider errors; declarations passed |

All model requests in these tests use real Pi and synthetic local HTTP fixtures. Isolated HOME/USERPROFILE/PI_CODING_AGENT_DIR and `PI_OFFLINE=1` avoid user credentials. The GC gate requires `--expose-gc`; the initial run without it failed 4 retention prerequisites and is not reported as passing.

The real strategy path verifies one declaration/call, source-bound atomic run/block persistence, next-main-request P1-only projection, reduce, normal reopen, exact source provenance, stale read status, revocation, source edit, and allowed tail growth. Malformed, wrong, multiple, prose-only and truncated submissions retain usage and produce no active block. Reading sidecars performs no inference.

## Failure-first evidence

Tracked raw host evidence is under [evidence/auxiliary-tool-output](evidence/auxiliary-tool-output/). [Initial RED](evidence/auxiliary-tool-output/host-red.log) precedes host implementation. [Strict JSON RED](evidence/auxiliary-tool-output/strict-json-red.log) proves SDK repair accepted an unfinished object and an invalid escape under a `tool_calls` finish; [GREEN](evidence/auxiliary-tool-output/strict-json-green.log) covers the public streaming gate. [The full host result](evidence/auxiliary-tool-output/host-strategy-with-gc.log), [check](evidence/auxiliary-tool-output/check.log) and [OpenSpec result](evidence/auxiliary-tool-output/openspec-validation.log) retain raw counts.

Strategy-side durable evidence is maintained in its `docs/verification/TOOL-CALLING-ARTIFACTS.md` and `docs/verification/evidence/tool-calling/`. Parent-reproduced fixes include restoring source labels in failed-plan recent context and rejecting a candidate whose tool-call metadata would overflow its persisted bundle.

Schema and source-reference checks prove mechanical shape, provenance, persistence and rejection behavior. They do not establish semantic summary accuracy, graph causality, graph merging or independent P1 validation.

## Independent review and disposition

The first selected workflow `aba74ed4-972a-4026-b1c0-e3454500a458` failed launching B: its default `Mapleluv-ChatCompletions/deepseek-flash:high` is absent from the active registry. [A's report](evidence/auxiliary-tool-output/review-partial/a-first-review.md) and [failed receipt](evidence/auxiliary-tool-output/review-partial/workflow-receipt.json) are retained. A reported no issues and OK with notes, but this partial protocol is not a passing dual review. Its tool-choice and long-run-GC suggestions are unverified notes, not accepted bugs; the cited ordinary integration runner does not prove thousands of repeated compactions.

The same-protocol retry `8c5551f6-5ed6-4ddf-ae36-d31737b40cce` used the selected workflow unchanged on a fresh snapshot including the strict JSON fix and explicit registered B `Mapleluv-Main/deepseek-v4-flash:high`. A completed; B failed before producing an opinion with HTTP 400 `MissingSessionID` / missing `x-opencode-session`. The [unaltered A report](evidence/auxiliary-tool-output/review-partial/r2/a-first-review.md), [B failure](evidence/auxiliary-tool-output/review-partial/r2/b-first-failure.md), [terminal receipt](evidence/auxiliary-tool-output/review-partial/r2/workflow-receipt.json) and [parent disposition](evidence/auxiliary-tool-output/review-partial/r2/parent-disposition.md) are retained. No pending supervisor request remained.

A-1 correctly observes that an absent versions proof is stale, but supplies no actual production path omitting that proof. The installed no-context case stores the empty array and reports current; the parent retained that concrete evidence and did not relax conservative missing-proof handling. Both final opinions/disputes remain missing. The selected script has no B-only resume entry and native revival preserves B's failed model route; a full retry would repeat completed A work. The current no-repeat instruction therefore blocks another invocation pending an explicit full-protocol restart. No custom workflow or CLI fallback was used.
