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

SQLite storage holds container configuration/registry and separate Conversation policy/job documents and transcripts under WAL/FULL policy. Normal reopen preserves each child's counts, seal and metadata. Unconfirmed running/pending work is quarantined and its native continuation stopped before unrelated new work runs. An original complete candidate can finish business-side sealing through source/job/attempt and request-digest reconciliation. A crash retains the writer claim until `recoverStorageWriter` confirms the exact old writer is gone under an exclusive maintenance gate. Persisted metadata grants no refreshed authority. Fixed work and recovery are declared in [Dynamite persistence](dynamite-persistence.md).

## Local outputs

Each compression job submits P1 summary, P2 local graphs with P3 annotations, P4 clues and unresolved items. The external business store atomically owns the run/block and exact adoption receipt: `block.text` is P1; the versioned `block.artifacts` bundle holds graphs/annotations, clues, unresolved and tool-call identity. `run` records outcome, usage and source evidence. P1 enters the main request through projection; sidecars are available through authorized queries.

Each Compressor Conversation produces source-linked local graphs and annotations for its own work. The graph bundle retains its source identity and validation scope; P1 adoption depends on that work's checked result and current authority.

## Navigation

The public operations are defined in [Strategy API](../reference/STRATEGY-API.md) and the [Dynamite artifact contract](https://github.com/mapleluvr/pakka-dynamite/blob/28100973b781c175de3abfd4ea23eb603805fd2f/docs/state/artifacts.md). Formation and implementation records are indexed by the [change summary](../changes/compressor-repair-session.md).
