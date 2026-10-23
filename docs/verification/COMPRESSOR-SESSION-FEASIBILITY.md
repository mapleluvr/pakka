# Compresser session — native infrastructure feasibility

Date: 2026-10-23. Scope: capability characterization and a reported architecture gate, **not a shipped repair-session implementation**. The [state](../state/compressor-session.md) defines adopted behavior; [formation](../changes/compressor-repair-session.md), [design](../../openspec/changes/add-compressor-repair-session/design.md) and [tasks](../../openspec/changes/add-compressor-repair-session/tasks.md) distinguish the pending route choice and product work.

## Fixed subject and execution

The real production cohort is host `acf49fa6a943f15ac34b4e05e43ca3d3f08238d6`, installed pi-durable `1.0.3-pakka.1`, Pi AI/Chord `1.0.3`. The prepared 1.4 cohort was not installed or promoted. Public package entry points, actual Node JSONL storage and deterministic localhost OpenAI-completions HTTP were used. The Pakka case calls the actual `createRuntime` and managed member path through the existing source fixture. No user credentials, ambient provider discovery or paid inference were used.

Executed from the host root: `node docs/.temp/run-durable-compressor-feasibility.mjs`. The launcher supplies an isolated HOME/USERPROFILE/PI_CODING_AGENT_DIR, PI_OFFLINE=1 and realpath TEMP/TMP; every launch uses fresh source storage. [Probe source](evidence/compressor-session/probe-source.mjs.txt), [launcher source](evidence/compressor-session/launcher-source.mjs.txt), [stdout](evidence/compressor-session/probe.log), [summary and fingerprints](evidence/compressor-session/summary.json), and [complete observations/HTTP bodies](evidence/compressor-session/observations.json) are retained outside temporary folders. Source evidence copies are documentation, not a new supported product entry point.

## Measured results

All **12 characterization cases passed**: **33 HTTP requests** (31 direct native, 2 actual Pakka), no native report errors or synthetic server errors. Passing characterizations include intentionally unsafe native behavior and do not establish product acceptance.

| Subject | Observation |
| --- | --- |
| Normal stop with draft | onYield continues the original logical submission; next actual request contains prior assistant draft and the corrective user message; success terminates after 2 requests |
| Invalid schema / unavailable tool | Native matched error result reaches next request and afterTools; beforeTool/afterTool are skipped for the failing call |
| Complete-rewrite feedback | Public afterTools appends a context edit; next model-facing tool result retains call-1 and the original diagnostic plus an explicit complete-field rewrite directive |
| Tool tolerance 3 | Exactly 3 invalid requests, count 3, status sealed; beforeRequest blocks the successor; no fourth HTTP |
| Unresolved tolerance 4 | Exactly 4 incomplete-stop requests, count 4, status sealed; no fifth HTTP; draft history remains |
| Mixed categories | Two tool errors plus three incomplete stops retain counts 2/3; a complete sixth request succeeds and terminates |
| Normal reopen | Tool seal, both counts, diagnostic and provider identity are unchanged; attempted post-seal input adds zero HTTP |
| Provider error | afterResponse sees it, onYield does not run, and original input settles unanswered/model_error with native/provider retries off |
| Explicit later provider repair | A manually admitted later native input retains prior tool trajectory; this is not an automatic native error continuation |
| Four explicit provider-failure inputs | afterResponse persists unresolved count 4 and last provider-failure-4; a fifth attempted input is blocked; no automatic repair loop is implemented |
| Strict raw JSON gap | Unguarded native Harness executes a valid DTO repaired from a missing closing brace; passing this characterization records a violation of the desired submission boundary |
| Strict raw JSON composition | Public createProvider API composition observes raw wire events; beforeTool rejects the repaired call with a matched full-rewrite error, and only the subsequent valid call executes |
| Public Pakka member | Tool round consumes primaryAttempts=2 and auxiliaryAttempts=0; a later root input cannot dispatch because primary quota is spent |

The table splits related checks for readability; the exact 12 test names and run results are in the raw log. The tool/unresolved retained physical storage is preserved in [tool threshold storage](evidence/compressor-session/tool-threshold-storage/) and [unresolved threshold storage](evidence/compressor-session/unresolved-threshold-storage/).

## Relevant pinned source boundaries

- Installed `pi-durable/dist/harness/generation.js`, classify/answer: afterResponse is observational; stop/length/toolUse-final invoke onYield; provider error follows retry/terminal classification. onYield returns a final-boundary continuation, not external steer placement.
- Installed `pi-durable/dist/harness/tool.js`, ToolTask.call/settle: unavailable/preparation/schema rejection settles without afterTool; generation afterTools covers the round.
- [Pakka extension and budgets](../../packages/agent/src/durable-adapter.ts): product hooks and tool wrapper are internal; ordinary member generation reserves primary slots. Existing direct auxiliary infer uses strict public argument deltas and separate source-governed reservations.
- [Strategy control](../../packages/agent/src/strategy-control.ts): source job authority, job/strategy caps and audit reservations/completions must remain the spending boundary for any auxiliary conversation port.

## Limits and gate

Native stop/tool repair, normal sealing and reopen are feasible. Provider-error automatic continuation has no public hook in the pinned cohort. Ordinary Pakka Conversation bootstrapping also does not supply the required auxiliary job boundary. The operator asked to report such difficulties before considering a custom loop, so no production route was selected. The design records native patch, bounded native supervisor and explicitly authorized custom-loop alternatives.

The prototype is not a permission/budget/adoption implementation and does not test crash atomicity between a hook document commit and generation settlement. Its provider observer covers the deterministic OpenAI-completions fixture, not every provider or tool-argument fragmentation shape. Multiple simultaneous calls, malicious sources, late adoption and unknown storage still require failure-first product tests. New storage/Conversation alone is not process isolation.

An earlier expanded run reused the first probe sealed storage and consequently made zero requests in the three counter cases. [Failure output](evidence/compressor-session/probe-reused-storage-failure.log) is retained; inspecting the persisted policy identified fixture reuse, and a unique per-run storage launcher then passed all 12. This failure is not relabeled as a product bug or a passing run.

Documentation-only checks for this change include local link targets, OpenSpec strict validation and staged diff whitespace. Existing production source and package bytes remain unchanged; no full product/build/install rerun is claimed. Independent adversarial review is not selected under the operator instruction.
