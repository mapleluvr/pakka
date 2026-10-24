# Source-bound concurrent Compressor Conversations

## Context and correction

One long-lived Compresser Session holds native Conversations serving external business Sessions/Conversations. The operator's correction places error counting and sealing on each individual Compressor Conversation and identifies the tasks as natively concurrent. The previous aggregate-counter interpretation was the agent's mistake, not a requirement. Earlier 1.4 capability probes and 0.4.0 × 0.6.0 trial records retain only their measured historical scopes.

The original [Dynamite design §3.1.2](../../../../pakka-dynamite/docs/dynamite-design-notes.md) starts each window from adjacent/target original text, independently of other generated summaries. Local P2 graphs/P3 annotations are merged by a separate asynchronous mechanism; merge completion is not required for production or P1 adoption.

## State and API ownership

The Session document holds identity, immutable required tolerance configuration, source-job-to-Conversation registry and genuine shared-fault status. Each Conversation document holds its source binding/request fingerprint, status, pending attempt, retained result, incident identities, tool/unresolved counters, seal and last actual diagnostic. A successful job or another job's errors do not reset or consume those counters.

The frozen bootstrap snapshot moves counter/seal/error inspection into each Conversation row. A root last error describes only a true container fault. Raw cross-source diagnostics remain a trusted-bootstrap capability, not an ordinary Conversation endpoint. Native handles/models/providers/docs stay adapter-local.

SourceJob.converse and artifact adoption check the exact originating job's Conversation. Re-admission of the same job retains the same trajectory and cannot evade its seal. A new independently authorized job gets its own Conversation and allowance; it is not a replacement container to bypass a global circuit breaker.

This changes the private public DTO and document meaning, so use agent 0.7.0 / Dynamite 0.5.0 and new document versions. The prior aggregate policy cannot establish per-Conversation cumulative counts from its shared incident set; reject unsupported migration rather than invent attribution or silently clear history. Preserve the original archives.

## Native repair and request accounting

Use the unchanged pinned Durable 1.4.0-pakka.1 public hooks, native tool results, inbox and scheduler. onYield records an unresolved stop/truncation and queues bounded steering. afterTools covers schema/unknown-tool and semantic/source defects with call-ID-matched full replacement results. afterResponse(error) queues at most one stable-ID correction below that child's tolerance; afterFailedRun:continue performs the next native boundary. Every real request reserves/completes original auxiliary budgets and audit evidence; hidden provider/native retries remain disabled. The first native submission receipt is not the overall logical job result.

At either child threshold, persist that child's last error and seal before more dispatch/adoption. Only its own late output is rejected. A sibling's completed exact attempt remains adoptable subject to ordinary source/version/lease/budget checks.

## Concurrent generation, atomic adoption

Restore native multi-window dispatch without awaiting earlier generation/repair. Keep each fixed original-text plan and source receipt. Shared business artifact appends are serialized independently of generation, with a fresh authorized frame/version inside the completion critical section and unique block IDs. Atomic run/block persistence, source checks and later reduce/projection semantics remain unchanged. Primitive text/single-call retry/fallback behavior retains its existing sequential policy; a native job does not enter that retry chain.

Await all started native work before releasing the batch's in-flight ownership, including planning or completion errors. A model/tolerance failure records its own failed plan; a sibling keeps running. A true lifecycle/authority or storage failure retains the applicable common failure boundary.

## Uncertainty, recovery and fault domains

Source-local audit uncertainty retains that job's pending reservation, quarantines its Conversation and admits no retry/refund. It does not itself poison the separate Compresser storage or another business Session. A Compresser commit failure is shared storage uncertainty and closes the container. Unattributed native container failure also fails closed; source-facing messages remain generic.

On reopen, retain completed/sealed metadata. Quarantine unfinished/pending children and stop their native continuations before resuming unrelated work, since persisted provider/source metadata is not refreshed authority. No lost request or artifact is replayed. A dead writer lock requires explicit trusted recovery after OS-confirmed exit; it is not automatically stolen.

## Local artifacts and merge boundary

The compressor submits exactly one complete source-linked candidate: P1 summary, P2 local graphs with P3 annotations, P4 clues and unresolved items. The business store atomically retains run/block/receipt. P1 is block.text and only its projection enters main requests; block.artifacts retains the versioned local sidecar. Identical graph/node IDs in different bundles are local identities, not permission to merge or overwrite.

A separate asynchronous mechanism owns cross-task P2/P3 combination, global graph interpretation and conflict handling. This correction does not implement or select that algorithm, extra generation dependencies, independent layer stores or layer-decay behavior.

## Selected verification and completion

Select real native/local HTTP failure-first tests for independent error categories, concurrent in-flight/fresh jobs, adoption after sibling sealing, source privacy, repeated sealed-job refusal, reopen, interrupted native work and source-local versus shared storage uncertainty. Select a real Dynamite multi-window overlap test with actual receipts, block identities and graph bundles; retain exact source/public/installed archive checks after versioning. No paid providers, credentials, adversarial review or delegation is selected. Existing optional server assembly, operational retention/replacement and broader provider/storage follow-ups remain in [tasks](tasks.md).
