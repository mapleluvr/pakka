# Native Compresser first trial

## Fixed subject

Private library trial on Windows, Node 24.18.0, deterministic localhost OpenAI-completions providers and isolated test profiles. No paid model, user credential, custom agent loop, default activation or adversarial review was used.

| Artifact | Version | SHA-256 |
| --- | --- | --- |
| @pakka/agent | 0.6.0 | f502ce87579a05dff90b744a5183e0e3bb235e736c79206c73380852f7c4ab65 |
| @pakka/dynamite | 0.4.0 | fb323bc537bf95e369f268c664e5bcf180a1def79880a1a6ab0938e283e034cd |
| bundled pi-durable | 1.4.0-pakka.1 | 7fd9f3310dfa003a9077139a25faf93567922a065461fa3767dd5a1066efa891 |

[Pair identity](../../integrations/dynamite/compresser-trial-pairing.json), [installed identity](evidence/compresser-session-trial/archive-identity.json) and [36-file source manifest](evidence/compresser-session-trial/source-manifest.json) bind these results. Host source baseline is 88a693c; strategy baseline is 6da541f plus the manifested changes. Historical 0.2.1 × 0.5.0 and 0.3.0 × 0.5.1 records retain their own status and bytes.

Pi AI/Chord/Telemetry are 1.4.0. Durable 1.4.0 explicitly requires pi-codemode 1.4.0; this is a public SDK dependency, not a coding-agent oracle leak or an additional model tool. Installed pi-coding-agent, pi-agent-core, pi-tui and pi-mcp are absent. The controlled compressor declares only its submission tool.

## Selected execution and result

| Gate | Result |
| --- | --- |
| Failure-first production API/driver tests | Expected missing-factory/port RED saved before implementation |
| Host focused boundaries | 22/22 |
| Final full Pakka source | 597 tests: 595 passed, 0 failed, 2 skipped, 0 cancelled |
| Workspace type check / build / audited agent pack | Passed |
| Existing independent installed core/worker/server/WebUI smokes | Passed on the new cohort |
| Dynamite full source | 377/377 |
| Dynamite type check / build | Passed |
| Out-of-repo installed Dynamite matrix | 64/64, no skipped/cancelled |
| Installed matrix HTTP | 403 requests, 0 fixture errors |
| Installed public declarations / dependency inventory / private-subpath rejection | Passed |

The two host skips are existing POSIX-specific browser interception cases on Windows. Host and strategy tests exercise their real production ports, native Durable storage and actual HTTP; pure engine tests in the full source count remain algorithm checks. The independent host smoke is separate from the 403-request Dynamite matrix.

Reproduction: run host npm ci/check/test/build and pack:agent using the fixed vendor cohort; stage the exact host archive through Dynamite bootstrap:host, then npm ci, npm test, typecheck and smoke:package with the explicit host checkout. [Host tasks](../../openspec/changes/add-compressor-repair-session/tasks.md) and [Dynamite record](../../../pakka-dynamite/docs/verification/COMPRESSER-SESSION-TRIAL.md) identify the current scope. Original command output is under [evidence](evidence/compresser-session-trial/), protected by [SHA-256 manifest](evidence/compresser-session-trial/sha256.json). The large pack log remains local with its size/hash retained in archive-identity.json.

## Realized structure

- Bootstrap creates one native container facade and shares it across external Hosts. Dynamite installs one principal-bound service per business Conversation. Native mutable handles stay entirely in the host adapter.
- Every source job owns one independent internal Conversation. One external Conversation can create several; an internal job can span several native runs. The Session policy owns shared cumulative tool/unresolved counts and the seal.
- Each native request reserves/completes the original source-job auxiliary attempt. The result lists all attempts and reported usage; the exact final successful attempt authorizes artifact adoption.
- The external business store owns the atomic run/block append. P1 is summary text; P2 graphs contain P3 annotations, while P4 clues and unresolved items share the version-1 sidecar bundle. This is not four separate Conversations or databases.
- Only P1 enters subsequent primary requests. Generation drafts, failed calls and sidecars stay outside that business-model projection; reduce and normal reopen retain sidecar access.

