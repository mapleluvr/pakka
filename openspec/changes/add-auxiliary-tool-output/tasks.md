## 1. Contract and investigation

- [x] 1.1 Read state/development and Dynamite migration/design; specify the bounded host output-tool contract and strategy artifact state.
- [x] 1.2 Record real Pi/local HTTP RED before changing host behavior.

## 2. Implementation

- [x] 2.1 Add public request/result DTOs and strict output declaration validation before reserving inference.
- [x] 2.2 Pass the declaration to the public Pi provider and accept exactly one complete schema-valid call; preserve usage, audit, revocation and text behavior.
- [x] 2.3 Implement Dynamite optional Tool Calling generation, strict artifact persistence/provenance and frozen scoped queries in its independent repository.

## 3. Verification and delivery

Selected verification: failure-first focused regressions, affected source/type/build checks, deterministic localhost production, external installed consumer and the operator-selected adversarial workflow. GUI and paid-model evaluation are not selected for this headless production change.

- [x] 3.1 Version and pin a separate host/strategy artifact pair; preserve the historical pair.
- [x] 3.2 Verify real production output, invalid calls, later P1-only request, stale/revoked results, reduce and reopen.
- [x] 3.3 Run affected checks and outside-workspace installed consumers; save fixed command, archive and result identities.
- [ ] 3.4 Run independent adversarial review with both opinions/disputes and parent closing; address verified findings.
- [ ] 3.5 Synchronize final API/state/change/evidence records after review; commit both repositories with empty staged indexes.

Review blocker (2026-10-23): selected run `8c5551f6-5ed6-4ddf-ae36-d31737b40cce` completed A but B failed with HTTP 400 MissingSessionID / missing x-opencode-session. The earlier run failed on the absent default B model. All partial reports/receipts and the parent's A-1 disposition are retained in [the fixed verification record](../../../docs/verification/AUXILIARY-TOOL-OUTPUT.md). The selected script has no B-only recovery entry; repeating completed A work awaits an explicit whole-protocol restart. Candidate implementation/evidence commits do not close 3.4 or authorize archive.
