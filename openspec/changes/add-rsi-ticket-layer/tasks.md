## 1. Scope and package setup

- [x] 1.1 Fetch current dev, preserve unrelated checkout changes, and establish the isolated implementation branch.
- [x] 1.2 Define ticket/service/workflow boundaries and selected verification in proposal, design and delta spec.
- [x] 1.3 Initialize private RSI and inert Memo workspaces with build/public entry boundaries.

## 2. Ticket service

- [x] 2.1 Add and observe failing real-Runtime tests for nonblocking persistence, idempotency, author edits, queries, permissions and reopen.
- [x] 2.2 Implement bounded storage, validated DTOs, identity-bound clients, revisions, assignment and progress/results.
- [x] 2.3 Add and pass actual native invocation tool tests, including copied/stale scope and revoked access.
- [x] 2.4 Add and pass real MAS dispatch/observation tests, preserving input revisions and unknown effects.

## 3. Product surface

- [x] 3.1 Add public Backend/Client schemas and service binding with current human permissions.
- [x] 3.2 Add the ticket list/detail UI, author editing and authorized handling through public extension slots.
- [x] 3.3 Verify actual browser create/edit/observe/handle flows, scoped access and desktop/mobile layout.
- [x] 3.4 Provide a runnable public composition example and usage documentation; keep business workflows and Memo semantics deferred.

## 4. Verification and delivery

- [x] 4.1 Run affected tests, type/build checks and installed public consumer checks against exact built archives.
- [x] 4.2 Record evidence and update state, API/navigation and formation records; validate documentation and OpenSpec.
- [ ] 4.3 Inspect final diff, preserve other worktrees, commit only owned changes with an empty index, and deliver the work branch/PR to dev under repository policy.

Verification: 18/18 affected native/SQLite/MAS/browser regressions; workspace check/build; active LSP on 11 RSI production files; full package smoke including installed RSI and headless declarations; exact archive/install byte and lock integrity checks; direct desktop/mobile inspection; OpenSpec strict validation and 184 local documentation links. Fixed identities and scoped limits are in [the evidence record](../../../docs/verification/RSI-TICKET-LAYER.md).

Dev integration and a release PR remain separate from this work-branch delivery. No subagent review or paid model trial is selected for this thin service slice under the operator's existing instructions.
