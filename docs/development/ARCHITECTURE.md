# Architecture / core contracts

This document describes the single-Conversation compatibility host and the managed multi-Conversation runtime contract. Current package boundaries are in [MONOREPO-CONVENTIONS.md](MONOREPO-CONVENTIONS.md); application usage starts at the [documentation index](../README.md) and [WebUI guide](../guides/WEBUI-GUIDE.md). The core migration plan is [historical background](../archive/plans/MONOREPO-MIGRATION-PLAN.md). The managed bootstrap API is described in [RUNTIME-API.md](../reference/RUNTIME-API.md); Same-Session A2A is accepted in M2. M3's controlled [cross-Session broker and worker app](../reference/BROKER-API.md) are accepted with explicit [support limits and review notes](../archive/acceptance/MIGRATION-M3-ACCEPTANCE.md); agent-facing [DevPack](../reference/MAS-DEVPack-API.md) is accepted with [explicit notes](../archive/acceptance/MIGRATION-M4-ACCEPTANCE.md); M5's [authenticated loopback applications](../guides/MAS-APPLICATION-API.md) are accepted with [explicit notes](../archive/acceptance/MIGRATION-M5-ACCEPTANCE.md). M6's [integrated optional product](../guides/MAS-PRODUCT-SUPPORT.md) is accepted with [explicit notes and fixed artifacts](../archive/acceptance/MIGRATION-M6-ACCEPTANCE.md). The package remains `@pakka/agent`.

## Authority and ownership

`createHost(options)` creates a trusted control object. Only application bootstrap uses connect/reload/newSession/dispose. A plugin receives a frozen, principal-bound Client. Grants are copied into a closure; strategies are copied into kernel maps. No mutable Pi object, kernel, caller string override, or permission-map reference is returned.

Runtime references reside in `DurableAdapter` `#` fields (with legacy `PiAdapter` retained solely as a test oracle). Kernel references the adapter via a `#` field and exports closures, not class instances. Public DTO declarations have no Pi dependency. Package exports expose only "."; direct supported-subpath access to the internal adapter is rejected.

This confines supported APIs, not hostile Node code. Configured tools and prepareInput functions are trusted dependencies. Reads are project-wide snapshots, not a confidentiality ACL. M5 authenticates a finite MAS loopback RPC using server-bound issuer roles, source and grants. References are serializable addresses, not exported process-local capabilities; arbitrary host RPC and serializable capability transport remain unsupported.

## Revision and authorization

A capability is an opaque identity in a WeakMap with principal plus a fingerprint of generation, host epoch, sessionId, admission branchId, raw entry count and leaf. An operation invalidates old snapshots by advancing epoch; reload/replacement/dispose also advance generation. Any manual branch operation generates a new admission branchId, including A→B→A. Neither counter is legacy treeRevision.

Context commits follow:

1. Validate principal-bound capability, phase and idle (including pending primary preparation).
2. Copy/freeze proposal; validate target against the active branch before author intent writes.
3. Resolve the exact real_context.write owner.
4. Owner is direct; a different principal requires the owner's explicit policy.
5. After any awaited policy, recheck fingerprint, phase, idle and owner.
6. Without another await, append via public Pi API, refresh context, and verify the physical entry.

A cut stores authorship in compaction details in the same entry. An edit writes a custom intent followed by a context_edit. Failure can leave partial memory/disk state: return unknown and mark the host failed. There is no rollback or atomic edit receipt.

`context_artifacts.write` also controls a strategy/session JSON journal with expected-version batch receipts; it does not authorize request projection or model spending. `Client.bindStrategy` requires the activating principal and live strategy lease. See [STRATEGY-API.md](../reference/STRATEGY-API.md) for the exact public declarations and example. Activation/deactivation remains a minimal registry, not a port of all configure/delete/policy lifecycle semantics.

## Strategy request boundary

A binding reads one frozen provenance frame: raw entry identity/parentage, canonical effective entry-to-message projection, active branch IDs, protected system/host-summary boundaries, excluded messages, sanitized model/usage, lifecycle/navigation/lease identity and artifact version. Frame bases are opaque identities and require exact canonical/artifact equality; source jobs use narrower per-target/previous-context fingerprints and allow unrelated tail growth.

Only the precise `real_context.write` owner installs a projector (acting as Context Arbiter). Plans contain typed content-only patches and contiguous ordered summary replacements (`summary: null` explicitly omits the checked range without emitting a message). Pure DTO validation preserves checkpoints, exclusions, native call identities/arguments and complete call/result associations. Inference-derived replacements carry their job scope for application-time source checks.

The host enforces generation rejection through the version-pinned downstream Pi Durable build `1.0.3-pakka.1` (see [patch contract](../../patches/pi-durable/1.0.3-pakka.1/README.md)). `GenerationTask.beforeRequest` accepts an explicit `{ block: reason }` and request-scoped `{ messages, check }`; checks run after hooks and at the provider `onPayload` boundary. There is no Models Proxy or shared adapter permit. Intentional projector rejection yields a durable blocked generation with zero provider calls and leaves the host ready. Malformed plans, stale authority and unknown storage still fail the Profile before HTTP. Ordinary hook exceptions retain upstream report-and-skip behavior, so the adapter converts its own validation errors to a block result and latches protocol failure explicitly. The adapter reinstalls the projector idempotently after reload.

