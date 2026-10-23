# Compresser repair session

## Container, sources and trajectories

Pakka-dynamite maintains one long-lived pi-durable Session named the **Compresser Session**. Its Compresser Conversations perform compression work for ordinary business Sessions and Conversations outside that container. The native Session and Conversation handles are held by the host adapter; Dynamite maintains the service lifecycle through its ports.

An external business Conversation can trigger multiple Compresser Conversations. Each Compresser Conversation is bound to its own host-authorized source job and fixed compression context, including the external source Session/Conversation, target and snapshot identity. Job identity, rather than the external Conversation alone, determines the binding. Repeated admission of the same job reuses its binding; different jobs can have distinct Conversations even when they originate from the same external Conversation. The Compresser Session has no preset Conversation-count limit; source-job authority and request/resource budgets govern admitted work.

Each Compresser Conversation retains its own earlier assistant analysis, drafts, rejected tool calls and call-ID-matched results. Recoverable corrections continue that trajectory; unrelated compression contexts have independent histories. A successful candidate supplies the complete required P1 summary, P2 graphs with P3 annotations, P4 clues and explicit unresolved information. Legal empty collections follow the artifact contract. Completion belongs to the bound compression job; the Compresser Session remains a service container.

## Repair and tolerances

The Compresser Session has independent positive finite integer settings `Tool_Calling_Tolerance` and `Unresolved_Error_Tolerance`. Each counter is cumulative for that Session across its Compresser Conversations. A setting is the error count that seals the session, including the error that reaches it. The operator example is tool errors 3 and unresolved errors 4; those values are characterization inputs rather than a published default.

A tool-submission error produces a matched error result describing the defect and directing a complete replacement call. A complete replacement stands on its own; earlier partial fields remain failed history. A normal stop with no accepted complete candidate produces a correction in the bound Compresser Conversation. Explicit empty values allowed by the artifact schema count as supplied fields.

Tool-submission errors include invalid tool names, malformed/incomplete arguments, schema failure, invalid source references and invalid submission envelopes. Other recoverable failures, including final stop without a complete accepted candidate, output truncation and provider/request failure, increment the unresolved counter. Each incident has a stable identity and belongs to one category, so recovery charges it once. Counts accumulate across interleaved categories and Compresser Conversations; each incident retains its source job and originating Conversation identity.

## Sealing and reporting

Reaching either setting seals the Compresser Session before another provider dispatch or candidate adoption in any of its Conversations. Its retained record contains the container identity, the originating Compresser Conversation/source job, both counters and settings, terminal cause, and the most recent actual diagnostic with incident identity. Normal reopen preserves the record, child histories and closed dispatch/adoption boundaries. New Conversation admission, automated retries and model changes use the same Session accounting. A new Compresser Session after a reached tolerance requires explicit authorized admission.

## Host effects

Each request retains the external source job authority and durable attempt reservation, output/time/call budgets, usage and completion receipt. Source bindings keep candidates and receipts with their originating job even when several jobs share an external business Conversation or the Compresser Session. Source or lease invalidation, explicit cancellation, exhausted hard budgets and unknown persistence use the existing terminal authority/storage behavior.

The host owns native handles. The strategy receives detached immutable records and identity-bound commands. Source/lifecycle checks run at dispatch and adoption. Normal-stop corrections and tool-result placement use their native boundaries; a final-boundary continuation and an externally queued steer are distinct operations.

## Evaluation baseline

The operator-selected assessment baseline is the fixed Pi Durable `1.4.0-pakka.1` archive with Pi AI/Chord/Telemetry 1.4.0. The [1.4 capability record](../verification/COMPRESSOR-SESSION-1.4-FEASIBILITY.md) supports native queued steering and failed-run continuation for this lifecycle. Each Compresser Conversation can span several native runs; its retained job status, not the first submission receipt, determines that job’s completion. The measured cases each used one root Conversation in a fresh Session; multi-Conversation source isolation, shared Session accounting and the external service port remain product verification work. This recommendation does not promote production dependencies or implement the source-job auxiliary port. The earlier 1.0.3 record remains version-scoped historical evidence.

## Contract ownership

Formation and the pending infrastructure choice are in [the change record](../changes/compressor-repair-session.md), its [OpenSpec definition](../../openspec/changes/add-compressor-repair-session/specs/compressor-repair-session/spec.md) and [design](../../openspec/changes/add-compressor-repair-session/design.md). [Fixed characterization](../verification/COMPRESSOR-SESSION-FEASIBILITY.md) describes measured capability; [tasks](../../openspec/changes/add-compressor-repair-session/tasks.md) tracks remaining product work.
