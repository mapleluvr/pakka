## Context

Core M6 and the external library are separate accepted subjects. This step is an app composition feature, not an agent API or algorithm change. Agent@0.5.0 remains the exact audited artifact. The monorepo forbids committed development tarballs and sibling production imports.

## Goals / Non-Goals

Goals: actual executable configuration, fixed optional peer, one controlled service per host-selected initial persistent member, native reduce tool scope, automatic compression only by explicit host choice with inference allowlist, trusted revocation/drain and normal reopen. Verify real next HTTP and original history in installed consumers.

Non-goals: arbitrary module paths, credential/model choice by tools/RPC, strategy configuration transport, dynamic child strategy provisioning, worker strategy installation, vision transport, default activation, kernel/algorithm changes or GUI.

## Decisions

1. Keep `@pakka/dynamite` an exact optional server peer, never an agent/MAS dependency. Load the constant package specifier only when trusted bootstrap selects the feature, before opening storage. The integration runner consumes the committed library source's fixed archive SHA; no development archive or absolute machine path enters tracked dependency metadata.
2. Trusted `dynamite.members` selects initial persistent root keys; options are a closed bounded subset of the public strategy configuration. Tools are advertised in selected roots' approved profiles. A descendant or other unselected member sharing such a profile does not acquire a service: execution must pass the catalog's identity-only native invocation check against the fixed selected refs. Explicitly unselected profiles keep empty/non-Dynamite tools. Model-created strategy enrollment is unsupported, not silently granted by profile selection.
3. Use `runtime.conversation(ref)`, public Host ownership/StrategyBinding and `catalog.checkInvocation(ref, scope)`. One service/lease per Conversation, stable derived owner name for normal reopen. The reduce tool forwards its original scope to the actual library; no scope serialization, refreshing or Pi handle escape.
4. Extend the closed runtime bootstrap JSON to its existing inference model/policy fields. Credentials, endpoints, model keys and finite budgets remain host configuration only. Omission enables no summary provider. Auto-compression remains false by default.
5. RPC spawn/configure/fork is refused before storage in either contribution mode until root policy ceilings cover that combination. A frozen bootstrap-return command permits only trusted lease revocation, not re-grant/configuration; it is not exposed in HTTP/CLI protocol. Shutdown cancels/drains strategies before closing runtime, with runtime close in `finally`.
6. Preserve the old M0 pairing. Add a new fixed library/M6 pairing and isolated product runner; build/pack the actual server and clients, install compiled package exports with the SHA-fixed agent/Dynamite archives and run a real executable plus trusted bootstrap test. Fail on missing cases, skip/todo/cancel, changed archive, oracle graph, extra dispatch or unexpected tool/receipt state.

## Risks and mitigations

- Optional peer absent: feature startup refuses before allocating storage; no-effect native mode remains usable without the peer.
- Profile sharing: tools do not imply a service grant; foreign/ended scopes must be rejected at the controlled boundary. Test a real peer invocation, not a forged DTO.
- Reopen: persisted artifacts need identical owner provenance and new leases; no automatic fresh Session or unknown quota refund.
- Automatic work: received native generation can schedule auxiliary jobs. Explicit finite allowlist/policy and cancellation/drain are required; unknown/failed inference is not free.
- Captured evidence: transport/model output and native receipts are independently asserted; wire changes do not imply history deletion or exactly-once tool execution.
