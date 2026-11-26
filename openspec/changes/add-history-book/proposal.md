# History Book and opt-in Historian

## Why

Issue #9 requires immediate historical consolidation and later knowledge research. Existing Dynamite produces local P2/P3/P4 but has no History Book producer or standalone Agent editor. Its artifact query materializes the current frame and accumulated journal records.

The operator approved the candidate design and clarified that Dynamite owns Book production and all query/edit services. Memo is an optional upper layer: Patchouli analyses these products and writes knowledge to Memo DB.

## What Changes

- Add bounded fixed-version artifact reads and historical-task authority in the host.
- Add Dynamite Book persistence, versioned graph editing, annotations and standalone invocation-bound tools.
- Add opt-in Historian with independent native job Conversations, finite repair, original-result recovery and atomic publication.
- Add real Memo/Patchouli consumption after standalone Dynamite acceptance.

## Impact

Host public types/adapter, external Dynamite package, Memo source adapter, examples, cross-repository pairing and affected tests. Existing Compresser concurrency, source checks and native tool protocol remain applicable. New records carry original identities and resource limits; a cumulative lifetime quota is not introduced.

The implementation starts from fetched Pakka dev cc1cdd8 and Dynamite main e074c14. PR #12 is merged. No production implementation or test success is implied by adopting this specification.
