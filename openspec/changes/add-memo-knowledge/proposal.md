## Why

Issue [#9](https://github.com/mapleluvr/pakka/issues/9) requests an independently usable knowledge service and optional persistent librarian. The operator authorized work on the issue and clarified that its knowledge-service checkbox was accidental. The verified dev baseline 55d097c contains only the Memo package skeleton.

## What Changes

- Deliver the knowledge-service slice first: Wiki identity/revisions, library roles, source references, integrated discovery, bounded reading and a real headless/native-tool consumer.
- Use a separate host-selected Memo SQLite domain with atomic mutation receipts and paged historical records.
- Keep source reading behind current host authorization and exact reference/version checks.
- Add opt-in persistent Patchouli through separate subentries: passive requests/reopen, explicit/timed wake, one active research, actual publication receipts, cancellation and original MAS recovery.
- Retain actual Historian/History Book integration and long-lived generation changes as subsequent work; current Dynamite exposes P1–P4 sidecars but no Book production contract.
- Retain helper collaboration and GUI as later slices as described by the proposal.

## Capabilities

### New Capabilities

- `memo-knowledge`: independently consumable Wiki and source knowledge service.

## Impact

Memo package, its agent subentry, package-consumer examples, targeted tests and test selection, state and API documentation. No dependency from agent/MAS/RSI to Memo; no model calls on knowledge-service startup.
