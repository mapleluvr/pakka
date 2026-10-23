# Tasks

- [x] Reproduce the menu-first Settings behavior with real Pi, a local deterministic provider and an owned browser.
- [x] Connect one-activation Settings navigation, shared page categories and mobile category access.
- [x] Rename product labels and executable, synchronize repository text and relocate the active product change/documents.
- [x] Complete affected regressions, installation and reference/link checks; record their actual results here.
- [x] Prepare the changes and local preview for review.
- [ ] Commit and publication follow the operator's instruction.

## Executed checks

- Build and `npm run check` pass against the existing production Durable cohort.
- 59 affected protocol/client/product/browser regressions pass after the final navigation guard, including desktop/360×600, category handoff, retained draft, delayed People response, viewer permissions, credentials, notification display, executable and CSP/reference CSS checks.
- 627 document links resolve against the renamed files and fixed Git references. The settings/name and renamed product changes pass OpenSpec strict validation.
- Nine changed source/test files have zero primary error-level diagnostics under an active LSP probe. Auxiliary style suggestions from the wider probe are outside this result.
- The produced package was installed outside the repository, and its actual Windows npm `pakka-webui.cmd` starts at `http://localhost:45001`; the branded page and current app/settings/CSS assets return 200. The preview uses separate data and host cookies from the existing main instance.
- Full `smoke:package` is not a pass: after the earlier consumer steps passed, the product consumer stopped at preference initialization. Holding the initial read reproduced the same overwrite on main `259f68d` and this candidate with zero model requests. The concrete example bug is tracked in [product tasks](../pakka-webui/tasks.md#current-example-initialization-issue).

Independent Verification was not selected for this change.
