# Fixed-candidate review disposition

Product candidate `005544b096a62dacc5c0e7b6920320416ad89156`, base `4ad5c92dc48afbabe25f5c6814247ab2a6d19436`. Test-only follow-up `75e0c97ebf6880785938d87bf36247536875167b` leaves all `apps/` and `packages/` product files unchanged. These are supervisor dispositions, not a second independent review.

## Retained opinions and workflow result

- [Reviewer A original](reviewer-a.md): run `041e4e82-77ee-4ef3-9317-e259a4a136f2`, final wording `Merge verdict: OK with notes`, with A-1 through A-4 and two open questions. The original is preserved verbatim.
- [Workflow receipt](workflow-receipt.json): run `b6e7361d-3bb7-4dc8-8321-443ccdcf921c` failed at `b-first-challenge` startup: `Unknown subagent model 'Mapleluv-ChatCompletions/deepseek-flash:high' in the active Pi model registry.` B produced no run ID or opinion. No substitution or custom workflow was launched.
- Two-party review remains **BLOCKED**, with no shared convergence verdict. Independent `agent-workspace-linux` GUI acceptance separately remains **BLOCKED**.

## Findings and disputes

| Finding | Supervisor disposition | Evidence and limits |
| --- | --- | --- |
| A-1, obsolete Commands selector | Confirmed at `005544b`; fixed by test-only `75e0c97` | Two selectors and the related title expectation now use the adopted fixed title. The old focus check was also updated to inspect the external composer card. [Test diff](test-followup.diff), [original full failure](logs/full-005544b-failed.txt), [27 passing focused tests](logs/focused-green.txt), and [638-test full run](logs/full-75e0c97-passed.txt) preserve the complete progression. |
| A-2, `.sr-only` absent from `board.css` | Standalone embedding premise is outside the declared WebUI contribution boundary; no product change | MAS Board is installed through the public WebUI slots. `apps/webui/web/index.html:12` loads `/reference.css`, whose `.sr-only` definition is at line 131, before any extension view. A real public extension measured the helper as absolute, 1×1px and clipped. This establishes the supported host utility; it does not prove or adopt standalone MAS embedding. A's proposal to duplicate the utility remains retained as an unagreed encapsulation preference. |
| A-3, button defaults defeat consumer selectors | Concrete examples refuted by measured cascade; no product change | `.my-view button` has specificity `(0,1,1)`, greater than `.pocket-extension-button` `(0,1,0)`. The real consumer's equivalent `.review-probe button` sets padding 4px, min-height 20px and border-width 3px successfully. An equal-specificity `.review-custom` class loaded through the extension asset supplies border color successfully. The result is limited to these examples and this source order; it does not claim every possible lower-priority rule overrides the host. A general `:where()` preference alone is not a reproduced regression. |
| A-4, Preact `class` lost by Button | Source premise and runtime claim refuted; no product change | `apps/webui/src/components.ts:54` destructures `class: className`, not `{ className }` as quoted in the finding. The public extension passes `class:"review-custom"`; actual DOM classes include `button`, `pocket-extension-button`, and `review-custom`. This confirms the reported `class` use; it is not a new guarantee about arbitrary prop combinations. |

The open focus question is resolved by the fixed snapshot: the adopted outline is on the outer card, whereas the old assertion inspected only the editor/internal surface. The test-only diff adds the outer card while preserving the visible-outline requirement; original pointer and real Tab/Shift+Tab tests remain. The full `75e0c97` run passed. A's clean-delta question is resolved by the two commit identities and the retained five-line test correction, rather than treating mutable worktree selectors as evidence about `005544b`.

## Controlled confirmation probe

[Measured result](review-probe.json), [successful output](logs/review-probe-passed.txt), and [source](review-probe.source.txt) retain the exact experiment. To repeat from the repository root with dependencies built, copy the source to `docs/.temp/typography-icons/review-claims.ts` and run `node docs/.temp/typography-icons/review-claims.ts`. It starts an isolated real Runtime, installs an ordinary extension, authenticates, navigates through its real public page, and measures production Button/CSS. It uses the local deterministic provider fixture; provider requests and fixture errors were both zero. The generated extension loads its stylesheet through the production extension asset route.

[First probe failure](logs/review-probe-inline-csp.txt) is also retained: its inline `<style>` was disallowed by the existing `style-src 'self'` CSP (`apps/webui/src/http.ts:603`). The effective padding stayed at the host default. The corrected experiment changed only its stylesheet delivery to the supported external asset and waited for stylesheet readiness. No product change, CSP weakening, installation mutation or fabricated browser response was used.

## Scope and complexity

The product diff spans 27 files (+441 / -112 lines), of which shared `elements.css` accounts for +281 / -6. Twelve test files add 699 and remove 9 lines; the subsequent test-only commit changes five lines in three existing tests. These are `git diff --numstat` counts for `4ad5c92..005544b` and `005544b..75e0c97`, excluding docs/evidence. Changes are presentation and targeted regression coverage: shared styles, static title text, shared SVG paths and microphone/focus wiring. No dependency, state machine, model/provider API, admission, storage schema or scheduling mechanism was added. Session/Conversation creation remains a separately recorded design direction. The review did not establish a functional reason to add duplicate CSS utilities, change the public Button prop handling, or rebuild the stylesheet cascade.
