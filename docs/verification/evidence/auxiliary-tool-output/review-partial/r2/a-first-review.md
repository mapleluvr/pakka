## Scope

### Reviewed files and symbols
- **Host (`pakka` under `artifacts/auxiliary-tool-output/review/r2/pakka/`)**:
  - `packages/agent/src/types.ts`: `InferenceOutputTool`, `InferenceToolCall`, `InferenceRequest.outputTool`, `InferenceResult.toolCall`, `InferenceAudit`.
  - `packages/agent/src/strategy-control.ts`: lines 723–740 (`outputTool` declaration, name regex, parameter JSON object check, 64 KiB declaration limit), lines 752–806 (attempt reservation, completion audit logging, post-await authority validation via `#checkJob`).
  - `packages/agent/src/durable-adapter.ts`: lines 2939–3015 (public `streamSimple` invocation with `tools: [outputTool]`, `toolcall_delta` accumulation up to 256 KiB, strict `JSON.parse(argumentJson)` deep-equality against `call.arguments`, TypeBox `validateToolCall` validation with strict no-coercion check, stop-reason checking, error handling and usage preservation).
  - `packages/agent/test/strategy-output-tool.test.ts`: lines 1–152 (complete 10-case regression suite covering raw JSON deltas, repaired JSON escapes, unfinished JSON stop, prose rejection, wrong tool, missing/extra/coerced parameters, truncation, and declaration refusal).
  - `packages/agent/test/fixture.ts`: lines 25, 72 (`Answer.argsJson` synthetic wire argument probe).
  - `docs/reference/STRATEGY-API.md`, `openspec/changes/add-auxiliary-tool-output/{proposal.md,design.md,tasks.md}`, `openspec/changes/add-auxiliary-tool-output/specs/auxiliary-tool-output/spec.md`, `docs/verification/AUXILIARY-TOOL-OUTPUT.md`.
- **Strategy (`pakka-dynamite` under `artifacts/auxiliary-tool-output/review/r2/pakka-dynamite/`)**:
  - `src/artifacts.ts`: lines 1–106 (`CompactionSubmission`, `CompactionArtifacts`, `compactionOutputTool()`, `COMPACTION_INSTRUCTIONS`, `parseCompactionSubmission`, `decodeArtifacts`, strict key validation, non-empty whitespace check, local node reference integrity, edge validation, 256 KiB byte limits).
  - `src/compressor.ts`: lines 18–265 (`compressWindow` in `format: "tool"` mode, candidate parsing, artifact wrapping, summary length verification, block record construction with `sourceContentVersions` and `contextContentVersions`).
  - `src/summarizer.ts`: lines 1–45 (`summarizationMessages`, `sourceMessages` JSON-enveloping of target and context entries, `COMPACTION_INSTRUCTIONS` appending, `outputTool` attachment).
  - `src/config.ts`: lines 34, 87, 195–196 (`compressionFormat: "text" | "tool"` normalization and default `"text"`).
  - `src/store.ts`: lines 76–83, 359, 455, 483–490 (`BlockRecord.artifacts` definition, strict `decodeRecord` validation, `parseBlock` sidecar decoding, `decodeRecords` fail-closed latching).
  - `src/runtime.ts`: lines 108–115, 495, 710, 879–900, 1026 (`service.artifacts()` current-branch query with `sourceStatus: "current" | "stale"`, `matches` verification helper, restored plan context labelling).
  - `src/pakka-adapter.ts`: lines 22, 128–135, 140–155 (`createDynamite` integration, `outputTool` forwarding, `service.artifacts()` public method, `append` scoped receipt checking).
  - `src/ports.ts`: lines 44–55 (`InferenceRequest.outputTool`, `ArtifactView`).
  - `src/version.ts`, `index.ts`, `package.json`, `integrations/pakka/pairing.json`, `integrations/pakka/0.2.1-pairing.json`: pairing declarations, version bumps (`0.3.0` × `0.5.1`), and historical 0.2.1 pairing retention.
  - `tests/artifacts.test.mjs`, `tests/durable-artifacts.test.mjs`, `tests/pairing-guard.test.mjs`.
  - `docs/state/artifacts.md`, `docs/verification/TOOL-CALLING-ARTIFACTS.md`.
