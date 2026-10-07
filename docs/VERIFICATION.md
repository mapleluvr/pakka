# Verification — integrated host first slice

Environment: Windows, Node 24.15.0, npm 11.12.1; Pi runtime cohort 1.0.3.

## Executed gates

- TypeScript check: passed.
- Build to package dist: passed.
- Integration/regression suite: **22/22 passed** (no skipped cases in full run).
- Prettier format gate: passed.
- External tarball installation without workspace overrides: passed; eight Pi runtime packages all 1.0.3.
- Packed public API performed two actual local HTTP requests and a persisted context cut; private adapter subpath rejected.

No live model credentials, paid API calls, Pi source changes, private API overrides, git commits or publication.

## Test coverage

| Area                  | Main tests                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Confinement/discovery | Poison .pi extension is not loaded; frozen views/clients; runtime handles absent                   |
| Identity/admission    | Idempotent real request, conflict, physical entryId, handled/transform                             |
| Owner semantics       | Artifact-only rejection; atomic multi-hook conflict; exact author strategy                         |
| Context               | Cut/edit change HTTP context while raw history survives; target validation before writes           |
| Async authorization   | Owner revoked during policy await; new input invalidates approval; proposal copy/freeze            |
| Native queues         | Steering after tool result; follow-up in same native scheduling sequence                           |
| Cancellation          | Per-principal object cancellation and retry; same text with different identities                   |
| Drain/append window   | Only still-queued follow-up released; both drained steering inputs committed                       |
| Reload settings       | Same drain assertion before and after real reload                                                  |
| Lifecycle             | Revoke before active-tool await; reject concurrent replacement; queue not carried into new session |
| ABA                   | Final leaf/count restored, old capability still rejected                                           |
| Preparation           | Old generation cannot transfer or block admission into a replacement session                       |
| Storage failure       | Real tool executes; JSONL path made unwritable; host fails closed; no committed-input replay       |
| Recovery              | Reload cannot un-fail inconsistent state; explicit newSession starts fresh                         |
| Observer reentrancy   | Replacement requested from queued observer sees actual transferred queue item                      |

## Falsifications retained

1. Initial feature batches failed before their implementations: artifacts/tdd/01-red.log through 03-red.log.
2. Synchronous queued notification exposed a handoff gap: an observer could start replacement before insertion. 04-red.log reproduced queued instead of released; microtask publication closed it.
3. A failed host could be re-enabled by reload, and suspended old preparation could hold the new session slot. 05-red.log records both; phase guard and generation-scoped slot invalidation fixed them.
4. Setting Agent.steeringMode alone was lost during real reload. 06-red.log shows a second steering item was still queued instead of part of the drain batch. Public AgentSession.setSteeringMode now updates owned in-memory settings too.
5. External install chose 1.0.4 transitives despite three exact direct Pi dependencies. package-smoke/version-drift-red.log preserved; all eight tested runtime packages are now explicit exact dependencies.
6. The first smoke metadata resolver incorrectly used CommonJS resolution for ESM-only Pi exports; es-module-resolution-red.log preserved. The smoke resolver now uses ESM import.meta.resolve. This was a test-helper defect, not an SDK blocker.

## Inspect evidence

- artifacts/final-tests.log: full test output.
- artifacts/integration/manifest.jsonl: generated fixture artifact directories in execution order.
- Each fixture archive: requests.json, view.json, server-errors.json, sessions/\*.jsonl when present.
- artifacts/package-smoke/: pack/install/dependency-tree/smoke logs and external consumer path.
- artifacts/tdd/: failing-first and intermediate passing runs.

These generated artifacts are ignored by Git. Test sources and runnable verifiers are the durable reproduction. Earlier temporary fixtures are left intact; reruns do not use user profiles. The test runner replaces the current manifest but does not delete previous fixture archives.

## Interpretation limits

committed means an input entry was read back, not fsync or a successful whole run. The file-failure probe uses a real directory at the JSONL path, then restores the original fixture file; it is not an injected fake persistence result.

The suite exercises the integrated supported boundary, not all Pi APIs or the full developed-Kappa contract. No original-Kappa full-suite comparison, multi-process/crash recovery, malicious Node sandbox, TUI/RPC compatibility, complete preprocessing, or all provider variants were tested.

The package smoke is a real installed consumer, not tarball unpacked as a root workspace. It verifies today's exact dependency resolution and execution, not every possible consumer's overrides/conflicting dependencies.
