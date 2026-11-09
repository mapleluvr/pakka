# Tasks

- [x] Record the operator's local-only evidence and mandatory artifact-review decision.
- [x] Align workspace rules, contribution/agent entries, delivery state, verification methods, OpenSpec context and the PR checklist.
- [x] Add ignore rules for new raw-evidence directories, TAP and local ZIPs without removing existing tracked evidence.
- [x] Check scoped document links/anchors, formatting, YAML/OpenSpec and ignore behavior; inspect all proposed artifacts.
- [x] Preserve this change's raw checks in a local bundle and record only key results plus its whole SHA-256.
- [x] Commit/push the independent branch, verify the live remote SHA and open its PR to dev without merging.

## Delivery

[PR #7](https://github.com/mapleluvr/pakka/pull/7) targets dev and remains open. Policy commit `c5df6e7877216ea9d57fd175fe44a77a3643066d` was pushed and checked against the live remote ref; closing metadata is recorded separately. No dev/main integration or evidence upload was performed.

## Verification selection

This change is documents and ignore rules only. Select scoped document/metadata/ignore checks and complete artifact review; runtime builds, application regression suites, browser/model calls and remote uploads are not selected.

## Historical scope

Existing PR #4/#6 evidence and published identities remain unchanged. Their cleanup, any history rewrite and cloud upload are separate operator-controlled work.