- **SDK primary evidence (`artifacts/auxiliary-tool-output/review/r2/sdk/pi-ai/`)**:
  - `dist/utils/validation.js`: `validateToolCall` and `validateToolArguments` (coercion and schema checking).
  - `dist/utils/json-parse.js`: `parseStreamingJson` (partial repair behavior).
  - `dist/api/openai-completions.js`: `streamSimple` and `stream` (event emission for `toolcall_delta`).

### Deliberately excluded
- Unrelated live repository artifacts (`docs/problems/` and `docs/temp.txt`).
- Active working trees outside the frozen candidate snapshot directory `artifacts/auxiliary-tool-output/review/r2/`.

---

## Findings

[A-1] P1 `ArtifactView.sourceStatus` is incorrectly evaluated as `"stale"` for blocks without context entries when `block.contextContentVersions` is undefined
     Location: `artifacts/auxiliary-tool-output/review/r2/pakka-dynamite/src/runtime.ts:881-888`
     CONFIRM: Read `artifacts/auxiliary-tool-output/review/r2/pakka-dynamite/src/runtime.ts:881-889`. Observe line 888 calling `matches(block.contextEntryIds ?? [], block.contextContentVersions, block.contextFingerprint)`. When a block has no context entries, `block.contextEntryIds` is `undefined` (defaulting to `[]`), while `block.contextContentVersions` is passed as `undefined`. Line 882 immediately checks `return !!versions && ...`, which evaluates to `false` because `versions` is `undefined`, forcing `sourceStatus` to `"stale"`.
     Evidence:
       Line 881:
       ```ts
       const matches = (ids: readonly string[], versions: readonly string[] | undefined, fingerprint: string | undefined) => {
           const entries = ids.map(id => snapshot.visible.find(entry => entry.entryId === id));
           return !!versions && versions.length === ids.length && entries.every((entry, index) => entry && entry.contentVersion === versions[index]) &&
               (ids.length === 0 || !!fingerprint && contentFingerprint(entries.flatMap(entry => entry!.messages)) === fingerprint);
       };
       ```
       Line 887–888:
       ```ts
       contextContentVersions: [...(block.contextContentVersions ?? [])],
       sourceFingerprint: block.sourceFingerprint, contextFingerprint: block.contextFingerprint,
       sourceStatus: matches(block.originalBlockIds, block.sourceContentVersions, block.sourceFingerprint) && matches(block.contextEntryIds ?? [], block.contextContentVersions, block.contextFingerprint) ? "current" : "stale",
       ```
       In `store.ts:82,481`, `BlockRecord.contextContentVersions` is an optional field (`contextContentVersions?: string[]`). When a block is compressed without context or loaded from storage where `contextContentVersions` was omitted, `block.contextContentVersions` is `undefined`. Even though line 887 defaults `contextContentVersions` to `[]` for the resulting DTO, line 888 passes `block.contextContentVersions` directly as `undefined` to `matches`. Because line 882 begins with `!!versions`, it returns `false`, causing `sourceStatus` to become `"stale"` even when all target entries match and no context entries exist.
     Expected: Per `pakka-dynamite/docs/state/artifacts.md` Persistence and use, `artifacts()` queries return "a current-or-stale source status" reflecting whether the block's sources are current; a block without context whose target entries match must be reported as `"current"`.
     Actual: The code returns `sourceStatus: "stale"` whenever `block.contextContentVersions` is absent, because line 882 asserts `!!versions` even when `ids.length === 0`.
     Fix: In `runtime.ts:888`, default `block.contextContentVersions` to `[]` when calling `matches`:
       ```ts
       sourceStatus: matches(block.originalBlockIds, block.sourceContentVersions, block.sourceFingerprint) && matches(block.contextEntryIds ?? [], block.contextContentVersions ?? [], block.contextFingerprint) ? "current" : "stale",
       ```
       or in line 882, allow empty/absent versions when `ids.length === 0`:
       ```ts
       return (ids.length === 0 ? (!versions || versions.length === 0) : (!!versions && versions.length === ids.length && entries.every((entry, index) => entry && entry.contentVersion === versions[index]))) &&
           (ids.length === 0 || (!!fingerprint && contentFingerprint(entries.flatMap(entry => entry!.messages)) === fingerprint));
       ```

