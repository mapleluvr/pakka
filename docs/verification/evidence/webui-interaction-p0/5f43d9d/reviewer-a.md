## Scope
- **Files reviewed**:
  - `apps/webui/web/app.js` (`ToolCard`, `Message`, `callKey`, `entrySource`, `declaredCalls`, `receiptGuidance`, transcript and receipt rendering)
  - `apps/webui/web/message-parts.js` (`describePart`, `isRenderableImage`)
  - `apps/webui/web/elements.css` (`.tool-card`, `.tool-preview`, `.part-unrenderable`, `.stream-status`, `.receipt-badge`, `.receipt-guidance`)
  - `apps/webui/test/transcript-parts-browser.test.ts` (all 7 browser test cases, lines 1–754)
  - `packages/protocol/src/pocket.ts` (`PocketInputReceipt` reason property, `part`, `message`, `receipt` validation)
  - `packages/mas-devpack/src/resources.ts` (`PocketInputReceipt` mapping in MAS devpack)
  - `apps/server/src/pocket-workspace.ts` (`receiptCheck` reason mapping)
  - `packages/agent/src/durable-adapter.ts` (in-flight `live.message` `stopReason: "pending"` stripping)
  - `docs/verification/WEBUI-INTERACTION-P0.md`
  - `openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md`
- **Deliberately excluded**:
  - P0-4 Sessions row running state (explicitly deferred and excluded per contract)
  - Plan mode and Goals/Done when (explicit non-goals per repository rules)
  - Recovery login flow and settings deep routes (separate OpenSpec phases 1–3)

---

## Findings

    [A-1] P1 Unanswered receipt badge unconditionally renders "blocked" even when the native reason is "aborted", mislabeling user-withdrawn inputs as policy refusals and locking in the regression with a test assertion.
         Location: apps/webui/web/app.js:913
         CONFIRM: Read apps/webui/web/app.js:912-917 to confirm `receipt.status === "unanswered"` renders `<span class="receipt-badge" data-receipt-reason="blocked">blocked</span>` without inspecting `receipt.reason`; then read apps/webui/test/transcript-parts-browser.test.ts:656-658 to confirm the withdrawal test asserts `assert.equal(receipt.badge, "blocked")`.
         Evidence: In `apps/webui/web/app.js:912-917`, any `unanswered` receipt hardcodes badge text "blocked" and `data-receipt-reason="blocked"`. When a queued input is withdrawn, its receipt reason is `"aborted"`. The UI renders `blocked` adjacent to guidance `Withdrawn before delivery. Send again only when ready.` In `apps/webui/test/transcript-parts-browser.test.ts:657`, test 7 ("withdrawing queued input is not described as a policy refusal") asserts `assert.equal(receipt.badge, "blocked")` to pass against this implementation.
         Expected: Under `openspec/changes/improve-webui-navigation-and-local-recovery/specs/devin-frontend/spec.md` ("a withdrawn input is not mislabeled as policy refusal") and contract rule `aborted != policy refusal`, an aborted/withdrawn receipt must not display a "blocked" badge.
         Actual: In the committed candidate, withdrawn inputs display a "blocked" badge, and the browser test asserts this mislabeling rather than rejecting it.
         Fix: In `apps/webui/web/app.js:913`, conditionally render the badge only when `receipt.reason === "blocked"` (or emit a "withdrawn" badge if `receipt.reason === "aborted"`), and update `apps/webui/test/transcript-parts-browser.test.ts:657` to assert `receipt.badge !== "blocked"`.

    [A-2] P1 Tool card duplication occurs during in-flight generation because declaredCalls does not index toolCall parts from view.live.message.
         Location: apps/webui/web/app.js:654-664
         CONFIRM: Grep `declaredCalls` in apps/webui/web/app.js (found on lines 655, 661, 866, 899). Observe that lines 654-664 only iterate over `allEntries` (committed history), never checking `view.live.message`.
         Evidence: In `apps/webui/web/app.js:654-664`, `declaredCalls` collects tool call IDs strictly from `allEntries`. At line 891, `view.live.message` is rendered by `Message`, which renders `<${ToolCard}>` for every `toolCall` part. At line 898, `view.live.tools` is filtered by `!declaredCalls.has(...)`. Because in-flight calls in `view.live.message` are not in `declaredCalls`, line 898 renders a second `<${ToolCard}>` for the exact same tool call.
         Expected: Per `docs/state/frontend.md:38` and contract ("A single card resolves all three so a call can never appear twice"), a tool call appearing in both `live.message` and `live.tools` must render exactly one card.
         Actual: The transcript renders two `<${ToolCard}>` instances for the same call while `live.message` and `live.tools` overlap before entry commit.
         Fix: In `apps/webui/web/app.js:654-664`, add tool call IDs from `view?.live?.message?.content` into `declaredCalls` before filtering `view.live.tools`.

    [A-3] P2 Unkeyed live message and stream status siblings destabilize Preact DOM reconciliation during live-to-entry handoff.
         Location: apps/webui/web/app.js:891, 908
         CONFIRM: Read apps/webui/web/app.js:891-910 to confirm that `<${Message} isLive>` and `<div class="stream-status">` have no `key` attribute while preceding `<section>` siblings use `key=${entry.id}`.
         Evidence: In `apps/webui/web/app.js:891` and `908`, `<${Message}>` and `<div class="stream-status">` are unkeyed siblings in `.message-list`. When generation finishes and a new `<section key=${entry.id}>` is prepended to the committed list tail, Preact's keyed-unkeyed reconciliation unmounts and remounts the live DOM element rather than morphing it into the committed section.
         Expected: Stable DOM node identity and preservation of user disclosure/scroll state across live-to-entry transition.
         Actual: Unkeyed live elements mixed with keyed history sections cause DOM recycling churn.
         Fix: Provide static keys `key="live-message"` and `key="live-stream-status"`.

    [A-4] P2 Collapsed tool card preview provides no visual differentiation for errored tool results.
         Location: apps/webui/web/elements.css:124-126
         CONFIRM: Read apps/webui/web/elements.css:114 (`.tool-card .tool-preview { color: var(--muted); }`) and line 124 (`.tool-card[data-tool-error="true"] .tool-preview { color: var(--muted); }`).
         Evidence: The CSS selector `.tool-card[data-tool-error="true"] .tool-preview` sets `color: var(--muted);`, which is identical to the base color of `.tool-preview` on line 114.
         Expected: Errored tool executions should have visual prominence (e.g. error color token or pill) when collapsed.
         Actual: A failed tool call preview has the exact same text color and typography as a successful tool call preview.
         Fix: Set `.tool-card[data-tool-error="true"] .tool-preview` to `var(--error, #e06c75)`.

    [A-5] P2 Over 50% of the 754-line browser test comprises custom fixture scaffolding rather than assertions.
         Location: apps/webui/test/transcript-parts-browser.test.ts:39-194, 667-754
         CONFIRM: In `apps/webui/test/transcript-parts-browser.test.ts`, count lines in `seedHistory` (lines 39-194: 156 lines) and `hostSource` (lines 667-754: 88 lines). Scaffolding accounts for 244 lines, plus 64 lines for two standalone HTTP SSE servers (lines 338-369 and 450-482), totaling >308 lines.
         Evidence: `seedHistory` directly manipulates raw jsonl storage, appends 255 dummy entries, and cycles Pocket server instances three times per test. `hostSource` re-implements an entire 88-line custom Extension Service purely to deliver an `unknown` receipt to test 6.
         Expected: Proportional, maintainable browser tests where assertion density outweighs fixture code.
         Actual: While the assertions themselves meaningfully test browser DOM behavior, over half the file consists of heavy ad-hoc server and storage harnesses.
         Fix: Extract shared storage seeding and host source mocking into reusable test helpers under `apps/webui/test/fixture.ts`.

