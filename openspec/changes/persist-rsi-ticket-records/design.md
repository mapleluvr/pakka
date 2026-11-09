## Context

Baseline: fetched dev `8798fe7297a619a537a812bd82ceae3fe137035d`. Thin-layer source: PR #5 `cb6eea9dbe284b78c302476f435e4b4663d631da`. The operator corrected the earlier RI/workflow conflation and approved a persistence redesign based on Dynamite's host-owned documents, atomic receipts and fixed-work recovery.

## Decisions

- Reuse the owning Session SQLite and writer. RSI receives frozen records and scoped commands, never mutable Pi handles or a second database connection.
- Add a separate records port instead of enlarging RuntimeStore. Each key has an optimistic version; a commit atomically validates a finite read set and writes records, stream indexes and a durable transaction receipt.
- Preserve heads as small mutable projections. Revisions/events/plans/receipts have stable individual addresses. Cursor indexes have bounded pages; each query has item/byte/scan limits. History is not loaded at service creation.
- Keep ticket version, content revision, run identity and native delivery identity separate. Detail/history contracts become explicitly paged; no silent truncation of a complete-history DTO.
- Explicit dispatch saves a fixed plan and then a pre-send checkpoint. Recovery distinguishes planned work from possible dispatch. Pure original-request lookup precedes any continuation. MAS admission hooks may have effects, so repeating send is not a read operation.
- Update observations only after commit; uncertain storage blocks writes. Authorization is revalidated at commit and publication. Reopening/reading never sends work.
- Migrate source records in a paused namespace and publish the new layout atomically. Old pending/unknown states remain uncertain, never converted to definitely-unsent plans. Preserve all business and delivery identities.
- Reuse backup and restore lifecycle while extending pending-work inventory. A recovered backup stays held for explicit reconciliation.

## Independent review corrections

The first two-reviewer pass identified seven reproducible boundary failures. Business request deduplication and exclusive execution now have separate identities: an extension operation or dispatch checkpoint must win its own CAS attempt before executing. Restore confirmation aggregates record work alongside native tasks and inputs. Records distinguish precommit refusal from postcommit publication loss; the latter preserves the original request for reconciliation. History accepts only events whose complete encoded bytes fit a bounded page, list publication is guarded by the committed change sequence with finite retries, and dispatcher preflight validates the fixed payload before plan acceptance or admission. These corrections implement the adopted identity, authority, bounded-reading and recovery expectations without changing the ticket/workflow scope. The original reports, failed reproductions and final retest evidence remain in the local evidence bundle.

## Trade-offs

The default ticket namespace shares its Session fault/lifecycle domain; an independent ticket service domain is a later deployment choice. Same-file storage does not make RSI and MAS API calls atomic. Fixed intents, receiving-side deduplication and reconciliation span that gap. Dynamite's existing journal cache still accumulates records; RSI uses bounded reads instead of copying that cache.

## Verification

Failure-first real SQLite/Runtime tests; original thin-layer permissions and consumers; long history beyond former caps; true commit faults; interruption before send and after acceptance; exact-route conflict; paged browser/Bot consumers; installed archives; independent reviewer workflow and artifact hygiene. Only key results and whole local evidence-bundle hash enter Git.
