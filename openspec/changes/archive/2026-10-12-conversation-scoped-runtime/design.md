## Context

See proposal.md. The existing Kernel and StrategyControl assume one active Conversation. DurableAdapter is the only production module allowed to hold mutable Pi objects. Native Conversation submit/ownership and Session commits remain authoritative; the oracle adapter stays test-only.

## Goals / Non-Goals

Goals: one shared Harness, independent per-Conversation Kernel/StrategyControl, a narrow trusted runtime control port, persistent aggregate quotas, explicit local-vs-Session failure classification, and legacy regression compatibility.

Non-goals: MAS policy, A2A routing/enrollment, generic callbacks over Tx, process isolation, cross-Session atomicity, arbitrary extension loading, physical history deletion, or Dynamite compatibility.

## Decisions

- Keep the Kernel as one-Conversation authority. DurableAdapter owns the shared Harness and routes hooks/tools by the native asking Conversation ID; consumers never receive it. Sharing one Kernel was rejected because its owners/permits/admissions would become implicit global state.
- Add stable administrative Session and native Conversation identity to production DTOs, preserving the legacy storage/provenance `sessionId` and adding an explicit `providerSessionId` from the public ProviderDoc. Managed-runtime artifact namespaces explicitly include Session and Conversation. An explicit migrateLegacy operation may map only a closed, provably unique ownerless root into managed storage; original journal bytes/transactions/adoptions stay intact and the one commit records audited namespace mappings, source/journal prefix hashes and spent budgets. Fork history, pending work, unknown inference/adoption or foreign provenance is rejected.
- Runtime bootstrap approves profiles, models, tools and finite limits. Agent-facing creation permissions belong to later MAS policy, not this trusted port.
- A Session-scoped Durable document (schema v2) records runtime identity, resource mapping, strategy+Session attempt totals and conservative primary/auxiliary totals. Reserve before dispatch and never refund unknown/aborted attempts. Quotas limit attempts, not a claim of exact billing or executed HTTP count.
- Per-Conversation abort/wait/reload/dispose must not close a peer's Harness. Runtime close owns Harness/storage shutdown. Native fork navigation atomically updates managed resource identity and invalidates stale references.
- Ordinary classified generation failure remains local. Storage/adoption uncertainty and unclassified onReport fail the Session. Do not infer rollback from cancellation.

## Risks / Trade-offs

- Shared storage failure affects all members → expose the Session failure domain, preserve separate-runtime testing, and defer process isolation to M3.
- Restore with missing/changed profile definitions could replay unapproved work → validate approved profile identity before enabling scheduling; inspection stays paused.
- Conservative reservations can count attempts that never reach HTTP → document this and prefer under-use to exceeding an explicit limit.
- Native task ownership does not grant ACLs → do not add public agent-level create/control authority in M1.

## Migration Plan

First run additive runtime tests red, implement shared Harness routing and scope identity, then independently test lifecycle/unknown-state and persistent budgets. Run all legacy regressions, changed-path diagnostics and installed tarball checks. No version rebranding or external strategy repair. Rollback is an earlier commit with its pinned artifact, not editing an installed dependency; managed-runtime persisted records require an explicit compatible implementation.
