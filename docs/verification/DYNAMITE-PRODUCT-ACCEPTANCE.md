# Optional Dynamite product — bounded acceptance

## Decision and fixed target

Core M1–M6 remains the accepted headless baseline. The post-core combination is accepted **with notes**, only for explicit, host-approved initial persistent members: `@pakka/agent@0.5.0 × @pakka/dynamite@0.2.1`, private `@pakka/server@0.5.0`, with the existing MAS/DevPack/client/protocol/CLI cohort. Native context is still the default. This is not full Kappa/Pi compatibility, a public release, or a pass for the historical M0 pairing.

The authoritative exact source commit and delivery archive hashes are [the new fixed pairing](../../integrations/dynamite/core-m6-pairing.json). The agent archive is unchanged from M6:

```text
@pakka/agent@0.5.0
SHA-256 c5a7e7e1d2c9206baa67c0e0b3cbb479b991582b8e9a64803352d9efd8df3036
bundled pi-durable 1.0.3-pakka.1
Durable SHA-256 535d90fd195a1e9c6c9dc1b22b7f0ca15aac41652bb7d644da616148947bcfa7
```

The separately reviewed library baseline is `dynamite@0.2.0` at `45648f58144bfa0b9d81a35d70a7d108186bf2a9`. Actual product execution exposed the need for a strict inference-receipt correction; the final target is **0.2.1**, not that earlier archive. Historical 0.2.0, intermediate 0.2.1 and reviewed 0.2.1 archives remain in the artifact records. Documentation/pairing metadata changes produce new package bytes: the final archive must be re-hashed and consumed again, never inferred from a version string or an older archive's success.

## Executable evidence

| Subject                               | Result and meaning                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean core install/build/check/format | Passed in an independent, detached, single-writer snapshot; canonical build/check/format repeated before review                                   |
| Core source suite                     | **255/255**, no skip/todo/cancelled; original kernel source and its accepted archive unchanged                                                    |
| Corrective library source             | **345/345**, including real native no-attempt-receipt regression                                                                                  |
| Installed compiled library            | **47/47** in six suites; **299** localhost HTTP requests, zero fixture errors; public declarations and actual production dependency graph checked |
| Existing installed core consumers     | Legacy/runtime/MAS/broker/DevPack/apps/product: **7/3/3/3/8/2/18** local HTTP; real browser/worker/process paths retained                         |
| Actual optional product               | **5/5**, **107 HTTP**, **8 native tool-call/result pairs**, zero fixture errors; real packaged executable/CLI plus trusted bootstrap API          |
| Archive-byte negative controls        | Altering either archive is blocked before build/install, **zero subprocess commands**                                                             |
| Review identity correction            | Omitted-script regression red, then **2/2** metadata coverage tests green; amended review identity **35 files / 2 archives unchanged**            |

The five product cases are `executable`, `scope-revoke`, `unknown-inference`, `compression-64`, and `compression-128`. The executable case uses two actual server PIDs across normal shutdown/reopen. It preserves Session/member/ref/admission identity and dedup. Scope checks include unselected same-profile members, foreign/forged invocations, a plain profile, current lease revoke and explicit configuration disable across rebootstrap. The compression cases inspect actual auxiliary request caps, candidates **and the subsequent main HTTP payload**; merely returning queued/ready is insufficient. Canonical raw history remains retained.

One unknown-inference case sends a real summary HTTP request and deliberately loses its response. Later inputs and normal reopen add no auxiliary request. **That negative observation alone does not prove that a later product plan was generated, attempted and positively refused**; the consumer has no refusal/budget observer. The separate library/native test reads the positive persistent auxiliary budget, and source review verifies the unchanged kernel admission path. Keep those evidence boundaries distinct. This is the accepted B-2 observability note, not a claim of new product telemetry or proof of semantic summary quality.

Primary evidence is under `artifacts/dynamite/product-pairing/`:

- `parent-isolated-1792031057299/parent-gate.json`: clean complete source/baseline gates. Current production hashes were compared to the tested snapshot before copying verified bytes back; conflicting shared-worktree edits were not used as proof.
- `final-candidate-1792033150575/summary.json`, `library-summary.json` and its `productReceipt`: exact reviewed archive, command provenance, installed subjects and per-case raw HTTP/storage/tool evidence.
- `run-uQ7CfC/summary.json`, `run-2PcTnl/summary.json`: both archive-corruption negative controls.
- `review/pass1-complete/`: immutable original 34-file identity, both actual structured opinions, reports, rebuttals, closing and raw workflow receipt/trace.
- `review/coverage-red.log`, `coverage-green.log`, `verify-amended.log`: independent missing-script metadata correction, without changing tested script bytes.
- `final-candidate-current.json` / `delivery-current.json`: final documentation/package metadata repack, final installed product result and delivery identity. Final pairing JSON, not an intermediate artifact pointer, chooses the deliverable.

Artifacts are ignored executable evidence, not dependencies or shipping source. Commands/exit status and raw observations are the proof; checkboxes, report previews and JSON shape alone are not capability evidence.

