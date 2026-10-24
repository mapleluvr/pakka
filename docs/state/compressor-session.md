# Compresser repair service

## Container, Conversations and sources

Dynamite maintains one long-lived pi-durable Compresser Session. Independent Compressor Conversations in this container serve ordinary business Sessions/Conversations outside it. One business Conversation can trigger multiple compression jobs. Each job has its own source snapshot, internal Conversation, transcript, candidate and receipts. Conversation cardinality follows authorized work and resource budgets.

Bootstrap creates the adapter-owned container with `createCompresserSession({ storageDir, toolCallingTolerance, unresolvedErrorTolerance })` and shares its frozen facade through participating Hosts' `inference.compresserSession`. Both positive finite safe-integer tolerances configure each individual Conversation. Native mutable handles and credentials remain in `durable-adapter.ts`; each storage has one writer. The facade exposes trusted bootstrap inspection and close, not model authority.

## Conversation-local repair policy

Every Compressor Conversation owns independent cumulative `toolErrors` and `unresolvedErrors`, its incident identities, last actual error and seal. An incident increments exactly one category once within that Conversation. Successes or errors in other Conversations do not change its counts. Reaching either configured tolerance seals only this Conversation and prevents its further correction, provider dispatch and candidate adoption. The originating result and trusted inspection retain its final error. Re-admitting the same source job retains its binding and cannot reset a sealed Conversation; independently authorized jobs retain their own allowance.

`SourceJob.converse(request, validateCall?)` declares one complete output tool. It preserves prior visible assistant analysis, drafts, calls and call-ID-matched results across native runs. Raw JSON, schema and whole-envelope checks precede the optional synchronous source/artifact validator on frozen DTOs. Tool errors request an entire replacement, not merged parameter patches. A stop or truncation without a complete valid submission records an unresolved incident and admits bounded native steering. Provider error admits at most one stable-ID corrective steer below the Conversation tolerance; Durable `afterFailedRun: "continue"` handles the failed-run boundary. Native automatic retries and compaction are disabled.

The retained Conversation result determines logical completion across native runs. The first submission receipt still describes its own native run. Completed or sealed children leave the container available to independent work.

## Concurrency and fault domains

Independent compression windows dispatch through native Conversations concurrently, without waiting for another window's generation or repair. A sibling's tolerance exhaustion neither cancels an in-flight candidate nor denies adoption of an already returned candidate. Shared business-artifact appends serialize their atomic version/receipt checks; this ordering does not serialize model generation or graph production.

Source revocation, cancellation, hard budgets and source-local uncertainty terminate the affected source work. A source's audit failure does not itself poison the separate Compresser storage. Genuine Compresser storage uncertainty or an unattributed container failure closes that shared storage fault domain. Source-facing shared-fault refusals contain no other source's raw diagnostic. Trusted bootstrap snapshots can include multiple sources and have their own authorization boundary.

## Requests, receipts and persistence

Every native provider request reserves and completes an original source-job auxiliary attempt. Model allowlists, output/time/job/strategy/Session budgets, source versions, lease checks and cancellation remain authoritative. Primary business-model quota is separate. The logical result carries internal Session/Conversation IDs, all attempt IDs, reported usage totals and usage completeness. The exact final successful attempt authorizes the source-bound artifact append; failed attempts remain audited, and unknown usage is not invented.

JSONL storage holds container configuration/registry and separate Conversation policy/job documents and transcripts. Normal reopen preserves each child's counts, seal and metadata. Unconfirmed running/pending work is quarantined and its native continuation stopped before unrelated new work runs. A crash retains the writer claim until trusted recovery confirms the old writer is gone. Persisted metadata does not refresh source authority or replay unknown effects. Aggregate-counter storage with no trustworthy per-Conversation attribution requires explicit migration rather than silent count reset.

## Local outputs and external merge

Each compression job submits P1 summary, P2 local graphs with P3 annotations, P4 clues and unresolved items. The external business store atomically owns the run/block and exact adoption receipt: `block.text` is P1; the versioned `block.artifacts` bundle holds graphs/annotations, clues, unresolved and tool-call identity. `run` records outcome, usage and source evidence. P1 enters the main request through projection; sidecars are available through authorized queries.

Cross-task P2/P3 merging belongs to a separate asynchronous mechanism. A Compressor Conversation produces source-linked local graphs/annotations; it does not maintain or wait for a global graph, another Compressor's output, or a merge result. Local production and P1 adoption therefore remain independent of that extra mechanism.

## Navigation

[Strategy API](../reference/STRATEGY-API.md), [Dynamite state](../../../pakka-dynamite/docs/state/artifacts.md), [formation](../changes/compressor-repair-session.md), [design](../../openspec/changes/add-compressor-repair-session/design.md) and [tasks](../../openspec/changes/add-compressor-repair-session/tasks.md) own the current contract and implementation work. The [Conversation-isolation verification](../verification/COMPRESSOR-CONVERSATION-ISOLATION.md) binds the corrected execution. The [earlier trial](../verification/COMPRESSER-SESSION-TRIAL-ISOLATION.md) records its historical aggregate-policy scope, not evidence for Conversation-local concurrency.
