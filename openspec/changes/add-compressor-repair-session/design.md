## Context

See [proposal](proposal.md) for operator requirements. The operator selected Pi Durable 1.4.0 as the evaluation baseline. This design now uses the fixed standalone `1.4.0-pakka.1` archive with Pi AI/Chord/Telemetry 1.4.0. The [1.4-specific characterization](../../../docs/verification/COMPRESSOR-SESSION-1.4-FEASIBILITY.md) measures 18 public-API cases and 51 real HTTP requests in an isolated install.

The [initial characterization](../../../docs/verification/COMPRESSOR-SESSION-FEASIBILITY.md) used host acf49fa with Durable 1.0.3-pakka.1 and strategy 87d6fa6/0.3.0 (retry observation in 0427185). It remains historical, not a 1.4 capability verdict. Current SourceJob.infer is single-call and each failed strategy attempt restarts from the original input.

This remains an infrastructure assessment, not product implementation or cohort promotion. The 1.4 result recommends a native hook/inbox/scheduler route. No custom agent loop or dependency upgrade has been selected.

## Goals / Non-Goals

**Goals:** preserve the source-bound trajectory; count tool and other recoverable errors independently; seal at either exact count and report the last reason; reuse native infrastructure and charge every continuation to the original auxiliary policy.

**Non-Goals for this investigation:** implement a custom loop, release a new pairing, promote the prepared Durable 1.4 cohort, or use product Conversations as an inference-policy bypass. Independent adversarial review is not selected under the operator instruction.

## Decisions

### Compresser container and source-job cardinality

The operator clarified that Pakka-dynamite maintains one long-lived native Session, named the Compresser Session. Its internal Conversations serve ordinary external business Sessions/Conversations, which are not nested in that Session. One external Conversation can trigger multiple Compresser Conversations, each with an independently bound compression job/context. There is no preset Conversation-count quota.

Use the host-owned port to map each authorized external source Session/Conversation plus job/context identity to an internal Conversation ID. Do not key that mapping uniquely by external Conversation ID or create a fresh Session per compression job. Re-admission of the same job must preserve its binding and receipts; unrelated jobs must not share a transcript. Dynamite owns the logical service lifecycle; all mutable native handles remain in the adapter. Session policy holds the previously required cumulative tolerances/seal, while Conversation-local records hold source bindings, repair trajectories, candidates and job outcomes. Opening a new Conversation cannot reset the Session policy.

This replaces the earlier single-root container recommendation, not the measured single-Conversation traces. A change to Conversation-local error tolerances would be a separate policy decision; it is not inferred from the topology clarification.

### Adopted lifecycle requirement

Use two cumulative per-session counts, not consecutive-error counts or whole-prompt retries. Values 3 and 4 are operator examples and probe inputs; public defaults remain a future API decision. Complete replacement calls reuse prior visible analysis and stand alone. Source/lease revocation, cancellation, hard budget exhaustion and persistence unknown remain earlier terminal boundaries.

### Native primitives confirmed

The isolated capability cases used a dedicated public Durable Harness/root Conversation in independent storage. Generation onYield adds a final-boundary continuation inside the original logical run; successful tool control.terminate avoids an extra request. Generation afterTools sees invalid-schema and unavailable-tool results that bypass ToolHooks. A persistent latest-only Conversation document plus beforeRequest block retained the probe counters and seal across normal reopen. The product topology needs Session-scoped policy and separate Conversation job records; the earlier experiment did not prove cross-Conversation isolation or shared-counter enforcement. Stable task/result identities support idempotent incident recording.

An onYield continuation is not an externally queued steer. Hook exceptions are report-and-skip; a seal/authorization guard must explicitly block and retain a failure latch instead of relying on a throw.

### Provider-error continuation on 1.4

The 1.0.3 provider-error gap is not the 1.4 verdict. With `afterFailedRun: "continue"`, an `afterResponse(error)` hook can record an unresolved incident and durably admit one corrective native `whenBusy: "steer"` input while the run is still active. The native failed-run boundary settles the original input, places that correction and schedules the next native run in the same Conversation. No outer inference loop is needed. A `keep` control leaves the correction queued; a `continue` control without an admitted correction makes no extra request.

