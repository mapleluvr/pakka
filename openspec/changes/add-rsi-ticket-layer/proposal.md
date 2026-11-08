## Why

IM Bots and people need a shared durable ticket service: submitting an idea should return immediately after persistence, its author should be able to revise it and inspect progress, and an authorized handler should be able to process it through MAS. The operator authorized initializing RSI and Memo packages and implementing this thin layer; Memo semantics remain deferred.

## What Changes

- Initialize private workspace packages `@pakka/rsi` and `@pakka/memo`; Memo contains only an inert buildable entry and a scope README.
- Add a bounded persistent ticket service with identity-bound clients, author edits, scoped queries, assignment, progress/results, revisions and idempotent mutations.
- Add real-invocation Agent tools, an optional MAS dispatch adapter, and a WebUI extension using public Backend/Client/UI slots.
- Provide an executable composition example and deterministic tests exercising real Runtime storage, native tool calls, MAS delivery and browser interaction.
- Record current expectations, API usage, actual verification and the deferred business workflows.

## Capabilities

### New Capabilities

- `rsi-tickets`: Durable ticket records, permissions, edit/observation semantics, execution linkage and optional product/Agent surfaces.

### Modified Capabilities

None. Existing Runtime, MAS and WebUI contracts are consumed through their public exports.

## Impact

New `packages/rsi` and `packages/memo`, workspace/build/installation checks, a runnable example, and related documentation. The RSI package does not require Memo. This change does not implement IM connectors or research/build/review/deployment business workflows, nor change Dynamite or native scheduling semantics. Verification is performed by the primary session; the operator's instruction against subagent review remains applicable.
