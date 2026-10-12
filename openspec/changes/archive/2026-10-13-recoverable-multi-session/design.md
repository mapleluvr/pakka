## Context

See proposal.md. M2 is accepted at 3656b30. Runtime catalog admits deduplicated native submissions and exposes frozen bootstrap ports. Mutable Pi objects remain only in durable-adapter.ts. Storage writer claims are fail-closed; crash recovery cannot infer non-delivery.

## Goals / Non-Goals

Goals: a Durable control Session owns enrollment/outbox; existing and newly managed worker Sessions are distinct storage domains; workers can run in real independent processes; interruption/retry retains exact target/request identity and current authority.

Non-goals: distributed commit, exactly-once tool/provider execution, arbitrary storage/credentials from business callers, network/browser protocol (M5), physical GC, general legacy import or Dynamite repair.

## Decisions

- Add a trusted Runtime store port for JSON-only snapshots and bounded CAS writes. Public DTOs preserve version/data; all docs/Tx objects stay in the adapter. This avoids making MAS read native storage or invent a parallel file database. Known CAS/authority/capacity rejection does not poison storage; unconfirmed persistence does.
- The broker consumes a store and managed Session endpoint ports. Reserve placement plans in coordinator state before opening external Session effects. Management opens/reconciles stable slots; never creates a replacement after an ambiguous result. Publish exact member references then activate prepared Sessions; only the control roster's active phase admits work. Partial activation remains visible and recoverable.
- Outbox records retain principal, source/target identity, request/payload/mode, native receipt and pending/unknown/terminal state. Outbox is durable before transport; target uses M2's whole-lifetime persistent admission identity. Retention is finite, non-evicting and fail-closed when full, not a time-based dedup reset.
- Cross-Session source is verified at the broker, not trusted from tool arguments. The target endpoint uses a management-bound admission principal with the immutable envelope provenance, not a peer native invocation handle. Reply uses retained logical refs/receipts. Queued/placed/done/unanswered/unknown remain distinct.
- apps/server owns worker processes, approved templates, storage paths and private IPC commands. Correlation IDs, envelopes and payload limits are validated at both ends. Worker ports are identity-bound and sealed after exit/close; model callers cannot acquire runtime/store/management ports. Same-process and worker placements are explicit.
- Graceful stop closes Harness then releases its exact writer claim; reopened Session retains durable identities. Crash/uncertain exit keeps the claim and needs separately proved ownership before recovery; do not remove it based on PID or timeout. Independent worker exit is a distinct domain from storage poison.
- No new packages for internal IPC types absent a real remote/browser consumer. Library broker code never imports app/process manager code. New exports/versions are fixed with actual installed consumption.

## Risks / Trade-offs

- Coordinator write succeeds then response is lost → replay CAS/inspect persistent record before external dispatch; preserve unknown until reconciliation.
- Target effect completes then transport fails → retain original outbox and target admission key; restart never changes identity.
- Partial worker startup/activation → retain intermediate enrollment and compensate only confirmed resources; no all-or-none claim.
- Unbounded history → bounded state/outbox and non-evicting capacity. Explicit rejection at capacity; GC/expiry negotiation is future work, not silent reset.
- Same-process coordinator failure → child ownership and stop behavior explicit; one surviving claim cannot be stolen. Test graceful reopen separately from process crash isolation.

## Migration Plan

First prove the coordinator store against real Durable storage and negative authority/capacity cases. Then implement broker and interruption/dedup/source replacement tests across two real local runtimes. Finally add actual worker/manager IPC, controlled exit/reopen/isolation, installed consumers and operator-selected adversarial review. Preserve M2/legacy gates and deferred Dynamite targets. No stage is accepted from spec checkboxes alone.