---

## Refutation targets
1. **Finding [A-2] (tool card duplication during live streaming)**:
   *Adversarial vulnerability*: In `pi-durable`, does the native container ever expose a state where `live.generation.message` contains a `toolCall` while `live.tools` simultaneously contains that tool, or is `AssistantEntry` committed before tool execution begins? If generation always closes before tool execution starts, the overlap condition may be unreachable in the live Durable runtime.
2. **Finding [A-1] (receipt badge severity)**:
   *Adversarial vulnerability*: Reviewer B could argue that `data-receipt-reason="blocked"` on an unanswered receipt is merely an unstyled badge text defect (P2) rather than a P1 contract violation, because the adjacent guidance text correctly explains the withdrawal and no network request is leaked.
3. **Finding [A-5] (fixture complexity)**:
   *Adversarial vulnerability*: Reviewer B could argue that because the repository mandates testing against real Durable JSONL storage and live HTTP/SSE without private mocks, the 194-line `seedHistory` and 88-line `hostSource` are irreducible minimum integration requirements rather than gratuitous complexity.

---

## Open questions
1. Does Pi Durable ever emit a snapshot having both `live.generation.message` with `toolCall` parts and `live.tools` entries simultaneously?
   *Evidence to settle*: Run a probe during multi-tool streaming: `node --test packages/agent/test/` with an observation hook on `readConversation`.
2. What are the full test suite and typecheck results on this exact candidate?
   *Command for supervisor*: `npm run check && node --test apps/webui/test/transcript-parts-browser.test.ts`. (Read-only reviewer did not execute shell commands).

---

Merge verdict: BLOCK