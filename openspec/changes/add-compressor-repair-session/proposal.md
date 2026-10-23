## Why

The current optional Dynamite Tool Calling path starts each failed attempt from the original system/user input, without the rejected assistant call or its diagnostic. The operator requires a continuing compressor trajectory with two bounded error categories and a permanently sealed result when either tolerance is reached.

## What Changes

- Maintain one long-lived pi-durable Compresser Session for Dynamite, containing independent source-job-bound Compresser Conversations serving business Sessions/Conversations outside it. One external Conversation may trigger multiple internal Conversations, without a preset Conversation-count limit.
- Adopt independently configurable, cumulative per-Compresser-Session `Tool_Calling_Tolerance` and `Unresolved_Error_Tolerance`; use 3 and 4 as the operator's example/probe configuration, not as a silently published API default.
- Preserve earlier assistant analysis, drafts, failed calls and matched tool results. A failed submission requests one complete replacement containing all required P1/P2/P3/P4 fields; a normal stop without an accepted complete candidate triggers a native correction in the compressor's own trajectory.
- Seal at the error that reaches either tolerance, retain the trajectory/counters and the last actual error, and reject later dispatch/adoption in that session.
- Investigate Pakka and pinned public pi-durable infrastructure first. Report lifecycle, authority and error-continuation obstacles before choosing a custom agent loop. The current work establishes this boundary through real local-HTTP characterization and records pending implementation choices.
- Keep source authority, per-attempt receipts/usage, budgets, cancellation and storage-unknown semantics under the host. Independent adversarial review is not selected following the operator's instruction; existing partial review evidence remains historical.

## Capabilities

### New Capabilities

- `compressor-repair-session`: a Dynamite-owned multi-Conversation service container, external source/job bindings, conversational repair, independent Session-wide error tolerances, retained sealing and governed native-infrastructure selection.

### Modified Capabilities

None. The existing single-call auxiliary inference remains a supported primitive; its archived/main contracts are not rewritten into a conversational API by this investigation.

## Impact

The future implementation affects `packages/agent/src/{types,strategy-control,durable-adapter}.ts`, the independent `../pakka-dynamite` compressor/runtime/ports and their tests, and versioned package pairing. Production dependencies stay pinned to `pi-durable@1.0.3-pakka.1` during the experiment. Native handles remain adapter-local; the operator has not authorized a custom agent loop or a production dependency upgrade. Related main boundaries are `conversation-runtime` and `optional-dynamite-product`; the existing unarchived single-call addition is `add-auxiliary-tool-output`.
