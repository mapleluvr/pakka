## 1. Adoption and baseline

- [x] 1.1 Fetch and record dev/#5, create an isolated branch, retain old worktrees.
- [x] 1.2 Adopt generic ticket state and persistence formation record; keep Memo/workflow independent.
- [x] 1.3 Restore and verify thin-layer consumers on the new baseline.

## 2. Storage

- [x] 2.1 Observe failing atomic-record/idempotency/reopen/cursor tests.
- [x] 2.2 Implement bounded host records, transaction receipts, indexes and maintenance inventory.
- [x] 2.3 Split RSI repository and add old-layout migration with preserved identities.
- [x] 2.4 Verify growth, byte limits, concurrency, permissions and real SQLite failure boundaries.

## 3. Dispatch recovery

- [x] 3.1 Observe failing pure original-request lookup and interruption tests.
- [x] 3.2 Add MAS lookup with exact identity and current authority.
- [x] 3.3 Implement fixed run plans/checkpoints and explicit safe recovery; retain unknown effects.
- [x] 3.4 Verify no second admission/generation and no automatic execution on reopen/restore.

## 4. Consumers and delivery

- [x] 4.1 Update detail/history pagination in UI, Bot, protocol and installed consumers.
- [x] 4.2 Run relevant full check/build/tests, browser and installed archive acceptance.
- [x] 4.3 Run independent reviewer workflow, fix valid findings and revalidate affected paths.
- [x] 4.4 Preserve local evidence bundle, record summary/hash, audit staged and complete PR diff.
- [x] 4.5 Commit/push independent branch, verify remote SHA and create PR to dev.

Delivery: implementation `46e99ce2ac09164e1a3e65f5950fe5e738b72806` on `pakka/rsi-persistence`, remote SHA verified; [PR #10](https://github.com/mapleluvr/pakka/pull/10) targets `dev`. Full regression: 938 tests, 936 pass, 0 fail, 2 platform skips; 10 installed archives and 37 consumer steps pass. Both independent reviewers conclude OK with notes after the seven corrections, with the cross-window event note covered by the parent probe. [Verification summary and local evidence identity](../../../docs/verification/RSI-PERSISTENCE.md). PR #5 and its branch remain unchanged; merging and old-branch cleanup are separate.