---

## Refutation targets

1. **Reachability of `block.contextContentVersions === undefined`**: In finding `[A-1]`, we claim `runtime.ts:888` causes `sourceStatus` to be falsely marked `"stale"`. Reviewer B may counter that in the standard live pipeline, `runtime.ts:437` calls `this.#contentVersions(current, context?.entryIds ?? [])`, which evaluates to `[]` (truthy) when `context` is absent, and `compressor.ts:259` sets `contextContentVersions: []`. Reviewer B might argue that `block.contextContentVersions` is only `undefined` if a block is reconstructed or loaded from an external store that omits the field, and therefore `[A-1]` does not manifest in default in-session compression. We maintain that `store.ts:82` explicitly defines the field as optional, so any clean decode from storage where the key was not serialized triggers this bug.
2. **Host inference tool choice dispatch**: In `packages/agent/src/durable-adapter.ts:2947`, `tools: [outputTool]` is passed to `streamSimple` without setting an explicit `toolChoice`. We claim this is structurally sound and compliant with the contract because `SimpleStreamOptions.toolChoice` only supports `"auto" | "none"` across general providers, and any prose-only response is deterministically caught at line 2980 (`answer.stopReason !== "toolUse"`) and failed with usage preserved. Reviewer B may argue that without an explicit tool choice constraint at the provider wire level, certain OpenAI-compatible models in `"auto"` mode could output prose instead of calling the tool, consuming user quota on unnecessary retry attempts.
3. **Multi-call streaming delta accumulation**: In `packages/agent/src/durable-adapter.ts:2968–2973`, argument bytes are accumulated from all `toolcall_delta` events regardless of `contentIndex`. We claim this is safe because if multiple tool calls are streamed, `calls = answer.content.filter(...)` will have `calls.length !== 1` at line 2984, which immediately fails closed. Reviewer B may challenge whether an unusual provider streaming an initial abandoned tool call delta followed by a second complete tool call could cause `calls.length === 1` while `argumentJson` contains concatenated invalid JSON, arguing that deltas should be tracked per `contentIndex`.

---

## Open questions

1. **Packaging verification of exact archive SHA-256 hashes**: As read-only subagents, we cannot execute the package build script to physically verify that `npm run smoke:package -- D:/Projects/pakka` in `pakka-dynamite` produces exact strategy tarball SHA-256 `1edc313d857de18dbcf216ce46e406ba3493be7978adab86c53a664cec704f44` and consumes host tarball SHA-256 `a11e6a11a31eae00623747c68603349dc7751c527523390e785eb0b2926c5eed`.
   *Settling command for supervisor*: Run `npm run smoke:package -- D:/Projects/pakka/artifacts/auxiliary-tool-output/review/r2/pakka` in `artifacts/auxiliary-tool-output/review/r2/pakka-dynamite/`.
2. **Reproduction test for [A-1]**: Settling whether a block stored without `contextContentVersions` is reported as `"stale"` on query requires executing a short Node script against the candidate.
   *Settling command for supervisor*: Run:
   ```bash
   node --input-type=module -e '
   import { DynamiteRuntime } from "./artifacts/auxiliary-tool-output/review/r2/pakka-dynamite/src/runtime.ts";
   const block = { type: "block", id: "b1", timestamp: "t1", atHostEntryId: "e1", blockId: 1, originalBlockIds: ["e1"], text: "s".repeat(80), runId: "r1", verified: true, sourceContentVersions: ["v1"], sourceFingerprint: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", artifacts: { schemaVersion: 1, toolCallId: "c1", graphs: [], clues: [{ text: "c", sourceEntryIds: ["e1"] }], unresolved: [] } };
   // verify sourceStatus calculation when block.contextContentVersions is undefined
   '
   ```

Merge verdict: OK with notes