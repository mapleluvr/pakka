# Compresser repair on Pi Durable 1.4.0

## Scope and verdict

On 2026-10-23 the operator selected Pi Durable 1.4.0 as the design-evaluation baseline. The fixed downstream archive `1.4.0-pakka.1`, with Pi AI, Chord and Telemetry `1.4.0`, can implement the requested conversational repair, independent cumulative tolerances and retained seal using public native hooks, tools, inbox steering and scheduling. There is no evidence-based need to select a custom agent loop for these behaviors. This is a capability result and recommended route, not a production implementation or cohort promotion.

The [initial 1.0.3 investigation](COMPRESSOR-SESSION-FEASIBILITY.md) remains version-scoped historical evidence. Its provider-error continuation limitation must not be used as a 1.4.0 verdict. Current workspace production dependencies were not changed by this assessment.

The [state](../state/compressor-session.md), [change record](../changes/compressor-repair-session.md), [design](../../openspec/changes/add-compressor-repair-session/design.md), [tasks](../../openspec/changes/add-compressor-repair-session/tasks.md) and [complete delta](../../openspec/changes/add-compressor-repair-session/specs/compressor-repair-session/spec.md) separate lifecycle requirements, the recommended route and unfinished product work.

## Fixed subject and method

- Archive: `packages/agent/vendor/earendil-works-pi-durable-1.4.0-pakka.1.tgz`, SHA-256 `7fd9f3310dfa003a9077139a25faf93567922a065461fa3767dd5a1066efa891`.
- Independent npm project under ignored `docs/.temp/compressor-native-1.4`; no workspace overrides, source aliases, dependency edits or monkey patches. `scripts/verify-durable-patch.mjs 1.4.0-pakka.1` and actual ESM resolution confirmed the exact cohort.
- Real public `Harness`, root Conversation, `GenerationTask`/`ToolTask` hooks, native inbox and fsynced JSONL storage; real OpenAI-completions HTTP/SSE on loopback. Representative P1/P2/P3/P4 schema and a fixture source predicate exercise native boundaries, not the full production artifact validator.
- Each case starts a separate Session and storage. Both SDK and native automatic retries are disabled. The only start call submits the original source input; no outer loop submits subsequent requests. Hook-admitted corrective inputs are explicitly native `whenBusy: "steer"` inputs.
- A composed public provider callback retains and invokes the existing callback chain while observing fragmented wire arguments. Raw JSON equality rejects coercion or repair before candidate staging.
- The child process receives a clean environment with isolated HOME/profile and a synthetic local key; no user credentials, paid model calls, GUI or adversarial review.

## Results

**18/18 cases; 51 HTTP requests; 0 native reports; 0 server errors.** The [machine summary](evidence/compressor-session-1.4/summary.json), [raw log](evidence/compressor-session-1.4/probe.log), [resolved cohort](evidence/compressor-session-1.4/cohort.json) and [SHA-256 manifest](evidence/compressor-session-1.4/sha256.json) are retained.

| Case | HTTP | Observation |
| --- | ---: | --- |
| `keep-control` | 1 | A hook queues a correction, but `afterFailedRun: "keep"` leaves it queued; no inferred continuation. |
| `continue-without-input` | 1 | `afterFailedRun: "continue"` alone creates no retry. |
| `provider-auto-success` | 4 | Three provider errors queue three native steer corrections; the fourth request accepts a complete candidate. |
| `provider-limit-400` / `provider-limit-500` | 4 each | Fourth error seals at unresolved count 4; only three corrections admitted, no fifth HTTP; final reason is `provider-failure-4`. |
| `stop-limit-continue` / `stop-limit-steer` | 4 each | Both native final continuation and actual inbox steering preserve the earlier draft and seal on the fourth incomplete stop. |
| `tool-limit` | 3 | Missing schema field, foreign source and unavailable tool reach tool count 3; no fourth HTTP and no candidate execution. |
| `tool-replacement` | 2 | The next request contains the rejected call and its matching tool-call ID, diagnostic and full replacement instruction; no partial merge. |
| `mixed` | 6 | Two tool errors, three unresolved errors and then success retain one Conversation and earlier analysis across the provider-error boundary. |
| `strict-json` | 2 | Native argument validation rejects the truncated JSON; a later complete call split across three SSE fragments succeeds. |
| `coercion` | 2 | The raw-argument guard rejects SDK/schema coercion; a complete replacement succeeds. |
| `invalid-escape` | 2 | The SDK repairs an illegal escape, so the raw guard rejects it before execution and supplies matched full-rewrite feedback. |
| `length` | 2 | Output truncation increments unresolved, not tool, and the next request retains the earlier draft. |
| `socket-error` | 3 | A dropped HTTP connection follows the native provider-error repair boundary; prior visible analysis remains in the successful request. |
| `duplicate-calls` | 2 | Whole-response validation blocks both otherwise-valid duplicate calls before either can stage a candidate. |
| `sealed-reopen` | 4 | Normal reopen preserves counts, last error and ProviderDoc; read-only reopen sends nothing. A late input is blocked without another HTTP. |
| `late-after-seal` | 1 | An explicit source seal before releasing a valid response prevents candidate execution and any next HTTP. |

