# Tasks

## Adopt and begin polishing

- [x] Read both selected guides and save source-backed development material.
- [x] Read original offline Devin bundles directly; distinguish production behavior, captured DOM, readable helpers and the prototype.
- [x] Establish reference authority in state, agent instructions and developer entry points.
- [x] Reproduce fixed text scaling, undersized mobile fields/targets and missing composer focus indication before changing product code.
- [x] Implement relative configuration text roles, mobile controls and grouped keyboard focus.
- [x] Run the seven scoped browser checks, including existing appearance and settings navigation regressions.
- [x] Finish scoped regression/build/link/source-identity checks and refresh the local preview.

## Next source-backed increments

Settings routing, forms, page structure, transcript/composer and responsive work now have one follow-up entry in the [navigation and local recovery tasks](../improve-webui-navigation-and-local-recovery/tasks.md). This transfer retains their unfinished status; the completed guide/typography batch and its results remain here.

## Checks

- The initial red run observed all four intended failures. Follow-up red probes exposed the selects' unscaled browser font, fixed group-label size and the mobile minimum at a 12px root. The final scoped run passes all seven checks, including actual select presence, root scaling, keyboard focus, draft retention and zero model dispatch for these operations.
- The first implementation snapshot's full npm test run reported 559 tests: 550 pass, 7 fail and 2 skip. This was before the final select/group-label and reduced-root refinements; it is not a full-suite pass for the final files.
- Five failures reproduce at main@259f68d: four EPERM symlink fixtures (directory access, two browser discovery cases and runtime configuration), and the browser-input test's EBUSY profile cleanup.
- The refusal/browser case failed at the second Send hit-test in the full run. A paired three-run follow-up reproduced the identical failure once on main and zero times on the candidate. This establishes an existing intermittent symptom, not its underlying cause.
- The hooks-recovery file initially could not resolve the agent dist entry during the full run; a separate post-build run passes all three cases. The refusal file's two cases also pass in the separate run.
- Active LSP probes of 13 changed paths reported no findings: the last batch confirmed nine paths and timed out on four. This is partial coverage; the compiler check is recorded separately.
- Build, type/patch-identity checks, strict change validation and 654 local links passed. The upstream Vercel bytes and pinned reference CSS identities match their recorded SHA-256 values.

Local raw runs and captures are in docs/.temp/guideline-polish. Final screenshots were inspected for desktop, larger text, mobile configuration and composer focus. The 45001 preview uses the same explicit reopened session file and the current worktree build.

## Test investigation

The transient second-Send investigation continues in the [follow-up tasks](../improve-webui-navigation-and-local-recovery/tasks.md). The main/candidate observations above remain the baseline; a successful retry alone does not establish a cause.

Independent Verification was not selected for this batch.
