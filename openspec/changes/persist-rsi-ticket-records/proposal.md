## Why

PR #5 implements a usable shared ticket service, but its complete-space JSON snapshot caps accumulated tickets and mutation receipts. A run saved before MAS dispatch can remain stuck after interruption, and a lost delivery response cannot be looked up by its original request. The operator adopted the Dynamite-style persistence design and authorized implementation and independent reviewer acceptance before a PR.

## What Changes

- Retain generic ticket permissions, version conflicts, stable mutation identities, UI/Bot consumers and explicit MAS dispatch.
- Add a host-owned bounded records port with atomic multi-record commits, durable receipts and cursor streams in the existing Session SQLite domain.
- Separate ticket heads, revisions, events, runs and mutation receipts; evolve detail/history consumers to bounded pages and migrate old snapshots without replay.
- Add pure MAS request lookup and explicit authorized run recovery using fixed route/request/payload identity.
- Include the new records in maintenance inventory and pending-work recovery checks.

## Capabilities

### New Capabilities

- `runtime-records`: bounded namespace records, multi-record commit and cursor reads.
- `rsi-tickets`: long-lived records, paged consumers and explicit dispatch reconciliation (extends the still-active #5 capability).
- `webui-extension`: independent durable operation receipts for long-lived ticket UI consumption.

### Modified Capabilities

- `same-session-mas`: original-request delivery lookup.

## Impact

Agent public ports/adapter, MAS, RSI service and UI/Bot schemas, maintenance, installed consumers and documentation. Memo remains the inert package carried from #5. Workflow and memory semantics remain separate decisions.