The [installed repair case](evidence/compresser-session-trial/cases/compresser-repairs/) first stops without a call, then omits clues, then names a foreign source, and finally succeeds. The fourth request retains the draft and matched full-rewrite history. One run/block is adopted; counts remain tool=2, unresolved=1, and known run usage includes all four requests. [Independent-job evidence](evidence/compresser-session-trial/cases/compresser-separate-jobs/) shows several internal Conversations for one external Conversation without draft contamination.

Tool errors use matched full-replacement results. Incomplete stops and provider errors use native steer; afterFailedRun: continue handles failed-run placement. Shared thresholds, sibling in-flight rejection, idempotent live admission, hard budgets, cancellation/revocation, multiple calls, strict raw JSON and source checks are covered by the host tests.

[Actual process interruption](evidence/compresser-session-trial/cases/host-process-interruption/) records dispatch, OS-confirmed child exit, initial writer-lock refusal, explicit trusted removal of the dead claim, and sealed/quarantined reopen with no additional HTTP. It does not simulate a crash by merely requesting abort.

## Failures retained and limits

The first full host run and focused REDs remain intact. Test facilities were corrected for Windows canonical temporary paths, owned Chrome exit/cleanup and waiting until the UI had actually left Working; no product UI behavior was changed.

A separate [CLI path A/B](evidence/compresser-session-trial/host/cli-alias-observation.json) found that the existing CLI entry guard silently exits for an 8.3 module path, while the native long path enters argument parsing. Acceptance consumers now use native canonical paths. This is a known platform boundary, not a claimed CLI alias fix.

One package invocation incorrectly supplied a tarball to the checkout-only smoke command; its ENOENT is retained. Another run passed all 64 functional tests but failed the old pi-codemode absence assertion. The fixed SDK manifest and actual dependency tree justified updating the 1.4 inventory contract; a new Dynamite archive and full installed rerun passed. Neither failed whole run is counted as a passing installation.

Source-bound audit-write uncertainty retains its pending reservation and closes admission; a failed seal write retains the fatal latch. Model effects/usage are not refunded on cancellation or inferred from text. Normal reopen is verified; arbitrary cross-store crash atomicity, automatic unknown-effect resume, historical SQLite migration, other provider event protocols and optional server assembly for this new pair remain separate work. Long-lived history retention/inspection also needs its own operational policy. This trial does not replace historical optional product acceptance or assert semantic summary/graph quality.

The final active probe checked 22 source/script paths: 19 clean, 2 with auxiliary AST findings, 1 inconclusive. No native LSP type error was reported. Twelve auxiliary unchecked-JSON.parse findings occur at top-level acceptance-script metadata reads; malformed evidence must abort those commands, so they remain deliberately fail-closed rather than being swallowed. Three pre-existing suppressed findings were not counted as clean. [Probe/disposition](evidence/compresser-session-trial/lsp-disposition.md) preserves this coverage limit; actual compiler/build checks passed.

## Ownership

Current expectations: [Compresser state](../state/compressor-session.md), [Strategy API](../reference/STRATEGY-API.md), [Dynamite artifact state](../../../pakka-dynamite/docs/state/artifacts.md). Formation: [change](../changes/compressor-repair-session.md), [proposal](../../openspec/changes/add-compressor-repair-session/proposal.md), [design](../../openspec/changes/add-compressor-repair-session/design.md), [tasks](../../openspec/changes/add-compressor-repair-session/tasks.md), [complete delta](../../openspec/changes/add-compressor-repair-session/specs/compressor-repair-session/spec.md). Cohort migration is separately recorded in [the compatibility ledger](../PI-DURABLE-COMPATIBILITY.md) and [cohort tasks](../../openspec/changes/prepare-durable-1-4-0-patch/tasks.md).
