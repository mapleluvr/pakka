## Scope

### Reviewed files and symbols
- **Host (`pakka`)**:
  - `packages/agent/src/types.ts`: `InferenceOutputTool`, `InferenceToolCall`, `InferenceRequest.outputTool`, `InferenceResult.toolCall`, `InferenceAudit`.
  - `packages/agent/src/strategy-control.ts`: lines 723–740 (`outputTool` declaration schema/name/byte validation), lines 752–806 (budget reservation, completion audit logging, authority re-verification via `#checkJob`).
  - `packages/agent/src/durable-adapter.ts`: lines 2939–2995 (public Pi SDK `completeSimple` wiring with `tools: [outputTool]`, single matching `toolUse` enforcement, byte-limit check, `@earendil-works/pi-ai` `validateToolCall` execution, strict no-coercion equality check via `isDeepStrictEqual`, usage preservation).
  - `packages/agent/test/strategy-output-tool.test.ts`: lines 1–152 (all 8 unit and integration scenarios covering declaration refusal, immutable frozen arguments, lack of tool execution callback, prose rejection, wrong tool, missing parameter, extra parameter, coerced parameter, and truncation).
  - `docs/reference/STRATEGY-API.md`: lines 131–140 (`outputTool` channel contract).
  - `openspec/changes/add-auxiliary-tool-output/`: `proposal.md`, `design.md`, `tasks.md`, `specs/auxiliary-tool-output/spec.md`.
- **Strategy (`pakka-dynamite`)**:
  - `src/artifacts.ts`: lines 1–106 (`CompactionSubmission`, `CompactionArtifacts`, `compactionOutputTool()`, `COMPACTION_INSTRUCTIONS`, `parseCompactionSubmission`, `decodeArtifacts`, graph-local node isolation, edge reference checking, non-empty whitespace checks, source reference boundaries, 256 KiB UTF-8 byte boundary).
  - `src/compressor.ts`: lines 18–265 (`compressWindow` in `format: "tool"` mode, candidate parsing, artifact wrapping, summary length verification, block record construction with `sourceContentVersions` and `sourceFingerprint`).
  - `src/summarizer.ts`: lines 1–45 (`summarizationMessages`, `sourceMessages` JSON-enveloping of target and context entries, `COMPACTION_INSTRUCTIONS` appending, `outputTool` attachment).
  - `src/config.ts`: lines 36–37, 78, 143–144 (`compressionFormat: "text" | "tool"` normalization and default `"text"`).
  - `src/store.ts`: lines 76–83, 359, 455, 483–490 (`BlockRecord.artifacts` definition, strict `decodeRecord` validation, `parseBlock` sidecar decoding, `decodeRecords` fail-closed latching).
  - `src/runtime.ts`: lines 280–305, 495, 879–900 (`service.artifacts()` current-branch query with `sourceStatus: "current" | "stale"`, projection summary range isolation where sidecars are excluded from main request prompts).
  - `src/pakka-adapter.ts`: lines 22, 128–135, 140–155 (`createDynamite` integration, `outputTool` forwarding, `service.artifacts()` public method, `append` scoped receipt checking).
  - `src/ports.ts`: lines 44–55 (`InferenceRequest.outputTool`, `ArtifactView`).
  - `src/version.ts`, `index.ts`, `package.json`, `integrations/pakka/pairing.json`, `integrations/pakka/0.2.1-pairing.json`: pairing declarations, version bumps (`0.3.0` × `0.5.1`), and historical 0.2.1 pairing retention.
  - `tests/artifacts.test.mjs`, `tests/durable-artifacts.test.mjs`, `tests/pairing-guard.test.mjs`: regression suites for tool generation, persistence, reduce/reopen retention, stale/current provenance checks, and tarball byte tampering guards.
  - `evidence/`: `host-red.log`, `host-green.log`, `bundle-limit-red.log`, `artifacts-green.log`, `extended-green.log`, `full-tests.log`, `host-strategy-with-gc.log`, `package-smoke.log`.

### Deliberately excluded
- Unrelated live repository artifacts (`docs/problems/` and `docs/temp.txt`).
- Active working trees outside the frozen candidate snapshot directory `artifacts/auxiliary-tool-output/review/r1/`.

---

## Findings

No issues found.

---

## Refutation targets

1. **Host inference tool choice dispatch**: In `packages/agent/src/durable-adapter.ts:2947`, `tools: [outputTool]` is passed to `completeSimple` without an explicit `toolChoice: { type: "tool", name: outputTool.name }`. We claim this is structurally safe and conforms to the public Pi SDK contract because `SimpleStreamOptions.toolChoice` only supports `"auto" | "none"` across general providers, and any prose response without a matching tool call is deterministically failed and audited with measured usage retained (verified in `strategy-output-tool.test.ts:56`). Reviewer B may challenge whether standard OpenAI-compatible endpoints in `"auto"` mode could emit prose instead of a tool call in production, arguing for a stricter request-level constraint.
2. **Dual 256 KiB serialization bounds**: In `pakka-dynamite/src/artifacts.ts:90,99`, `byteLimit` (262,144 UTF-8 bytes) is enforced both on the raw model submission arguments (`parseCompactionSubmission`) and on the final wrapped persistence bundle (`decodeArtifacts`). We claim this dual boundary is required because wrapping a candidate near 262 KiB with `{ schemaVersion: 1, toolCallId: "..." }` could otherwise exceed the host persisted sidecar limit. Reviewer B may challenge whether having the compressor reject near-limit candidates at the post-parse stage is an unnecessary double check that could be simplified by lowering the submission schema limit.
3. **Historical block provenance decoding**: In `pakka-dynamite/src/store.ts:359`, `decodeArtifacts` resolves allowed source references against `[...originals, ...(asStringArray(raw.contextEntryIds) ?? [])]`. We claim that defaulting missing `raw.contextEntryIds` to `[]` correctly permits blocks that only reference target entries. Reviewer B may challenge whether any historical or edge-case block could have referenced prior context without recording `contextEntryIds` on the block record, which would cause `decodeArtifacts` to fail closed during reopen.

---

## Open questions

1. **Release tarball byte verification**: The candidate pins provisional tarball hashes in `integrations/pakka/pairing.json` (`tarballSha256: "5223d4e46ba0d27c7d1dd5ceb9ae650e44ce0fa1cc2e140a12eaa3a5f386fd33"`). As a read-only subagent, we cannot execute the final workspace build and packaging scripts.
   *Settling command for supervisor*: Run `npm run smoke:package -- D:/Projects/pakka` in `pakka-dynamite/` to build, pack, and verify that the final tarball hash exactly matches `pairing.json`.
2. **Extended GC stability on repeated tool compaction**: While the parent provided logs for 98/98 tests under `--expose-gc` (`evidence/host-strategy-with-gc.log`), the full memory lifecycle across thousands of consecutive tool compaction calls with deep graph sidecars was not evaluated in a long-running benchmark.
   *Settling command for supervisor*: Run `node --expose-gc scripts/test.mjs --integration` on the built artifacts to attest that frozen sidecar queries create no retain cycles across long session lifecycles.

Merge verdict: OK with notes