Legacy artifact namespaces use `(sessionId, strategyId, journalKind)`; managed v2 namespaces additionally bind native Conversation identity. Both retain strict version/hash-chain transactions, fsync and exact physical batch readback, plus separate ownership markers. Different strategies can write independently to their own artifact namespaces without collision. Unknown/partial/changed storage latches host failure per original session, including audit faults that arrive during reload. Explicit newSession recovery is not re-failed by the previous session's late fault. This is a multi-namespace writer protocol, not a guarantee against every crash or multi-process race.

`model.infer` is a separate grant. Bootstrap alone configures endpoints/auth/model allowlists and finite job/strategy-session budgets. Every attempt reserves a durable slot before direct public Pi `Models.completeSimple`; no `Client.submit`, main transcript or C2 ledger is involved. Actual request options and a per-request model cap enforce output limits, with no implicit transport/model retries. Source/context edits, navigation ABA, generation/lease changes and cancellation prevent future calls and quarantine late completions. Pending/no-usage attempts remain observable as unknown in audit; unpriced cost is null, not zero.

Tools receive a host run-bound invocation capability. Async-local validation also stops a late old tool from omitting the argument to obtain new-session authority. Direct operator calls and tool invocations consume the same scoped services but do not share a refreshable tool token.

## Input admission and native scheduling

Ledger key: principal + sessionId + host admission branchId + caller key. Payload includes original text and mode for conflict detection. Records live only for this host lifetime.

```text
reserved -> handled
reserved -> queued -> consumed -> committed
reserved -> released       (scope changed before transfer)
queued   -> unknown -> released (exact durable withdrawal confirms no placement)
reserved/queued/consumed -> unknown  (cannot establish commitment)
```

Only released records can be retried in the same scope, with identical payload and incremented attempt. Existing non-released records return their previous receipt and cause no new execution. A committed input may still lead to a failed run later. A caller can inspect only its own receipt IDs.

Preparation is the explicit host-controlled text pipeline shared by prompt, steering and follow-up. Production submits prepared text through Durable `Conversation.submit`; identity is mapped using Durable Submission IDs, never by text matching or LLM-visible markers. An active run's prompt is rejected; steering and follow-up retain their distinct native Durable placement timing. Prompt completion waits on the specific `Submission.wait()`, because Harness idle alone may return before a new task is scheduled. Cache reads consume every entries cursor page.

There are no arbitrary Pi input handlers, skills, templates, images or extension commands in this slice. It is a tested composition of **host text preprocessing + Durable drain timing**, not full legacy preprocessing equivalence.

A submission with an entry is reported committed independently of its generation settlement. An intentional block adds `receipt.generation = { status: "blocked", reason }`; it does not release or roll back the input, append a synthetic assistant failure, or implicitly retry its admission key. On reopen, the durable submission/task settlement prevents hidden replay; the process-local admission ledger itself is still not reconstructed.

Cancellation selects only callers' proven queued submissions through the public Durable handle. A drained or placed input cannot be optimistically released. Storage/readback uncertainty remains unknown and latches host failure. Exact placement, cancellation and lifecycle observations are pinned-version contracts guarded by integration tests.

The AgentSession adapter exists only under `packages/agent/test/pi-adapter.ts`. Fixtures inject it through an internal source construction seam; the public `createHost` supports only Durable. Production declarations, `dist` output and installed dependencies contain no AgentSession oracle, and external package smoke checks both dependency resolution and HTTP behavior.

## Lifecycle and observation

Transition phase/generation changes synchronously before abort/reload awaits. Queued withdrawal remains unknown until Durable confirms absence of an entry; confirmed withdrawals are released; consumed/uncertain items are reconciled, not optimistically released. In-flight preparation may finish later, but its old generation cannot transfer into the new scope or hold the new primary admission slot.

Reload reuses the session; newSession constructs a fresh adapter then disposes the previous one. Caller identities, grants, strategy ownership and policy remain host configuration. This is not code/plugin hot reload. Concurrent lifecycle transitions are rejected.

A failed host cannot be re-enabled by reload, because its in-memory tree may include an append whose disk write failed. Explicit newSession recovery creates a fresh scope. It does not repair or erase the old file/receipts.

Observer DTOs are published in a microtask after synchronous state publication/handoff. This avoids reentrant control calls between a queued notice and actual insertion. Tests cover cancellation from an input-consumed observer and prove released versus already-placed identities using Durable submission records.

subscribe currently supplies receipt and lifecycle transition notices, not the complete Pi stream or AgentSubject protocol. waitForIdle awaits the active submission/run and Durable task idleness; callers must separately await any submit/preparation promise they initiated.

## Persistence and scope limits

