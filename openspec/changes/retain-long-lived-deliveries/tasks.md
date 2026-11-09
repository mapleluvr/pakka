# Tasks

Baseline: fetched origin/dev e7c938ef3b7c2005ef9db319bd84598c25ab8b23. Work branch: pakka/long-lived-deliveries.

- [x] Adopt operator requirement separating long-lived persistence and model context; trace current admission/storage cost.
- [x] Reproduce the cumulative refusal with deterministic local provider tests before implementation.
- [x] Separate retained records and pending index; remove cumulative admission and configuration-identity check.
- [x] Preserve native atomic admission, original receipts, pending/authority/unknown rules and v1 migration.
- [x] Update public configuration, server, WebUI, real worker and installed-consumer examples.
- [x] Update Runtime/MAS expectations, API/compatibility text and complete OpenSpec records.
- [x] Finish frozen-candidate build, typecheck, full regression, installed consumers and relevant diagnostics. Full: 816 tests, 814 passed, 0 failed, 2 platform skips; 8 installed archives passed. [Fixed evidence](../../../docs/verification/LONG-LIVED-DELIVERIES.md).
- [x] Record exact evidence/range, review staged files, commit/push work branch and open PR to dev. Implementation/evidence commit: `278fceb69c727a7a367ccc3e237c122c1b331b1b`; [PR #4 → dev](https://github.com/mapleluvr/pakka/pull/4) is open. Remote branch SHA was independently checked; no merge to dev/main was performed.

## Follow-up boundaries

The independent broker outbox, received/inbox collection queries and scope-filtered history scans have their own scaling work. The independent default-Dynamite change owns model-context lifecycle. These are not completion claims of this same-Session admission change.
