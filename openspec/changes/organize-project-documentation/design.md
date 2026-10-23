## Context

This change records the state-evo documentation work from `dde6012` and the operator's subsequent 2026-10-21 direction: preserve OpenSpec, make docs/changes a complete reference summary, and move superseded/irrelevant files into `D:/Projects/kappa/backups/pakka-1021` before removing them. This OpenSpec record is written now; it was not present during the earlier decision.

The original documentation record and all pre-cleanup tracked docs/OpenSpec/config files are captured by the backup manifest. Local plans are not the sole basis for this decision.

## Goals / Non-Goals

- One detailed change home in OpenSpec, accessible from a short OVERVIEW and summary.
- Current expectations separate from progress and historical evidence.
- Reversible, digest-verified removal of redundant and stale materials.
- No product behavior, authority, lifecycle, acceptance status or dependency changes.

## Decisions

### Documentation ownership

| Content                                            | Owner                                                                                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current expectations and domain relationships      | docs/state, with explicit API/OpenSpec mappings                                                                                                                      |
| Complete adopted change                            | OpenSpec proposal/design/tasks and every specs/\*\*/spec.md                                                                                                          |
| Cross-change summary                               | docs/changes, with change directory and all artifact/spec references                                                                                                 |
| Current gaps                                       | [Version-scoped status snapshot](https://github.com/mapleluvr/pakka/blob/200af506913ee38d7a357e5da96ea5e2afc03d67/docs/PAKKA-POCKET-STATUS.md) and local active-plan |
| Actual usage                                       | guides                                                                                                                                                               |
| Public fields and development rules                | reference/development                                                                                                                                                |
| Fixed candidate evidence and compatibility history | verification, visual-primitives and append-only ledger                                                                                                               |
| Scratch work                                       | ignored docs/.temp; existing runners use ignored artifacts                                                                                                           |

A summary lists the exact change, proposal, design when present, tasks, every delta spec and related main specs. Multi-change summaries enumerate all changes. Archiving updates these references to the archived change and resulting main specs, rather than leaving a stale active path.

### Cleanup selection

Old plan wrappers, superseded MAS layout sketches, design revisions, old state copies and obsolete documentation audit reports are backed up and removed once their adopted content is in state/OpenSpec. Core and P0–P5 acceptance, historical failed pairings, current R2 candidate/styles evidence and public interfaces remain available.

The three M3–M5 acceptance redirects remain because the append-only compatibility ledger links them. Current candidate/raw evidence is not rewritten to repair an obsolete draft. The earlier R2 oracle is a live test dependency and stays with its referenced drafts; its adoption draft only rebases one design link, verified as an exact link-only change against the backup. The superseded R1 visual run is offloaded with its original digests; the current candidate run remains in the worktree.

Before deletion, store original relative paths, type/size, SHA-256 or link target, and restore instructions outside the worktree. Do not follow reparse points. If a source changes or a lock prevents verification/removal, retain that source and report the exception. Host processes are not killed for cleanup.

### Ignore scope

Existing scratch/artifacts/CU/dependency rules remain in place. The final index-byte check found that the root `*.log` rule omitted selected formal evidence logs. Add `!*.log` only in this cleanup evidence directory, rather than broadening ignore coverage or relying on unstaged local output. Verify every retained raw record against its digest and staged bytes.

### Existing OpenSpec diagnostics

OpenSpec 1.14.3 initially reports 4 strict failures across 9 items: two Purpose placeholders and three long requirement descriptions (one item contains both). Fill only the Purpose placeholders. Keep existing normative text intact; record the three remaining legacy length warnings rather than truncate conditions to obtain a passing score.

## 2026-10-22 state-evo review and publication

The operator requested a fresh state-evo review, authorized a trial revision, and subsequently requested publication. The review used negative wording as a search signal and then checked each passage against its role and source: some passages still depended on rejected layouts or earlier implementations, while others expressed active failure, authority or scheduling conditions.

The adopted revision describes the current product composition, supported conditions and behavior directly in domain state and the mapped Devin delta. Historical comparisons remain in their existing designs. Evidence-taking instructions live in development/VERIFICATION.md, and product scope links point to the WebUI/MAS, core and frontend formation records rather than to the documentation cleanup as their origin.

Contract rereading retained native prompt/steer/followUp scheduling, authority checks, original-request unknown reconciliation, stylesheet readiness and separate acceptance gates. It also corrected two trial ambiguities: reserved admissions can release on scope change before transfer, separately from exact withdrawal of queued input; explicit reply association is required for reply edges, rather than for every relationship. Current runtime/API contracts remain the detailed owners. This is a documentation expression and ownership revision; product scope, implementation and the fixed candidate retain their identities.

Publication restores the work entry to the outstanding installed-consumer diagnostics. Document validation remains separate from the product FAIL/BLOCKED results; inherited strict requirement-length warnings retain their failure status.

## Verification and handoff

Run the installed CLI on all specs/changes and individually on new changes, check local links/anchors and all change-summary references, format changed Markdown, and compare runtime files/current evidence to their before hashes. A CLI schema result is not product acceptance. Cleanup totals, exceptions and restore paths belong in the cleanup report.
