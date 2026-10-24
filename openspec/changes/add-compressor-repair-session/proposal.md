# Compresser Conversations for independent native compression

## Why

Compressor repairs need to retain prior analysis and matched tool results rather than repeatedly start from identical source prompts. Independent original-text windows can generate concurrently; one long-lived native Session provides storage and scheduling, while each source job has its own Conversation.

The first trial incorrectly interpreted tolerance/sealing as Session-wide. The operator clarified that each Compressor Conversation independently owns its error counts and seal; these jobs are normally unrelated. P2/P3 cross-task merging belongs to an extra asynchronous mechanism, not the compressor's shared state or generation dependency.

## What Changes

- Keep one long-lived adapter-owned Compresser Session, many source-job Conversations and external business Sessions/Conversations outside it; an external Conversation can trigger many compression jobs.
- Use native tool-result repair, steering and failed-run continuation on the pinned Durable 1.4.0-pakka.1 cohort. Every request stays under original source authority and finite auxiliary budgets.
- Give each Conversation independent incident deduplication, two cumulative counters, last error and seal. A sibling's tolerance does not cancel work, deny receipts or deny fresh jobs.
- Restore overlapping native multi-window generation while ordering only shared artifact adoption. Preserve mature window/reduce/projection behavior and complete local P1/P2/P3/P4 submissions.
- Preserve unknown-effect, revocation and actual shared-storage fault boundaries; quarantine unconfirmed old work without provider replay.
- Version the changed public snapshot/storage contract and exact private package pair. Aggregate-counter stores without reliable per-Conversation attribution require explicit migration, not silent resets.

## Capabilities

### New Capabilities

- compressor-repair-session: one source-bound, native multi-Conversation repair container with independent concurrent jobs and Conversation-local error policy.

### Modified Capabilities

None. Single-call auxiliary inference remains a supported primitive. P2/P3 graph merging is a separate mechanism; this correction defines its local-output boundary, not its algorithm.

## Impact

The adapter, SourceJob admission/adoption guards, frozen snapshot DTOs, Dynamite native batch dispatch and their production/public/installed consumers change. Pi mutable handles stay in durable-adapter.ts. The fixed SDK cohort and downstream patch stay unchanged. The changed DTO/storage is a new private agent 0.7.0 / Dynamite 0.5.0 pair; previous pair artifacts and verification remain historical. No custom agent loop, default server activation, paid models, user credentials or adversarial-review workflow is selected.
