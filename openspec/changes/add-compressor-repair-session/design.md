## Context

See [proposal](proposal.md) for operator requirements. The operator selected Pi Durable 1.4.0 as the evaluation baseline. This design now uses the fixed standalone `1.4.0-pakka.1` archive with Pi AI/Chord/Telemetry 1.4.0. The [1.4-specific characterization](../../../docs/verification/COMPRESSOR-SESSION-1.4-FEASIBILITY.md) measures 18 public-API cases and 51 real HTTP requests in an isolated install.

The [initial characterization](../../../docs/verification/COMPRESSOR-SESSION-FEASIBILITY.md) used host acf49fa with Durable 1.0.3-pakka.1 and strategy 87d6fa6/0.3.0 (retry observation in 0427185). It remains historical, not a 1.4 capability verdict. Current SourceJob.infer is single-call and each failed strategy attempt restarts from the original input.

This remains an infrastructure assessment, not product implementation or cohort promotion. The 1.4 result recommends a native hook/inbox/scheduler route. No custom agent loop or dependency upgrade has been selected.

## Goals / Non-Goals

**Goals:** preserve the source-bound trajectory; count tool and other recoverable errors independently; seal at either exact count and report the last reason; reuse native infrastructure and charge every continuation to the original auxiliary policy.

**Non-Goals for this investigation:** implement a custom loop, release a new pairing, promote the prepared Durable 1.4 cohort, or use product Conversations as an inference-policy bypass. Independent adversarial review is not selected under the operator instruction.

## Decisions

### Adopted lifecycle requirement

Use two cumulative per-session counts, not consecutive-error counts or whole-prompt retries. Values 3 and 4 are operator examples and probe inputs; public defaults remain a future API decision. Complete replacement calls reuse prior visible analysis and stand alone. Source/lease revocation, cancellation, hard budget exhaustion and persistence unknown remain earlier terminal boundaries.

### Native primitives confirmed

A dedicated public Durable Harness/root Conversation retains its trajectory in independent storage. Generation onYield adds a final-boundary continuation inside the original logical run; successful tool control.terminate avoids an extra request. Generation afterTools sees invalid-schema and unavailable-tool results that bypass ToolHooks. A persistent latest-only Conversation document plus beforeRequest block retains counters and seal across normal reopen. Stable task/result identities support idempotent incident recording.

An onYield continuation is not an externally queued steer. Hook exceptions are report-and-skip; a seal/authorization guard must explicitly block and retain a failure latch instead of relying on a throw.

### Provider-error continuation on 1.4

The 1.0.3 provider-error gap is not the 1.4 verdict. With `afterFailedRun: "continue"`, an `afterResponse(error)` hook can record an unresolved incident and durably admit one corrective native `whenBusy: "steer"` input while the run is still active. The native failed-run boundary settles the original input, places that correction and schedules the next native run in the same Conversation. No outer inference loop is needed. A `keep` control leaves the correction queued; a `continue` control without an admitted correction makes no extra request.

A Compresser Session can span multiple native runs. The original submission remains truthfully `unanswered/model_error` even if the compressor later succeeds. Native `done` after an incomplete stop is likewise not proof of a valid candidate. The host must report the retained compressor status/candidate, not use the first Submission.wait() as the overall completion signal.

### Remaining host integration boundaries

1. The existing Pakka SourceJob.infer remains a single-call interface. The earlier production probe used 1.0.3 and spent primary rather than auxiliary slots through ordinary managed-member APIs; it did not test a migrated 1.4 product. A source-bound auxiliary Conversation still needs an adapter-owned port, per-request reservation/completion, revocation and final adoption checks. Granting bootstrap Runtime or mutable Conversation handles to a strategy is not an acceptable shortcut.
2. Native validation can repair/coerce arguments, and schema/unknown-tool errors bypass afterTool. The 1.4 prototype uses public afterTools context edits for full matched rewrite feedback and composed public OpenAI-completions callbacks for strict raw equality. Truncated JSON was rejected by native validation, but an illegal escape was repaired by the SDK and had to be rejected by the raw guard. Valid fragmented arguments succeeded.
3. A separate immutable source-bound policy record must coordinate incidents, queue admission and native settlement. Normal sealing/reopen is measured; arbitrary crash atomicity and production artifact adoption are not. Unconfirmed effects must fail closed before scheduling can resume.

### Recommended native route

- One dedicated native Session/root Conversation per compressor session, with one storage writer and source identity held by the host adapter.
- On incomplete normal stop, record one unresolved incident; below tolerance, admit native steering with complete-submission instructions. Native onYield continuation is also feasible, but remains a distinct operation rather than being relabeled steering.
- Return matched full-replacement results for tool errors; use afterTools to cover pre-execution schema/name failures. Validate the whole response before any candidate can be staged, including rejecting duplicate calls.
- On provider/request error, record one unresolved incident and admit at most one stable-ID native steer below tolerance; `afterFailedRun: "continue"` performs the native boundary placement and scheduling. Disable hidden native/provider retries so policy observes every attempt.
- Reaching either cumulative threshold seals before repair admission or adoption, preserving the final diagnostic and both counts. Host command admission and native request/payload checks refuse further work. Do not reset counts by changing models or by the legacy outer retry loop opening another session.

The 1.4 mechanism needs policy hooks and host-bound admission, but does not require rebuilding provider streaming, tool execution, history or scheduling. No additional downstream failure-continuation patch is demonstrated necessary. A custom agent loop is not recommended by this evidence. Product DTO/defaults/receipt/recovery choices and the separate cohort migration remain unfinished.

## Risks / Trade-offs

- Independent storage separates writers/failure domains, not processes; parent source authority and cumulative budgets require explicit linkage.
- Hook document commits and generation settlement are separate transactions. The probe tests normal reopen and stable identities, not crash atomicity at every boundary.
- Both native and provider automatic retries are disabled in the probe. Product accounting must reserve and expose every request.
- Multiple/duplicate calls in a round require whole-envelope validation before any candidate adoption.
- Raw inspection depends on provider support. The proof covers deterministic OpenAI-completions events, not every provider or delta fragmentation pattern; missing evidence must fail closed.
- Close acknowledgment alone is not sealing; retained terminal status must guard scheduling and old capabilities.

## Implementation gate

For the recommended 1.4 native route, first define the source-job DTO/port, receipt ownership and interrupted-session recovery, and coordinate the existing cohort-migration tasks. Then write failure-first production tests and implement adapter-local native ownership. Cover real messages, thresholds, late-result refusal, budgets, revocation, unknown storage and reopen before fixing a separate package pair. The single-call primitive remains compatible.