A Compresser Conversation can span multiple native runs. The original submission remains truthfully `unanswered/model_error` even if that job later succeeds. Native `done` after an incomplete stop is likewise not proof of a valid candidate. The host must report the retained job status/candidate, not use the first Submission.wait() as that job’s completion signal. Completing one job does not complete the long-lived Compresser Session.

### Remaining host integration boundaries

1. The existing Pakka SourceJob.infer remains a single-call interface. The earlier production probe used 1.0.3 and spent primary rather than auxiliary slots through ordinary managed-member APIs; it did not test a migrated 1.4 product. The multi-Conversation Compresser service still needs an adapter-owned port binding each internal Conversation to its external source job, per-request reservation/completion, revocation and final adoption checks. Granting bootstrap Runtime or mutable Conversation handles to a strategy is not an acceptable shortcut.
2. Native validation can repair/coerce arguments, and schema/unknown-tool errors bypass afterTool. The 1.4 prototype uses public afterTools context edits for full matched rewrite feedback and composed public OpenAI-completions callbacks for strict raw equality. Truncated JSON was rejected by native validation, but an illegal escape was repaired by the SDK and had to be rejected by the raw guard. Valid fragmented arguments succeeded.
3. Retained Session policy and source-bound Conversation job records must coordinate incidents, queue admission and native settlement. Normal single-Conversation sealing/reopen is measured; shared Session accounting, arbitrary crash atomicity and production artifact adoption are not. Unconfirmed effects must fail closed before scheduling can resume.

### Recommended native route

- One long-lived native Compresser Session with one storage writer; create independent Conversations for source-bound compression jobs. Multiple jobs from one external Conversation may use multiple internal Conversations. Do not add a Conversation-count ceiling; source authority, admission budgets and resource scheduling remain separate controls.
- On incomplete normal stop, record one unresolved incident; below tolerance, admit native steering with complete-submission instructions. Native onYield continuation is also feasible, but remains a distinct operation rather than being relabeled steering.
- Return matched full-replacement results for tool errors; use afterTools to cover pre-execution schema/name failures. Validate the whole response before any candidate can be staged, including rejecting duplicate calls.
- On provider/request error, record one unresolved incident and admit at most one stable-ID native steer below tolerance; `afterFailedRun: "continue"` performs the native boundary placement and scheduling. Disable hidden native/provider retries so policy observes every attempt.
- Reaching either cumulative Session threshold seals the container before further repair/job admission, dispatch or adoption by any child, preserving the final diagnostic, originating job and both counts. Host command admission and native request/payload checks refuse further work. Do not reset counts by changing models, opening another Conversation or by the legacy outer retry loop opening another Session.

The 1.4 mechanism needs policy hooks and host-bound admission, but does not require rebuilding provider streaming, tool execution, history or scheduling. No additional downstream failure-continuation patch is demonstrated necessary. A custom agent loop is not recommended by this evidence. Product DTO/defaults/receipt/recovery choices and the separate cohort migration remain unfinished.

## Risks / Trade-offs

- The Compresser Session has one storage writer. It separates storage ownership from external business Sessions, not processes; external source authority and budgets require explicit linkage. Concurrent children share the Session seal, so already in-flight results must recheck it before staging/adoption.
- Hook document commits and generation settlement are separate transactions. The probe tests normal reopen and stable identities, not crash atomicity at every boundary.
- Both native and provider automatic retries are disabled in the probe. Product accounting must reserve and expose every request.
- Multiple/duplicate calls in a round require whole-envelope validation before any candidate adoption.
- Raw inspection depends on provider support. The proof covers deterministic OpenAI-completions events, not every provider or delta fragmentation pattern; missing evidence must fail closed.
- Close acknowledgment alone is not sealing; retained terminal status must guard scheduling and old capabilities.

## Implementation gate

For the recommended 1.4 native route, first define the source-job DTO/port, receipt ownership and interrupted-session recovery, and coordinate the existing cohort-migration tasks. Then write failure-first production tests and implement adapter-local native ownership. Cover multiple compression jobs from one external Conversation, external Session isolation, shared Session thresholds, sibling late-result refusal, real repair messages, budgets, revocation, unknown storage and reopen before fixing a separate package pair. The single-call primitive remains compatible.