Each case's `NAME.json` under [the evidence directory](evidence/compressor-session-1.4/) contains every actual provider request, hook trace, matched results, queued admission receipts, final policy and native usage/inspection. Physical JSONL storage for exact provider sealing and normal reopen is retained under [storage](evidence/compressor-session-1.4/storage/).

## Why the 1.4 route works

`afterFailedRun: "continue"` is queue disposition, not automatic provider retry. In `afterResponse(error)`, the host first records one unresolved incident. If the session remains open, it durably admits one correction with a stable `requestId` and `whenBusy: "steer"`, without waiting for its eventual answer inside the hook. The native failed-run boundary settles the original run, places the queued input and starts the next native run. Both negative controls above distinguish this mechanism from a hidden outer retry.

A Compresser Session therefore retains one Conversation but can span several native generation runs. The first submission's `unanswered/model_error` receipt remains truthful; it is not the Compresser Session's final result. Completion must come from the retained compressor policy/candidate record. Similarly, a native `done` after an incomplete stop is not proof of a valid compaction.

For normal stop, actual native steering is measured, as requested by the operator. `onYield` returning `{ continue }` is also measured but is a distinct native final-boundary operation, not relabeled as queued steering. Tool errors retain call-ID-matched results with a complete replacement instruction. Invalid-schema and unknown-tool paths bypass `afterTool`; aggregation must also use `GenerationTask.afterTools`.

On the incident reaching either threshold, persist the seal and final diagnostic, admit no repair, and refuse dispatch/adoption through closed-state guards. A host command gate should reject new commands before native admission; `beforeRequest` plus its payload-time check are additional defenses, not a reason to expose mutable native handles.

With only the submission tool, automatic retries disabled and every non-successful response assigned at least one error incident, tolerances 3 and 4 allow at most five nonterminal error responses and a sixth terminal error or success. Independent hard time/call/token budgets can terminate earlier. Additional non-error tools would require their own finite budget and do not inherit this six-request bound.

## Remaining product work and limits

1. Add an adapter-owned, source-job-bound auxiliary session port. Ordinary Pakka member APIs are not a substitute for auxiliary reservation/usage, lease/source checks, original receipt ownership and admission authority. The earlier primary-versus-auxiliary measurement used the 1.0.3 product; this probe does not claim a migrated 1.4 Pakka production path.
2. Coordinate cohort migration through its existing [1.4 product tasks](../../openspec/changes/prepare-durable-1-4-0-patch/tasks.md). A standalone SDK capability does not prove that the present Pakka adapter, every consumer or the existing Dynamite pairing works on the new cohort.
3. Define crash recovery for the policy write, native queue admission and generation settlement, which are separate transactions. Stable incident/request identities and fail-closed recovery of unconfirmed effects are required; normal reopen is measured, arbitrary crash atomicity is not. Read-only opening does not resume scheduling, so the host can inspect/rebind or seal before enabling progress.
4. Retain strict bounded wire integrity, complete-envelope/schema/source validation and final host adoption. The illegal-escape case demonstrates that 1.4 does not eliminate the raw-argument requirement. Multiple-call rounds must be rejected before any candidate is staged. The fixture predicate and staged document are not the production atomic artifact append.
5. Do not use the legacy outer model/attempt retry loop to create a fresh compressor session after a seal. Counter scope spans model changes; another session needs explicit authorized admission. Cancellation, revocation, hard budgets and unknown persistence remain terminal regardless of remaining tolerance.

The recommended implementation reuses native provider streaming, tool tasks, Conversation history, inbox placement, generation scheduling and storage. Host policy hooks and identity-bound commands are necessary integration, not an independent agent loop. No additional downstream generation patch is demonstrated necessary for this mechanism on the selected 1.4 baseline.

## Reproduction and earlier probe failures

Copy [the manifest](evidence/compressor-session-1.4/package.json), [lock](evidence/compressor-session-1.4/package-lock.json), [probe](evidence/compressor-session-1.4/probe-source.mjs.txt) as `probe.mjs` and [launcher](evidence/compressor-session-1.4/launcher-source.mjs.txt) as `run.mjs` into `docs/.temp/compressor-native-1.4`. Run `npm ci --ignore-scripts --workspaces=false` in that independent project with an empty npm user/global config; then run `node docs/.temp/compressor-native-1.4/run.mjs` from the repository root. The launcher isolates credentials and writes a new unique artifact run. Archive identity must still pass the versioned verification script.

Earlier probe failures are retained separately, not disguised as product red/green tests: [CJS resolution of import-only exports](evidence/compressor-session-1.4/earlier-probe-failures/esm-resolution-bootstrap.log), [over-specific stop/truncation assertions](evidence/compressor-session-1.4/earlier-probe-failures/stop-and-truncation-assertions.log) and [incorrectly expecting the native validator, rather than the raw guard, to reject a repaired escape](evidence/compressor-session-1.4/earlier-probe-failures/escape-boundary-assertion.log). Their fixes changed the experiment's resolution/assertions, not installed dependencies. The final source, traces and exact rejection layer remain inspectable.