Durable storage uses Node JSONL storage (`openNodeJsonlStorage`) under `dataDir/sessions/<sessionId>/main.jsonl`. Explicit trusted `reopenSessionFile` opens only a physically validated Pakka-owned file under this dataDir, with matching session/cwd provenance and parentage. A requested missing/corrupt/foreign reopen rejects instead of creating a new session. Raw IDs and strategy/session artifact data survive; old host ledger, grants, leases and operation tokens are not reconstructed. Reopen is not bulk legacy import or C2 crash recovery.

Default resource discovery is disabled (extensions, skills, prompts, themes, context files); host settings disable native compaction and automatic retry. All model/tool configuration is explicit. This slice exercises OpenAI-completions-compatible providers and disables auxiliary transport retry; it is not a claim that every model family or every internal recovery writer/tool-error path has been audited.

The production dependency cohort is pinned at the agent package boundary. Pi Durable is a vendored, hash-verified tarball bundled into `@pakka/agent`; `pi-ai`, `chord` and `pi-telemetry` are pinned to 1.0.3. `pi-coding-agent` and `pi-agent-core` are development-only oracle dependencies. Root overrides are not relied on by installed consumers; an isolated smoke install verifies the cohort and rejects oracle/private subpath access.

## Core M1–M6 integration background

The following records the accepted headless migration slices and their limits. Current WebUI capabilities and outstanding work are tracked in the [product status](../PAKKA-POCKET-STATUS.md).

- The historical fixed-artifact Durable × Dynamite pairing remains failed; [functional targets and resumption conditions](../archive/investigations/DEFERRED-DYNAMITE-COMPATIBILITY.md) are retained. After accepted M6, the explicit `dynamite@0.2.1 × agent@0.5.0` optional static-member product pair is [accepted with notes and fixed identity](../verification/DYNAMITE-PRODUCT-ACCEPTANCE.md), after complete selected review and the source-manifest omission correction. [Host-selected installation](../reference/DYNAMITE-PRODUCT-API.md) stays in the server composition root; the agent/MAS do not depend on the strategy, and default activation remains off.
- M1 provides Conversation-scoped authority, projections, artifacts, aggregate Session budgets, one-writer claims and declared failure handling in `@pakka/agent@0.2.0`. Managed reopen does not adopt legacy journal data implicitly; explicit `migrateLegacy` maps only an exact closed unique ownerless root with an audited prefix/namespace receipt and retained spent budgets. Terminal generation sidecars are reclaimed, so historical primary spending is conservatively reserved per generation marker, not reconstructed as exact HTTP counts. A writer claim surviving a crash is never silently stolen in M1.
- M2 provides same-Session MAS membership, owner/capability policy, native A2A delivery, task lifetimes and unknown persistence through `@pakka/mas@0.1.0`; see [M2 acceptance](../archive/acceptance/MIGRATION-M2-ACCEPTANCE.md). M2 remains the native target admission path for cross-Session routing.
- M3 adds a bounded durable coordinator store, recoverable enrollment/outbox, existing-Session transport and an actual private worker app with distinct processes. Worker presets and storage addresses are trusted bootstrap inputs; one storage still has one writer. Terminal receipt outcomes are monotonic; admission dedup does not imply exactly-once external effects. M3 is accepted with notes, not evidence for remote RPC, sandboxing or crash-claim theft; see [M3 acceptance](../archive/acceptance/MIGRATION-M3-ACCEPTANCE.md).
- M4 adds optional MAS DevPack tools/instructions via public native extension registration: each call composes live client and invocation checks. Approved existing/new Session requests reserve fixed durable slots, never arbitrary endpoint/storage/configuration; private workers only enable approved local profiles with descendant grant ceilings. M4 is accepted with [documented notes](../archive/acceptance/MIGRATION-M4-ACCEPTANCE.md); see [DevPack API](../reference/MAS-DEVPack-API.md). M5 provides the authenticated loopback protocol/client and server/CLI. The Web workbench has its own [extension and transport contracts](WEBUI-DEVELOPMENT.md).

- M5 extracts browser-safe protocol/client and adds a real loopback server bootstrap and operator CLI. Authority stays at the server/adapter boundary; four confirmed local pre-effect refusals are typed, opaque callback/persistence/late authority failures stay unknown. Reconnect uses scoped snapshot/receipts, not global revision or automatic mutation replay. Two bounded reviews converge BLOCK → fixed → OK with notes; retained correlation/provenance/config-validation limits are in [M5 acceptance](../archive/acceptance/MIGRATION-M5-ACCEPTANCE.md). M6 now verifies the optional product executable, four native lifetimes and retained model descendants on normal reopen. Product/private-worker wiring shares invocation binding and ancestor grant ceilings; unselected profiles advertise no inherited DevPack tools. Fixed installed-product evidence and remaining trusted-config hardening notes are in [M6 acceptance](../archive/acceptance/MIGRATION-M6-ACCEPTANCE.md); [support limits](../guides/MAS-PRODUCT-SUPPORT.md) distinguish RPC from trusted multi-Session/worker composition. GUI was outside that M6 gate; the later Web workbench is documented separately. Deferred Dynamite resumed against this accepted core baseline.

Full preprocessing, bulk legacy import and additional per-tool/result contracts remain separately scoped product work. These are unresolved boundaries, not features implied by this host component; the monorepo migration does not authorize shared-storage multi-process writers.
