# Tasks

- [x] Reproduce the menu-first Settings behavior with real Pi, a local deterministic provider and an owned browser.
- [x] Connect one-activation Settings navigation, shared page categories and mobile category access.
- [x] Rename product labels and executable, synchronize repository text and relocate the active product change/documents.
- [x] Complete affected regressions, installation and reference/link checks; record their actual results here.
- [x] Prepare the changes and local preview for review.
- [x] Save the current implementation as a commit and integrate the frontier into main at the operator's instruction.

## Executed checks

- Build and `npm run check` pass against the existing production Durable cohort.
- 59 affected protocol/client/product/browser regressions pass after the final navigation guard, including desktop/360×600, category handoff, retained draft, delayed People response, viewer permissions, credentials, notification display, executable and CSP/reference CSS checks.
- 627 document links resolve against the renamed files and fixed Git references. The settings/name and renamed product changes pass OpenSpec strict validation.
- Nine changed source/test files have zero primary error-level diagnostics under an active LSP probe. Auxiliary style suggestions from the wider probe are outside this result.
- The produced package was installed outside the repository, and its actual Windows npm `pakka-webui.cmd` starts at `http://localhost:45001`; the branded page and current app/settings/CSS assets return 200. The preview uses separate data and host cookies from the existing main instance.
- Full `smoke:package` is not a pass: after the earlier consumer steps passed, the product consumer stopped at preference initialization. Holding the initial read reproduced the same overwrite on main `259f68d` and this candidate with zero model requests. The concrete example bug is tracked in [product tasks](../pakka-webui/tasks.md#current-example-initialization-issue).

Independent Verification was not selected for this change.

## Main integration checkpoint

The operator requested the complete current frontier on main. Source checkpoints are WebUI `a7c6ae1518785b1d498848c7158caca3301b07b2` and Durable patch `4d71faae02f8d531050878a142f402d617649f8c`. The shared OVERVIEW and changes index retain both work streams. The recovery/navigation proposal remains awaiting adoption rather than being treated as implemented.

- The merged tree passes workspace build and `npm run check` with the production dependency cohort unchanged.
- All 14 selected regressions pass: settings navigation, typography/accessibility, appearance persistence, executable entry, import-map newlines and patch-tooling integrity cases.
- Five related changes pass strict validation; 727 local document links resolve. The four manually reconciled/updated document paths have confirmed-clean active LSP results.
- Staged and worktree bytes match for pinned reference CSS, Vercel guide/license and the archive/source-patch/build-lock identities of both Durable patch versions.
- The old host branch commit `c0bb309` is patch-equivalent to main commit `209497a`. Detached diagnostic probe changes remain in their experiment worktrees, outside the product merge.

The checkpoint records this merge scope, not a new full-suite or installed-consumer run. Raw output and identity checks are local to docs/.temp/main-frontier-merge.
