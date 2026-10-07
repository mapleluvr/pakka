# Architecture / contract v0.1

## Authority and ownership

`createHost(options)` creates a trusted control object. Only application bootstrap uses connect/reload/newSession/dispose. A plugin receives a frozen, principal-bound Client. Grants are copied into a closure; strategies are copied into kernel maps. No mutable Pi object, kernel, caller string override, or permission-map reference is returned.

Runtime references reside in PiAdapter # fields. Kernel references the adapter via a # field and exports closures, not class instances. Public DTO declarations have no Pi dependency. Package exports expose only "."; direct supported-subpath access to the internal adapter is rejected.

This confines supported APIs, not hostile Node code. Configured tools and prepareInput functions are trusted dependencies. Reads are project-wide snapshots, not a confidentiality ACL. External RPC authentication and serializable capability transport do not exist yet.

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

`context_artifacts.write` also controls a strategy/session JSON journal with expected-version batch receipts; it does not authorize request projection or model spending. `Client.bindStrategy` requires the activating principal and live strategy lease. See [STRATEGY-API.md](STRATEGY-API.md) for the exact public declarations and example. Activation/deactivation remains a minimal registry, not a port of all configure/delete/policy lifecycle semantics.

## Strategy request boundary

A binding reads one frozen provenance frame: raw entry identity/parentage, canonical effective entry-to-message projection, active branch IDs, protected system/host-summary boundaries, excluded messages, sanitized model/usage, lifecycle/navigation/lease identity and artifact version. Frame bases are opaque identities and require exact canonical/artifact equality; source jobs use narrower per-target/previous-context fingerprints and allow unrelated tail growth.

Only the precise `real_context.write` owner installs a projector. Plans contain typed content-only patches and contiguous ordered summary replacements (`summary: null` explicitly omits the checked range without emitting a message). Pure DTO validation preserves checkpoints, exclusions, native call identities/arguments and complete call/result associations. Inference-derived replacements carry their job scope for application-time source checks. The adapter composes public `Agent.prepareRequest` and `onPayload` callback slots with Pi's installed chain. It checks canonical alignment, revalidates authority after awaits and before provider dispatch, and explicitly reinstalls idempotently after reload. No SDK methods/private members are replaced; ordinary context-hook exceptions are not an authorization boundary.

Artifact namespaces have strict version/hash-chain transactions, fsync and exact physical batch readback, plus separate ownership markers. Unknown/partial/changed storage latches host failure per original session, including audit faults that arrive during reload. Explicit newSession recovery is not re-failed by the previous session's late fault. This is a single-writer protocol, not a guarantee against every crash or multi-process race.

`model.infer` is a separate grant. Bootstrap alone configures endpoints/auth/model allowlists and finite job/strategy-session budgets. Every attempt reserves a durable slot before direct public Pi `ModelRuntime.completeSimple`; no `Client.submit`, main transcript or C2 ledger is involved. Actual request options and a per-request model cap enforce output limits, with no implicit transport/model retries. Source/context edits, navigation ABA, generation/lease changes and cancellation prevent future calls and quarantine late completions. Pending/no-usage attempts remain observable as unknown in audit; unpriced cost is null, not zero.

Tools receive a host run-bound invocation capability. Async-local validation also stops a late old tool from omitting the argument to obtain new-session authority. Direct operator calls and tool invocations consume the same scoped services but do not share a refreshable tool token.

## Input admission and native scheduling

Ledger key: principal + sessionId + host admission branchId + caller key. Payload includes original text and mode for conflict detection. Records live only for this host lifetime.

```text
reserved -> handled
reserved -> queued -> consumed -> committed
reserved -> released       (scope changed before transfer)
queued   -> released       (proved present in the core queue)
reserved/queued/consumed -> unknown  (cannot establish commitment)
```

Only released records can be retried in the same scope, with identical payload and incremented attempt. Existing non-released records return their previous receipt and cause no new execution. A committed input may still lead to a failed run later. A caller can inspect only its own receipt IDs.

Preparation is the explicit host-controlled text pipeline. Prompt uses AgentSession.prompt after that pipeline with native template expansion disabled. Queued input uses the same pipeline and then host-created AgentMessage objects sent through public Agent.steer/followUp. Identity lives in a private object map, not in LLM-visible text.

There are no arbitrary Pi input handlers, skills, templates, images or extension commands in this slice. This is a tested composition of **host text preprocessing + native drain timing**, not full legacy preprocessing equivalence.

For an initial prompt, the adapter binds the sole initial user object in the controlled session on message_start. For queued input it already owns the exact object. No text matching is used.

Pi's own core listener is registered first. Pakka's later core listener observes append outcomes. Early messages may remain in Pi's buffer until the first assistant: physical verification is retried on later events and at settlement. No message_end-to-disk equivalence is assumed. Direct file readback and listener order are pinned-version assumptions guarded by tests, not a new public Pi transaction contract.

Cancellation temporarily selects all queue entries, snapshots/clears steering then follow-up, restores non-selected callers' objects and the original queue modes, all synchronously and without user callbacks. Drained entries are not in that snapshot and cannot be released. This assumes the controlled adapter is the only queue writer.

## Lifecycle and observation

Transition phase/generation changes synchronously before abort/reload awaits. Proved queued items are released; consumed/uncertain items are reconciled, not optimistically released. In-flight preparation may finish later, but its old generation cannot transfer into the new scope or hold the new primary admission slot.

Reload reuses the session; newSession constructs a fresh adapter then disposes the previous one. Caller identities, grants, strategy ownership and policy remain host configuration. This is not code/plugin hot reload. Concurrent lifecycle transitions are rejected.

A failed host cannot be re-enabled by reload, because its in-memory tree may include an append whose disk write failed. Explicit newSession recovery creates a fresh scope. It does not repair or erase the old file/receipts.

Observer DTOs are published in a microtask after synchronous state publication/handoff. This avoids reentrant control calls between a queued notice and actual insertion. Core awaits listener completion; the controlled input-consumed observer can still cancel other queued objects before the consumed input is appended. This ordering is regression-tested on Pi 1.0.3.

subscribe currently supplies receipt and lifecycle transition notices, not the complete Pi stream or AgentSubject protocol. waitForIdle awaits the active Pi run; callers must separately await any submit/preparation promise they initiated.

## Persistence and scope limits

JSONL is Pi storage; the host does not replace its session-entry schema. Explicit trusted `reopenSessionFile` opens only a physically validated Pakka-owned file under this dataDir, with matching session/cwd provenance and parentage. A requested missing/corrupt/foreign reopen rejects instead of creating a new session. Raw IDs and strategy/session artifact data survive; old host ledger, grants, leases and operation tokens are not reconstructed. Reopen is not bulk legacy import or C2 crash recovery.

Default resource discovery is disabled (extensions, skills, prompts, themes, context files); host settings disable native compaction and automatic retry. All model/tool configuration is explicit. This slice exercises OpenAI-completions-compatible providers and disables auxiliary transport retry; it is not a claim that every model family or every internal recovery writer/tool-error path has been audited.

The runtime package cohort is explicitly pinned inside the agent package because workspace-root overrides are not inherited by installed consumers. Smoke installation deliberately omits those overrides.

## Next integration boundaries

- Strategy algorithm/default-package integration and cross-package acceptance.
- Full preprocessing compatibility without surrendering request identity or native scheduling.
- Durable C2 admission recovery, multi-process storage and bulk legacy import.
- Per-tool/result permission hooks and a complete observable protocol.
- RPC authentication/serializable handles, CLI, then TUI driven only by these ports.

These are unresolved product work, not features implied by this host component.
