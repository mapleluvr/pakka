## Context

See [proposal](proposal.md) for operator requirements. The baseline is host acf49fa with pi-durable 1.0.3-pakka.1, Pi AI/Chord 1.0.3, and strategy 87d6fa6/0.3.0 (retry observation in 0427185). SourceJob.infer is single-call; each failed strategy attempt restarts from the original input.

This is an infrastructure investigation with an explicit reporting gate, not an adopted production architecture. The [fixed characterization](../../../docs/verification/COMPRESSOR-SESSION-FEASIBILITY.md) establishes native capability and the operator decision boundary. No custom agent loop or dependency upgrade has been selected.

## Goals / Non-Goals

**Goals:** preserve the source-bound trajectory; count tool and other recoverable errors independently; seal at either exact count and report the last reason; reuse native infrastructure and charge every continuation to the original auxiliary policy.

**Non-Goals for this investigation:** implement a custom loop, release a new pairing, promote the prepared Durable 1.4 cohort, or use product Conversations as an inference-policy bypass. Independent adversarial review is not selected under the operator instruction.

## Decisions

### Adopted lifecycle requirement

Use two cumulative per-session counts, not consecutive-error counts or whole-prompt retries. Values 3 and 4 are operator examples and probe inputs; public defaults remain a future API decision. Complete replacement calls reuse prior visible analysis and stand alone. Source/lease revocation, cancellation, hard budget exhaustion and persistence unknown remain earlier terminal boundaries.

### Native primitives confirmed

A dedicated public Durable Harness/root Conversation retains its trajectory in independent storage. Generation onYield adds a final-boundary continuation inside the original logical run; successful tool control.terminate avoids an extra request. Generation afterTools sees invalid-schema and unavailable-tool results that bypass ToolHooks. A persistent latest-only Conversation document plus beforeRequest block retains counters and seal across normal reopen. Stable task/result identities support idempotent incident recording.

An onYield continuation is not an externally queued steer. Hook exceptions are report-and-skip; a seal/authorization guard must explicitly block and retain a failure latch instead of relying on a throw.

### Native gaps requiring a reported decision

1. Pinned afterResponse observes a provider error but cannot return a continuation. Classification ends inputs unanswered/model_error without onYield. Explicit later Conversation.submit retains the same stored trajectory; automating it requires a supervisor or native capability change. It is not implemented here.
2. Pakka public createRuntime/createConversation uses primary handling. The probe spends both primary slots and zero auxiliary slots. HostOptions exposes neither native generation hooks nor tool controls. A source-bound auxiliary Conversation needs a host-owned port plus per-request reservation/completion, revocation and adoption integration. Granting bootstrap Runtime control to a strategy would bypass that boundary.
3. Native validation repairs/coerces arguments, and schema/unknown-tool errors bypass afterTool. The prototype demonstrates public afterTools context edits for matched rewrite feedback, and public provider API composition to observe raw OpenAI-completions events. These are capability probes, not a complete multi-provider, fragmented-stream or crash-atomic adoption design.

### Alternatives at the reporting gate

- Extend the version-pinned native generation failure-continuation contract, then build a Pakka auxiliary-session port on that scheduler. Any native change follows the reproducible downstream baseline/build/test/ledger contract.
- Keep native generation/tools/history and add a bounded host supervisor admitting another native run after provider failure. This is additional orchestration requiring an explicit decision; serial prompts are not native steering.
- Select a custom agent loop only after the operator considers the measured native difficulties, preserving host authority and receipt ownership.

No option is selected here. The next gate is operator direction before product implementation.

## Risks / Trade-offs

- Independent storage separates writers/failure domains, not processes; parent source authority and cumulative budgets require explicit linkage.
- Hook document commits and generation settlement are separate transactions. The probe tests normal reopen and stable identities, not crash atomicity at every boundary.
- Both native and provider automatic retries are disabled in the probe. Product accounting must reserve and expose every request.
- Multiple/duplicate calls in a round require whole-envelope validation before any candidate adoption.
- Raw inspection depends on provider support. The proof covers deterministic OpenAI-completions events, not every provider or delta fragmentation pattern; missing evidence must fail closed.
- Close acknowledgment alone is not sealing; retained terminal status must guard scheduling and old capabilities.

## Implementation gate

After route selection, define the source-job DTO/port, receipt ownership and interrupted-session recovery. Then write failure-first production tests and implement adapter-local native ownership. Cover real messages, thresholds, late-result refusal, budgets, revocation, unknown storage and reopen before fixing a separate package pair. The single-call primitive remains compatible.
