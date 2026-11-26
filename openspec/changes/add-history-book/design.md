# Design

## Adopted boundaries

History Book is a standalone Dynamite product, including its Agent read/edit service. Memo analyses it through Patchouli and stores derived knowledge separately. This follows the operator's explicit correction and approval, not an inference from the earlier Memo source-provider tests.

The package boundary is a provide-as-is capability boundary, not merely an import restriction. For each dependency, the upstream provider supplies a minimal but sufficient set of generic capabilities; the downstream consumer owns domain adaptation. Memo depends on Dynamite and MAS, with opt-in RSI/EI; Dynamite depends on MAS, with opt-in EI; RSI depends on EI and MAS. These are capability directions, distinct from the concrete installation and execution topology. The shared rule is in [monorepo conventions](../../../docs/development/MONOREPO-CONVENTIONS.md#21-独立能力与下游适配).

For Book consumption, first establish the upstream object contract and verify that the public capabilities are sufficient, then design the Memo adaptation. If a genuine generic capability is missing, the upstream contract may evolve; a downstream-specific DTO or failing composition test alone does not determine that change. The current Historian/native execution seams must be mapped against these directions before proposing any execution-layer relocation.

## Storage and execution

Business SQLite owns Book roots, immutable index/content pages, edits, plans, checkpoints and publication receipts. A separate host-owned Historian Session owns native child Conversations and sealed execution results. Each Book has one active merge lane; each bounded batch has an independent native Conversation. No cross-database transaction is claimed.

Publication compares the original Book base, current authority and exact result identity, and atomically commits roots, checkpoint and receipt. Edits share version checks but do not require a Historian attempt or advance intake. Source changes are paged directly from immutable committed batches. RuntimeRecords supplies finite record transactions; native journal adoption and records calls cannot be treated as one transaction unless wired in the same adapter commit.

## Read model

Use immutable paged indexes with version roots, keyed records and finite cursors. History queries read an exact revision without replaying all predecessors. Normal edits change only affected paths. Artifact identities and source versions remain separate from current navigation authority. Source navigation replays an entry-rooted route in the fixed Book revision and the original source windows. It carries the bounded actual ancestor/leaf read set through every await and synchronously reauthorizes it at the outermost return. Book reads also register their publication authorization in the common async wrapper, after its final await. Book bodies, graph data and stored citations use the Book object authority, not inherited target-body permissions. Actual source fetches check the objects they read. Memo owns the source-format adapter, bounded navigation and sharing policy in @pakka/memo/dynamite, using existing public Book capabilities. Metadata conversion does not re-read entries merely to authorize cited targets. Memo captures a source result verifier before DTO conversion and propagates it through its own read/search, Patchouli and final native consumers; independent published Wiki knowledge retains its own authority. Reference continuations include the ordered whole-window fingerprint, so even a same-version injectable provider cannot silently substitute a changed sequence.

## Historical execution seam

The adapter exposes a host-bound historical-work service backed by RuntimeRecords in the selected business namespace. Preparation fixes the source Conversation, exact artifact references, output schema, request, maximum calls and target Book base. A unique CAS claimant changes planned to running; repeating a committed preparation receipt never grants execution ownership. The request uses a separately registered Historian native container and the host-approved model catalog.

Every native request first persists an attempt reservation in the original work record. Bounded repair stays in the same child Conversation. Only the sealed complete native result can make the work publishable; a missing response queries that original child. A publication records facade augments the Book's final transaction with the work checkpoint and adoption identity. It validates namespace, original result digest and work revision in that same commit. Ordinary Book edits keep using the ordinary records port.

Historian reuses the finite native execution mechanism with separate policy/job kinds and a keyed job directory. Its in-memory execution map and persistent active index retain only unfinished jobs; completed histories remain keyed and queryable. Reopening neither replays unfinished native submissions nor resets their attempt counters.

## Lifecycle

Disabled construction and Book read/edit perform no auxiliary inference. Explicit enable fixes the input start, pause retains the interval, disable ends it, and backfill declares a fixed range. Stable request/attempt identity and durable allowance survive reopen. Unknown effects remain blocked; existing sealed output is reconciled locally.

## Verification and choices

Use actual SQLite, local deterministic native providers, controlled CAS/publication/revocation barriers and installed artifacts. Verify standalone Book before Memo composition. The design chooses finite per-batch Conversations over one growing native thread; it reuses Compresser principles while avoiding its aggregate job registry and full journal cache for new histories.

The approved source draft is locally retained in the Dynamite worktree docs/.temp/approved-design.md. Normative expectations are self-contained in docs/state/history-book.md and the delta spec.
