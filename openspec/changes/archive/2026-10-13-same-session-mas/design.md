## Context

See proposal.md. M1 is accepted at 78dc0b8 with independent per-Conversation kernels and one shared native mutation line. Native mutable objects must remain inside durable-adapter.ts; `@pakka/mas` uses public frozen DTO/command exports only.

## Goals / Non-Goals

Goals: atomic membership/configuration; honest preparing/ready/active state; principal/source/lease-bound communication and administration; durable dedup/receipts and real native ownership cancellation.

Non-goals: cross-Session transaction/transport, arbitrary storage or tool configuration from agents, transcript confidentiality for trusted bootstrap, physical deletion, new scheduler, Dynamite repair or GUI.

## Decisions

- Add a bootstrap-only runtime catalog port with fixed namespace. Commands atomically enroll approved profiles with caller metadata, CAS metadata by catalog version, admit a bounded delivery with native submission/InboxDoc/LiveDoc/GenerationTask, query/wait/abort exact receipts, and drain a resource. This is a narrow data-and-command seam; arbitrary Tx callbacks or native handles remain inaccessible.
- `@pakka/mas` owns resource policy, agent metadata and revocable principal closures. The gate port rechecks the supplied synchronous authority predicate after awaited reads and immediately before effects; asynchronous policy happens outside the mutation line. A caller string is never trusted as a principal or invocation.
- Creation writes Conversation, approved configuration and metadata in one commit. Service attachment checks real Host identity/profile readiness and then marks ready/active. Failure retains preparing/failed or unknown. Ordinary service callers cannot bypass preparation.
- Delivery has a stable request key bound to namespace/principal/source incarnation/target incarnation. The adapter stores a payload fingerprint with native submission ID in the same commit as admission. Busy input uses native inbox timing; idle input uses public Tx to append UserEntry, create Submission and GenerationTask/LiveDoc. Pending/unknown receipts are never deleted/refunded; capacity is finite and retention is whole Session lifetime in M2. This uses the public manual admission contract, no private import or copied scheduler.
- Task-owned creation accepts only a currently active actual tool invocation. The adapter maps its opaque scope to native task identity and validates task liveness on the commit line. Long-lived members are ownerless; temporary/task members use the current task. Background members use a real conversation-owned background anchor task and child ownership. Native completion/abort drain remains authoritative; the service inspects owner task outcome instead of pretending task ownership is an ACL.
- Runtime catalog control is bootstrap authority and never returned by MAS clients. Client introspection returns membership/status only, not target transcript or Host. Configure chooses approved profile only. Retirement seals admission first, aborts/drains, then persists tombstone; original history remains.

## Risks / Trade-offs

- Public Tx manual admission requires exact inbox/run boundaries → narrowly reproduce only admission using exported documents/tasks, validate post-tools/final placement through real HTTP and forbid unsupported queued writes.
- Authority can change while awaiting reads → exact lease/source/target checks on effect line and native invocation lifetime; no async callback inside transaction authorization.
- Task completion can outlive creating tool → owned member live tasks delay completion natively; no inference from tool text or abort request.
- Delivery records could grow → finite maxDeliveries and maxPending per recipient; no unsafe eviction. M3 adds cross-Session reconciliation, not a second scheduler.

## Migration Plan

Run missing catalog/service behavior red against real runtime, implement the adapter seam and MAS consumer, verify gate regressions/install graph, then bounded independent review/fixes. Existing Host/runtime behavior remains. Version the added exported boundary. Keep Dynamite deferred and restore its entire matrix after M6.
