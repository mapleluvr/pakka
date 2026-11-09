# Tasks

- [x] Record the operator's local-only evidence and mandatory artifact-review decision.
- [x] Align workspace rules, contribution/agent entries, delivery state, verification methods, OpenSpec context and the PR checklist.
- [x] Add ignore rules for new raw-evidence directories, TAP and local ZIPs without removing existing tracked evidence.
- [x] Check scoped document links/anchors, formatting, YAML/OpenSpec and ignore behavior; inspect all proposed artifacts.
- [x] Preserve this change's raw checks in a local bundle and record only key results plus its whole SHA-256.
- [x] Commit/push the independent branch, verify the live remote SHA and open its PR to dev without merging.

## Delivery

[PR #7](https://github.com/mapleluvr/pakka/pull/7) was merged by the operator into dev at `2f84881ba21b5a464ab3f7f3f8017efcdc6bcf58`. Original policy commit `c5df6e7877216ea9d57fd175fe44a77a3643066d` and final head `bda6df8697bb2b3929609a60030682d774846a83` retain their identities. The completed remote policy branch was removed during the separately authorized PR #8 closeout; its original local ref/worktree remains. No agent-performed dev/main integration or evidence upload occurred.

## Verification selection

This change is documents and ignore rules only. Select scoped document/metadata/ignore checks and complete artifact review; runtime builds, application regression suites, browser/model calls and remote uploads are not selected.

## Historical scope

Original PR #4/#6 published identities and local evidence are preserved. The operator separately authorized their clean replacement and remote-branch cleanup via [PR #8](https://github.com/mapleluvr/pakka/pull/8); see the [reorganization checks](../../../docs/verification/CLEAN-DELIVERY-REORGANIZATION.md). Original local refs/worktrees remain. Remote deletion does not claim historical GitHub objects are purged; no published-history rewrite or cloud upload was performed.
