# Tasks

- [x] Adopt offline P0-1 and P1-2 design; inspect original writer, people and launcher boundaries.
- [x] Restricted Session-kernel maintenance with identity and atomic stores, no execution engine.
- [x] Original-owner recovery with private staged delivery, operation reconciliation and single-use expiry.
- [x] CLI target preview/confirmation and exact dead-writer recovery.
- [x] Complete storage inventory, private streaming backup and manifest checks; external services require trusted declarations.
- [x] Original-location staged restore, durable publication journal, auth invalidation and execution hold/review. Includes damaged/missing source, real exited original claim and interrupted publication.
- [x] Pinned release upgrade, pre-upgrade backup, no-effect health and data-aware rollback. Installed consumer confirms activation, original Session reopen and receipt-only repeated rollback after new work.
- [x] Scoped + installed regressions; final build/types/full regression; durable evidence. 838 total / 836 pass / 0 fail / 2 original platform skips; 8 archives and 34 independent installed steps passed.
- [ ] State, guides, original recovery tasks and PR #4 updated; remote SHA checked.

## Current verification

Frozen candidate source SHA-256: `0a962daae2e8600d809a5d1b5ad8217892f0bdbb5f26d8486c2614b585e85f68` (20 changed TS/MJS files over `83246ba`), identical before/after and preservation. Build/types, 838 total / 836 pass / 0 fail / 2 original skips, and all 34 installed steps with 8 archives passed. Latest 17-path active probe returned no TypeScript error; auxiliary rule dispositions and silent/oversized coverage are recorded separately, not called clean. [Fixed verification and limits](../../../docs/verification/LOCAL-MAINTENANCE-DELIVERY.md) preserve failed experiments and actual identities. Windows ACL and long paths were exercised; POSIX, arbitrary-version migration and entire-HOME reconstruction remain unclaimed.

## Near-term resource pressure

- [ ] Measure WebUI/Runtime RSS and heap against active Conversations, retained history bytes and subscriptions; preserve a reproducible load fixture.
- [ ] Bound observation by bytes and isolate long streams from control requests; preserve stop/recovery responsiveness under slow clients/reconnects.
- [ ] Define active Runtime budget and idle unload/reopen using original durable identity; large history does not mandate resident copies.
- [ ] Evaluate worker memory limits/process isolation and contained OOM recovery based on these measurements.
