## Scope

Reviewed files and symbols in frozen commit `005544b096a62dacc5c0e7b6920320416ad89156` relative to `4ad5c92dc48afbabe25f5c6814247ab2a6d19436`:
- **Core WebUI App & Views**: `apps/webui/web/app.js` (`ToolCard`, `Message`, palette navigation, Title Case headings), `apps/webui/web/frontend.js` (home toolbar, icon-btn accessible labels, keyboard hints, navigation), `apps/webui/web/native-composer.js` (mode labels, microphone button wiring, focus target hierarchy), `apps/webui/web/navigation.js` (Conversation settings, fork headings, form styling), `apps/webui/web/configuration.js` (Title Case usage and limits), `apps/webui/web/conversation-configuration.js` (`ModelPicker` listbox, choice rows, directory picker headings), `apps/webui/web/credentials.js` (`PrivateCredentials` form layout, replace/clear action separation), `apps/webui/web/voice.js` (`MicButton` accessible states, SVG microphone and stop icons), `apps/webui/web/extensions.js` (palette labels, shortcut icons).
- **Public Shared Components & CSS**: `apps/webui/src/components.ts` (`Icon` paths for `up`, `down`, `right`, `enter`, `shift`, `stop`, `microphone`; `Button`, `Field`, `Notice`, `Stack`), `apps/webui/web/elements.css` (CSS variables `--line-strong`, `--panel`, `--body`, `--surface`, composer focus outline on `.composer-card`, `.pocket-icon` metrics, `.pocket-disclosure`, `.pocket-form`, `.pocket-form-actions`, `.pocket-extension-button`, `:where(.extension-page)` typography, `.pocket-dictate` sizing).
- **Bundled Contributions**: `apps/webui/contributions/approvals/` (`manifest.json`, `web/index.js`), `apps/webui/contributions/browser/` (`manifest.json`, `web/index.js`), `apps/webui/contributions/files/` (`manifest.json`, `web/files.css`, `web/index.js`), `apps/webui/contributions/hooks/` (`manifest.json`, `web/hooks.css`), `apps/webui/contributions/memory/` (`manifest.json`, `web/memory.css`), `apps/webui/contributions/schedules/` (`manifest.json`, `web/index.js`).
- **MAS DevPack**: `packages/mas-devpack/src/browser/graph-board.ts`, `packages/mas-devpack/src/browser/board.css`.
- **Contracts and Docs**: `docs/state/frontend.md`, `openspec/changes/improve-webui-navigation-and-local-recovery/design.md` (sections 6.2 and 6.3), `openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md`, `openspec/changes/improve-webui-navigation-and-local-recovery/tasks.md` (task 4.2).
- **Test Suite & Verification Evidence**: `apps/webui/test/composer-focus-browser.test.ts`, `apps/webui/test/svg-iconography.test.ts`, `apps/webui/test/typography-spacing-browser.test.ts`, `apps/webui/test/voice-browser.test.ts`, `apps/webui/test/collaboration-browser.test.ts`, `apps/webui/test/collaboration-late.test.ts`, `apps/webui/test/extension-browser.test.ts`, `apps/webui/test/files-browser.test.ts`, `apps/webui/test/independent-configuration-browser.test.ts`, `apps/webui/test/memory-browser.test.ts`, `apps/webui/test/schedules-browser.test.ts`, `apps/webui/test/transcript-parts-browser.test.ts`, and test run logs in `docs/.temp/typography-icons/`.

**Deliberately excluded**:
- Pre-existing single-Session creation semantics (OpenSpec design section 6.3 / task 4.3): per contract instructions, existing creation mislabel and lack of native multi-session persistence remain recorded as pre-existing and out of scope for a code finding.
- Isolated Linux GUI desktop acceptance: blocked by host infrastructure (no `agent-workspace-linux` display tool in environment), logged as external blocked gate per `review-packet.md`.

---

## Findings

[A-1] P1 Candidate diff renames the home Commands button's accessible name but omits updating existing test selectors in `devin-palette-browser.test.ts` and `devin-shell-browser.test.ts`, breaking full test suite runs.
     Location: `apps/webui/web/frontend.js:348`
     CONFIRM: `grep -n 'Commands and extensions' apps/webui/test/devin-palette-browser.test.ts apps/webui/test/devin-shell-browser.test.ts` (or read `docs/.temp/typography-icons/full-suite.txt` lines 668-678)
     Evidence: In `candidate.diff` lines 2018-2027 (`apps/webui/web/frontend.js:348`), `aria-label="Commands and extensions"` was changed to `aria-label="Commands & Extensions"`. However, `candidate.diff` touched only `collaboration-browser.test.ts`, `collaboration-late.test.ts`, and `independent-configuration-browser.test.ts`, leaving `apps/webui/test/devin-palette-browser.test.ts` and `apps/webui/test/devin-shell-browser.test.ts` unchanged. Running `npm test` against the candidate patch produced 2 hard failures in `docs/.temp/typography-icons/full-suite.txt:668-678` with `Error: Browser control not interactable: [aria-label="Commands and extensions"]`.
     Expected: All existing regression tests pass when candidate commit `005544b` is applied on base `4ad5c92`.
     Actual: Tests searching for `[aria-label="Commands and extensions"]` fail because the home toolbar button's `aria-label` changed without shipping the corresponding test query updates in `candidate.diff`.
     Fix: Include the selector updates (`[aria-label="Commands & Extensions"]`) in `apps/webui/test/devin-palette-browser.test.ts` and `apps/webui/test/devin-shell-browser.test.ts` within the candidate commit, or retain `aria-label="Commands and extensions"` on the button while keeping Title Case for the inner visible text.

