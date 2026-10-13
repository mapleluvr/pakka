## Why

M2/M3 expose trusted service ports, but an agent still cannot safely use them through real Durable tool calls. M4 needs an optional MAS DevPack that binds every action to the current Conversation's live invocation, without giving the model a composition root or selecting credentials, endpoints, tools, or budgets.

## What Changes

- Add `@pakka/mas-devpack` as a tool/instruction contribution consumed by approved Conversation profiles and registered through the existing public Durable extension adapter.
- Expose creation, communication, observation and owner control through a narrow invocation-bound port. Current-Session temporary/task/background creation retains native ownership; other Session requests use explicit approved templates and durable reservations, never arbitrary bootstrap configuration.
- Use `mas.*` as the logical action namespace and provider-safe `mas_*` function names on the HTTP wire. Neither advertised schemas nor results contain native handles or capability tokens.
- Distinguish input completion receipts from application replies and side-effect certainty. Unknown creation/delivery does not release capacity or allocate replacement Sessions.
- Cover optional installation, profile removal, revoked/foreign/expired invocation, real tool calls, installed consumers and worker replacement boundaries.

## Capabilities

### New Capabilities

- `mas-devpack`: optional agent-facing tools with live authority, approved creation modes and honest receipts.

### Modified Capabilities

- `same-session-mas`: allow a bound client to explicitly check an existing action grant without executing that action, for composed creation ports.

## Impact

`packages/mas-devpack`, restricted creation/authorization helpers in `packages/mas`, approved app composition and test/pack consumers. Pi mutable objects remain solely in `durable-adapter.ts`. M5 public transport and M6 product assembly remain separate; Dynamite stays deferred.