## Minimal implementation and contract correction

The external adapter reads the native ordered `raw.model[]` array. It keeps `pi.*` kinds, source IDs and metadata; one multi-message entry retains one ordinal. Model/head/system boundaries stay native, not rewritten into legacy records. Existing window/reduce/projection algorithms remain in the external repository.

The product adds one bounded composition module and bootstrap wiring, not a new kernel/protocol/package. Parent-measured physical size is 250 lines for `product-dynamite.ts` (including types/blank lines, excluding the trailing empty split item); tool routing scans at most 128 selected roots and uses the existing unforgeable invocation check for each. This is a physical-size/bounded-scan observation, not a cyclomatic-complexity or latency benchmark. Neither reviewer independently ran the matrices or supplied a performance measurement.

A governed compression job advertises `requiresAttemptReceipt` when its model-enabled binding requires exact inference adoption receipts. Without an exact returned attempt ID, the strategy stops before artifact adoption; it cannot invent an ID or use plain frame authority. **Missing receipt is not proof of zero side effects or refunded spend.** Exact failed attempt IDs retain the existing audit path. The original red test reproduced `Artifact adoption requires exact attempt IDs` and a latched artifact fault; the corrective test passes on the unchanged real host with subsequent main turns still usable. No kernel receipt/quota/persistence check is weakened.

## Independent review and finding closure

The selected `D:/Pi/extensions/pi-adversarial-review/workflows/adversarial-review.js` completed its full eight-child protocol, workflow `c8a6f4d5-f998-4a0c-b43f-1b58d5370fec`, with a 90-minute total deadline. Both structured opinions and closing are **OK with notes**, no unparsed verdicts. There is no identified production-code defect. Complete independent library review `d72df225-bb83-4cd3-a827-42e934ce537c` remains a separate historical review, not a substitute for this product pass.

- **B-1: fixed delivery identity omission.** The actual `scripts/consumer-dynamite-missing.mjs` ran in the gate but was absent from the review's source set. A called it P2; B maintained P1. Parent required closure before delivery rather than using the combined verdict to waive it. The corrected generator includes the file and rejects other unenumerated candidate inputs; original manifest/arguments remain archived. Its SHA is `6af6af159051e687634bbedc7d143bf1483cd5e85e529174265ccefb19fa5c55`, equal in current source, independently tested snapshot and actual installed consumer. Dynamic VERIFY count becomes **35**, with no VERIFY algorithm/count-code change. The severity disagreement is preserved, not reworded as unanimous no-P1.
- **B-2: accepted product observability limitation**, stated above. Do not add a production API solely to remove a report-only note after convergence.
- **Report quality:** A's original no-issues conclusion was withdrawn. B corrected `checkInvocation` to line 167 and revoke/drain to 227–228/236–238/243. An absent attempt ID is not generally proof of no reservation, despite overly broad wording in A's initial discussion. Both actual structured opinions are authoritative review records; B's prose artifact is only a schema-retry note.

Only evidence enumeration and final explanatory/package metadata changed after review; production/test behavior was not extended. No redundant second review was launched after convergence. Existing accepted clone overhead and historical image-classification dissent remain recorded. Initial filtered LSP output is not used as standalone clean evidence; actual compiler and installed gates passed.

## Supported slice and remaining limits

- Explicit exact optional peer; no import-time server/agent creation, credential discovery or default strategy activation.
- Initial selected persistent Conversations only; one service/binding per Conversation with isolated namespaces and shared kernel strategy+Session policy. No automatic worker, fork/dynamic-child, temporary/task-bound provisioning.
- Native invocation identity and source-job scope stay host-controlled. Wire/model input cannot pick modules, endpoints, credentials, owners, grants or inference budgets.
- Current lease revoke is immediate authority removal plus cancel/drain, not rollback of sent calls. Explicit rebootstrap is fresh host authority; remove selection to remain disabled across it. Old capability objects cannot be revived.
- Normal closed reopen only. Forced-exit writer claims, uncertain storage and unknown effects remain fail-closed; no replacement Session, automatic rollback or shared writer.
- Native protocol/image plan preservation is not vision/base64 transport acceptance. Semantic summary quality, hostile Node sandboxing, full provider/Pi/Kappa compatibility, GUI and stock TUI/CLI are not claimed.
- Legacy M0 still has its original **1/6, five failures**. [Original functional goals](../archive/investigations/DEFERRED-DYNAMITE-COMPATIBILITY.md) and unsupported combinations remain available; bounded new-pair acceptance is not a blanket pass for every legacy directory or workflow.

Operator setup and revoke/reopen semantics are [DYNAMITE-PRODUCT-API.md](../reference/DYNAMITE-PRODUCT-API.md). Reproduce the actual product with:

```powershell
npm run test:dynamite:product -- <exact-agent-archive.tgz> <exact-dynamite-archive.tgz>
```

Use the fixed new pairing, audited staged host archive and isolated consumer, not workspace source substitutes, a raw guarded package pack, the legacy M0 command, or user credentials. Packages remain private; no push/publication is implied by acceptance.
