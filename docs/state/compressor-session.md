# Compresser repair session

## Identity and trajectory

A compressor session belongs to one host-bound source job and its fixed source/context identity. Its trajectory retains earlier assistant analysis, drafts, rejected tool calls and call-ID-matched results. A successful candidate supplies the complete required P1 summary, P2 graphs with P3 annotations, P4 clues and explicit unresolved information. Legal empty collections follow the artifact contract.

## Repair and tolerances

The session has independent positive finite integer settings `Tool_Calling_Tolerance` and `Unresolved_Error_Tolerance`. Each counter is cumulative for that session. A setting is the error count that seals the session, including the error that reaches it. The operator example is tool errors 3 and unresolved errors 4; those values are characterization inputs rather than a published default.

A tool-submission error produces a matched error result describing the defect and directing a complete replacement call. A complete replacement stands on its own; earlier partial fields remain failed history. A normal stop with no accepted complete candidate produces a correction in the compressor trajectory. Explicit empty values allowed by the artifact schema count as supplied fields.

Tool-submission errors include invalid tool names, malformed/incomplete arguments, schema failure, invalid source references and invalid submission envelopes. Other recoverable failures, including final stop without a complete accepted candidate, output truncation and provider/request failure, increment the unresolved counter. Each incident has a stable identity and belongs to one category, so recovery charges it once. Counts accumulate across interleaved categories.

## Sealing and reporting

Reaching either setting makes the session sealed before another provider dispatch or candidate adoption. Its retained record contains session/source identity, both counters and settings, terminal cause, and the most recent actual diagnostic with incident identity. Normal reopen preserves the record and closed dispatch boundary. Automated retries and model changes use the same accounting; a new session after a reached tolerance requires explicit authorized admission.

## Host effects

Each request retains the source job authority and durable attempt reservation, output/time/call budgets, usage and completion receipt. Source or lease invalidation, explicit cancellation, exhausted hard budgets and unknown persistence use the existing terminal authority/storage behavior.

The host owns native handles. The strategy receives detached immutable records and identity-bound commands. Source/lifecycle checks run at dispatch and adoption. Normal-stop corrections and tool-result placement use their native boundaries; a final-boundary continuation and an externally queued steer are distinct operations.

## Evaluation baseline

The operator-selected assessment baseline is the fixed Pi Durable `1.4.0-pakka.1` archive with Pi AI/Chord/Telemetry 1.4.0. The [1.4 capability record](../verification/COMPRESSOR-SESSION-1.4-FEASIBILITY.md) supports native queued steering and failed-run continuation for this lifecycle. A compressor session can span several native runs; its retained status, not the first submission receipt, determines completion. This recommendation does not promote production dependencies or implement the source-job auxiliary port. The earlier 1.0.3 record remains version-scoped historical evidence.

## Contract ownership

Formation and the pending infrastructure choice are in [the change record](../changes/compressor-repair-session.md), its [OpenSpec definition](../../openspec/changes/add-compressor-repair-session/specs/compressor-repair-session/spec.md) and [design](../../openspec/changes/add-compressor-repair-session/design.md). [Fixed characterization](../verification/COMPRESSOR-SESSION-FEASIBILITY.md) describes measured capability; [tasks](../../openspec/changes/add-compressor-repair-session/tasks.md) tracks remaining product work.