[A-2] P2 Missing `.sr-only` utility style in `packages/mas-devpack/src/browser/board.css` leaks visible text in standalone or third-party embeddings.
     Location: `packages/mas-devpack/src/browser/board.css:575` and `packages/mas-devpack/src/browser/graph-board.ts:941,1142`
     CONFIRM: `grep -n 'sr-only' packages/mas-devpack/src/browser/board.css` (returns 0 matches)
     Evidence: `graph-board.ts` lines 941 and 1142 introduce `h("span", { class: "sr-only" }, "to")` to give the directional SVG arrow an accessible name. However, `.sr-only` is not defined anywhere in `packages/mas-devpack/src/browser/board.css`; it exists only in `apps/webui/web/reference.css:131`. When MAS board components are mounted in any host or standalone test harness that does not load `reference.css`, the string `"to"` renders visibly in the DOM next to the arrow icon.
     Expected: Extension packages encapsulate their own styling rules so their rendered markup does not rely on undeclared styles in external application stylesheets.
     Actual: `board.css` lacks `.sr-only`, causing visual leakage if rendered without the host's `reference.css`.
     Fix: Add `.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }` to `packages/mas-devpack/src/browser/board.css`.

[A-3] P2 High selector specificity on `.pocket-extension-button` prevents clean style overrides by extension authors.
     Location: `apps/webui/web/elements.css:815`
     CONFIRM: Read `apps/webui/web/elements.css` lines 791, 815, and 844 to compare `:where(...)` usage.
     Evidence: In `elements.css:791` and `844`, host typography and input defaults for extensions are wrapped in `:where(.extension-page)` and `:where(.extension-page, .pocket-extension-field)` with specificity (0, 0, 0) so extensions can easily override them. By contrast, line 815 defines `.pocket-extension-button` as a class selector with specificity (0, 1, 0). Because `components.ts:64` injects this class onto every public `Button`, an extension providing standard element styling like `.my-view button { padding: 4px; }` (specificity 0, 1, 1) or `.button { ... }` in external stylesheets cannot override padding, min-height, or border without using higher specificity or `!important`.
     Expected: Public extension primitives use `:where()` pseudo-class for base theme defaults to preserve clean author cascade precedence.
     Actual: `.pocket-extension-button` imposes class specificity (0, 1, 0) on all public `Button` instances.
     Fix: Wrap the selector in `:where(.pocket-extension-button)` in `apps/webui/web/elements.css:815`.

[A-4] P2 Preact `class` JSX attribute is dropped by `<Button>` in favor of `className`.
     Location: `apps/webui/src/components.ts:52-66`
     CONFIRM: Read `apps/webui/src/components.ts` lines 52-66.
     Evidence: `Button` destructures `{ className, children, ...props }` and constructs `h("button", { type: "button", ...props, class: ["button", "pocket-extension-button", className].filter(Boolean).join(" ") }, children)`. Because `props` is spread before the generated `class` attribute, any consumer passing Preact's standard `class="custom-btn"` (rather than React's `className`) has `props.class` overwritten and silently discarded.
     Expected: Shared UI primitives in a Preact ecosystem accept either `class` or `className`.
     Actual: Passing `class` to `<Button>` is ignored and discarded.
     Fix: Read `const extraClass = className ?? (props as Record<string, unknown>).class;` and delete `(props as Record<string, unknown>).class` before spreading `props`.

---

## Refutation targets

- **Target [A-1]**: The supervisor or Reviewer B may counter that `apps/webui/test/devin-palette-browser.test.ts` and `apps/webui/test/devin-shell-browser.test.ts` in the current worktree already contain `Commands & Extensions` and passed in `affected.txt`. I am unsure because while the worktree files were updated, `candidate.diff` between `4ad5c92` and `005544b` does not track that change, meaning the frozen commit snapshot `005544b` itself is missing those test diffs when applied onto clean base `4ad5c92`.
- **Target [A-3]**: Reviewer B may argue that `.pocket-extension-button` was deliberately assigned class-level specificity (0, 1, 0) to ensure third-party extensions without dedicated CSS do not fall back to browser-native button appearances (such as the unstyled 28px buttons flagged in `test/extension-browser.test.ts`), and that extension authors intending to style buttons will use class selectors of equal or greater specificity.
- **Target [A-4]**: Reviewer B may argue that TypeScript's `ButtonHTMLAttributes` interface explicitly models `className?: string`, and all shipped extensions use `className` exclusively, making `class` dropping a purely theoretical concern for the current repository.

---

## Open questions

1. **Flake vs Deterministic Focus Race in `typography-accessibility-browser.test.ts`**: In `full-suite.txt:684`, subtest `message input has a visible keyboard focus indicator` failed with `AssertionError: keyboard focus must remain visibly indicated after the editor removes its own outline` (`false !== true`), whereas in `affected.txt:39` it passed (`27.24ms`). Read-only tools cannot settle whether this failure was caused by CDP focus loss under concurrent multi-test execution or by an edge case in `page.key("Tab")` following `document.querySelector(...).focus()`.
   *Settling command*: `node --test apps/webui/test/typography-accessibility-browser.test.ts`
2. **Clean Baseline Git Delta for `devin-palette-browser.test.ts`**: Read-only tools cannot inspect git object trees directly to verify whether `4ad5c92` already had `Commands & Extensions` or whether unstaged changes in the worktree explain why `candidate.diff` differs from `full-suite.txt` execution.
   *Settling command*: `git diff 4ad5c92dc48afbabe25f5c6814247ab2a6d19436 005544b096a62dacc5c0e7b6920320416ad89156 -- apps/webui/test/devin-palette-browser.test.ts`

Merge verdict: OK with notes