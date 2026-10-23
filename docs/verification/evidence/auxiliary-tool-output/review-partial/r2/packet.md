# Review packet: Dynamite P2/P3/P4 Tool Calling — complete retry candidate

Frozen root: D:/Projects/pakka/artifacts/auxiliary-tool-output/review/r2/
Read manifest.json for byte identities; inspect only these copied trees as the target. Parent remains sole product writer and final decision owner.

This is the same operator-selected adversarial-review workflow, retried after the previous B launch failed because its default model was absent. This retry explicitly uses registered B Mapleluv-Main/deepseek-v4-flash:high; A retains the configured reviewer model. The prior partial A report/failed receipt are in pakka/docs/verification/evidence/auxiliary-tool-output/review-partial/ and are NOT a passing combined verdict. Freshly assess the whole current target; do not treat the prior report as authority.

## Authorized work and contracts

User: 用 state-evo，阅读现有文档系统和开发规范，开始调研并实现 pakka-dynamite P2,3,4 的 Tool Calling 式生产。

Contracts:
- pakka-dynamite/docs/state/artifacts.md
- pakka/openspec/changes/add-auxiliary-tool-output/{proposal,design,tasks}.md and specs/auxiliary-tool-output/spec.md
- pakka/docs/reference/STRATEGY-API.md
- Original proposal: pakka-dynamite/docs/dynamite-design-notes.md §3.2, not a claim that its full research design is already implemented.

One optional outputTool declaration on the existing governed SourceJob.infer request. The public host returns one complete matching schema-valid toolCall DTO. No returned tool is executed, main transcript is untouched, normal budget/source/lifecycle/exact-attempt adoption checks still govern. Measured usage survives rejection/quarantine. Text is still default.

Dynamite explicitly configures compressionFormat: tool; one inference produces P1 summary, local source-linked P2 graphs with P3 annotations, P4 clues and unresolved information. Strict shape, fields, source IDs, graph-local nodes and byte bounds precede adoption. Persist the existing accepted run/block in one append. Query returns frozen authorized current-branch DTOs with original provenance plus current/stale source status. Sidecars survive reduce and normal reopen; only P1 enters main HTTP on trigger/flush. Graph merge, semantic accuracy, independent semantic validation, active navigation and agentic evidence reads are separate research work, not claimed here. The previous product-pair acceptance remains version-specific.

## Candidate source scope

Host changed: pakka/packages/agent/src/{types,strategy-control,durable-adapter}.ts; new test/strategy-output-tool.test.ts; fixture.ts now allows synthetic raw JSON arguments for the failure-first wire probe. Follow existing reservation/completion/audit/checkJob/adoption code. Version is 0.5.1 and internal workspace consumers/lock track it.

Strategy changed: pakka-dynamite/src/{artifacts,compressor,config,pakka-adapter,ports,runtime,store,summarizer,version}.ts and index.ts. New tests/artifacts.test.mjs, tests/durable-artifacts.test.mjs; existing engine-ports.test.mjs, helpers/durable-fixture.mjs and pairing-guard.test.mjs updated. Version is 0.3.0, exact peer 0.5.1, separately pinned archive and old 0.2.1 pairing saved unchanged. Packaging/public type consumer updated. State/change/verification docs follow their established ownership.

## Important change after the old snapshot

Parent reproduced that Pi's parseStreamingJson repairs an unfinished object and an invalid escape even when provider emits a tool_calls finish. Both incorrectly completed under the old adapter. The current adapter uses public Models.streamSimple, accumulates public toolcall_delta text up to 256 KiB, drains to completion to retain usage, then requires strict JSON.parse(argumentJson) to exactly equal the final call arguments before the public schema/no-coercion check. Missing complete deltas fail closed. It accesses no SDK-private scratch fields, modifies no dependency, executes no model tool, and supports the actual tested OpenAI-completions-compatible path. See copied strict-json-red.log and strict-json-green.log. The pinned SDK package/version, public types/models exports, normalization/validation source and OpenAI-completions implementation are in sdk/pi-ai/ as read-only primary evidence; reading them does not imply private imports are allowed.

Other parent fixes already included: failed-plan reconstruction preserves recent context source labels; after wrapping the sidecar with schema/call metadata the compressor re-decodes it so a near-limit candidate cannot poison persisted recovery.

## Executed evidence — all current code/archive bytes

- Host: check and audited pack passed; 100/100 strategy source regressions with --expose-gc, including 10/10 output tool cases.
- Strategy: full 369/369; typecheck/build passed.
- New outside-repo installed consumer: 56/56 public tests, declaration compile passed; 348 real localhost provider requests, 0 fixture errors. No oracle adapter, coding-agent/agent-core/tui/codemode/mcp production dependencies; only Pi AI/Chord/Telemetry 1.0.3 + bundled Durable 1.0.3-pakka.1.
- Host archive SHA256 a11e6a11a31eae00623747c68603349dc7751c527523390e785eb0b2926c5eed.
- Strategy archive SHA256 1edc313d857de18dbcf216ce46e406ba3493be7978adab86c53a664cec704f44.
- pakka/docs/verification/AUXILIARY-TOOL-OUTPUT.md and pakka-dynamite/docs/verification/TOOL-CALLING-ARTIFACTS.md index tracked raw evidence. Strategy evidence includes original synthetic requests.json and tool-production.json from the installed real host.
- Rejected/incomplete runs are retained as failures: the first host command omitted --expose-gc; npm ci hit workspace-LSP tsc.exe EPERM then restored after stopping only that LSP; the archive guard correctly rejected changed bytes but an obsolete M6 error-text match failed, now corrected while archive/provenance byte invariants remain strict.

## Required review

Find reachable new bugs, with severity and path:line plus working CONFIRM. Focus on authority, exact receipts, source/edit/lifecycle races, malformed output and missing delta rejection, memory/size bounds, unknown persistence, strict stored decoding, current-branch query/freeze, accounting and installed public API. Challenge your counterpart's severity, reachability and unsupported claims. Quantify added complexity where useful; propose a smaller concrete fix only when it preserves the current contract. Do not add a speculative stress benchmark or provider matrix as a blocking requirement. Runtime claims you cannot execute must say so and provide the exact bounded reproduction. Parent has not run an unbounded memory/semantic/paid-model evaluation and claims none.

Retain both final opinions, all disputes and rebuttals. Pending docs/tasks will be closed only after the actual protocol and parent disposition. Unrelated operator docs/problems/ and docs/temp.txt are excluded.
