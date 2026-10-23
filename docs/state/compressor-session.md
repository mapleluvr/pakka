# Compresser repair service

## Container and external sources

Dynamite maintains one long-lived pi-durable **Compresser Session**. Its independent Compresser Conversations serve ordinary business Sessions/Conversations outside that container. A business Conversation may start several compression jobs, each with its own internal Conversation and fixed source snapshot. Conversation cardinality follows authorized work rather than a preset Conversation-count quota.

Bootstrap creates the service with `createCompresserSession({ storageDir, toolCallingTolerance, unresolvedErrorTolerance })`. Both tolerances are required positive finite safe integers. The returned frozen facade exposes `snapshot()` and `close()`; native Harness, Session, Conversation, documents and providers remain in `durable-adapter.ts`. Bootstrap shares this same identity-bound facade through each participating Host's `inference.compresserSession`. Each storage directory has one writer.

Each internal Conversation binds the originating external Session/Conversation, host-issued source job, plan and request fingerprint. Repeating a live job with the same request shares its operation and receipts; changing that request rejects. Different jobs, including jobs from one external Conversation, have independent transcripts. Job completion leaves the container available for subsequent authorized work.

## Source-bound repair

`SourceJob.converse(request, validateCall?)` declares one output tool and preserves the Conversation's previous assistant analysis, drafts, calls and matched results. The optional synchronous validator receives a frozen call DTO and returns a diagnostic string or `undefined`. Whole-envelope, raw JSON and schema checks precede that callback.

A rejected call produces a call-ID-matched error result requesting a complete replacement. Schema, source and persisted-envelope defects are repairable tool errors. Multiple calls are checked as one invalid envelope before any candidate can succeed; actual failed tool results retain distinct incident identities. Successful replacement arguments stand alone.

A normal stop or truncation without a complete candidate records an unresolved incident and admits a bounded native steer. Provider failure records an unresolved incident and admits at most one stable-ID steer; Durable's `afterFailedRun: "continue"` places it at the failed-run boundary. Native automatic retries and automatic compaction are disabled. The retained job status determines completion across native runs; the first native submission receipt remains its own truthful result.

## Cumulative policy and sealing

`toolCallingTolerance` and `unresolvedErrorTolerance` implement independent cumulative Session-wide counters. An incident increments exactly one category once, with its originating job and Conversation. Counts span successful jobs and independent child Conversations. The incident reaching either configured count seals the container immediately.

The frozen snapshot reports Session identity/status, settings, counts, last actual error with incident/job/Conversation identity, and each child job's external source identities and status. Dispatch, provider-payload checks and adoption check the shared seal. Sibling in-flight output can retain its usage/effect evidence but cannot become an accepted candidate after sealing. Reopen retains counters and seal; changing settings on the same storage is rejected. A replacement container requires explicit bootstrap admission.

## Authority, budgets and receipts

Every native provider request reserves and completes an attempt under the original source job and auxiliary Session/strategy policy. Model allowlists, output/time/job/call limits, source versions, lease checks and cancellation remain authoritative. Primary business-model quota is separate. Each completed conversational result includes `compresser` metadata with internal Session/Conversation IDs, all attempt IDs, reported usage totals and whether every attempt has authoritative usage.

The final candidate's exact successful attempt authorizes the source-bound artifact append; failed attempts remain separately audited. Unknown usage is not invented. Cancellation, revocation and hard budget exhaustion terminate the affected job under host rules. Unconfirmed persistence latches admission; an unconfirmed completion retains its pending reservation.

## Persistence and reopen

The container uses fsynced native JSONL storage with a Session policy document and separate job documents/transcripts. Normal close/reopen preserves completed metadata and supports new independently authorized jobs. Persisted operation records are inspection evidence, not refreshed source capabilities.

An interrupted running/pending job is quarantined and seals the container before native scheduling resumes. A process crash leaves `pakka-writer.json` in place: trusted recovery first establishes that the writer is gone and resolves that claim explicitly. Opening storage does not automatically steal it or replay unconfirmed inference.

## Dynamite assembly and output

The private trial pairing is `@pakka/dynamite@0.4.0` with `@pakka/agent@0.6.0`, Pi AI/Chord/Telemetry 1.4.0 and bundled Durable `1.4.0-pakka.1`. `createDynamite(binding, { compressionSession: { maxCalls }, config })` explicitly selects this driver with tool-format compression and one allowlisted model. `maxCalls` is a finite per-job ceiling additionally capped by host policy. The engine delegates corrections to the native port rather than opening primitive retry/fallback chains.

Candidates contain P1 summary, P2 graphs with P3 annotations, P4 clues and explicit unresolved items. The external business Session owns the atomic run/block artifact and final receipt. The Compresser container owns generation/repair history and policy, not the business projection. Only P1 enters the next main request through the ordinary projection; sidecars are read through the artifact query.

## Contract and evidence

[Strategy API](../reference/STRATEGY-API.md) maps the public types and commands. [Dynamite artifact state](../../../pakka-dynamite/docs/state/artifacts.md) owns P1/P2/P3/P4 representation. Formation and current gaps are in the [change](../changes/compressor-repair-session.md), [design](../../openspec/changes/add-compressor-repair-session/design.md) and [tasks](../../openspec/changes/add-compressor-repair-session/tasks.md). [First-trial verification](../verification/COMPRESSER-SESSION-TRIAL.md) binds the actual package pair and measured boundaries.
