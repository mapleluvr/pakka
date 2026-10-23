# Partial review r2 — parent disposition and infrastructure blocker

Date: 2026-10-23. Candidate: the immutable `artifacts/auxiliary-tool-output/review/r2` source snapshot. This is a parent record of a partial protocol, not the missing independent second opinion or a passing review.

## Retained outputs

- Workflow `8c5551f6-5ed6-4ddf-ae36-d31737b40cce` used the operator-selected `D:/Pi/extensions/pi-adversarial-review/workflows/adversarial-review.js` unchanged, `rounds: 1` and explicit B `Mapleluv-Main/deepseek-v4-flash:high`.
- A child `97734867-5a33-49a0-abfd-8a5f5881d9a6` completed. [Original report](a-first-review.md) is retained without alteration. Its verdict was OK with notes; it labelled A-1 P1.
- B child `f7d46898-abaf-41ea-b2b1-4187432a4c98` failed before an opinion: HTTP 400 `MissingSessionID`, with the message that `x-opencode-session` was missing. [Original error](b-first-failure.md) and [terminal workflow receipt](workflow-receipt.json) are retained.
- No supervisor request remained pending when checked after this failure.

The previous r1 A report and unknown-default-model failure remain in the parent directory. Neither failed attempt produced final opinions, a rebuttal exchange or a mechanically combined review verdict. Tests and A's partial verdict do not replace those stages.

## A-1: missing empty-context proof

The code observation is correct: the query's `matches` helper returns false when the versions proof is absent. The report did not establish the claimed production trigger. The normal compressor does not omit this field for an empty context:

1. `src/runtime.ts` constructs `contextContentVersions` with `#contentVersions(current, context?.entryIds ?? [])`, producing `[]` for no context.
2. `src/compressor.ts` copies the supplied array; an empty array is truthy and remains `[]`.
3. The strict block decoder preserves a supplied array through normal reopen.
4. The real installed consumer's stored block and query contain `contextContentVersions: []`, `contextEntryIds: []` and `sourceStatus: "current"`. Their exact evidence is in the independent strategy repository's `docs/verification/evidence/tool-calling/tool-production.json`.

The parent also confirmed that deleting the proof from a record creates a structurally decodable compatibility record. This establishes the report's conditional observation, not a producer that loses the field. The query conservatively labels incomplete provenance stale. Existing engine-port tests require recovered blocks with missing version proof to fail adoption; optional codec fields preserve structural compatibility rather than certify current provenance.

Disposition: do not adopt A-1 as a demonstrated P1 production bug or relax missing-proof handling. No product edit was made for it. A concrete production or supported recovery path that drops the originally supplied empty proof could change this decision. B never evaluated the claim; no agreement is inferred.

## Other notes

- Prose-only output is explicitly rejected with measured usage retained; the output declaration does not promise that a provider must obey a forced tool choice. A's statement about the full SDK tool-choice enum was not independently established and is not used as evidence.
- Concatenating all tool deltas fails closed for more than one final call; strict parse/equality and a single declared final call are required. No demonstrated acceptance bypass was supplied.
- The recorded outside-repository install already verifies the real roots and exact archive pair. The partial report's proposed command against the reduced review snapshot is not a substitute for the complete executable checkout.

The parent subsequently re-hashed both exact installed archives, checked all selected product source/tests/manifests against r2, and checked historical pairing bytes. Fixed results and the source-file identity list are in the independent strategy repository's `docs/verification/evidence/tool-calling/closing-identities.json` and `closing-identities.log`. No additional model request was used for this closing inspection.

## Blocker and next permitted action

The selected workflow accepts task/focus/packet/rounds/aModel/bModel but has no B-only or retained-first-review entry. Native retained-child revival keeps its recorded model; reviving the failed B would not change its routing. A new full invocation would repeat the completed A stage.

The operator's current instruction says not to rerun completed work, while Pakka requires this exact workflow rather than a custom replacement. Consequently the parent stopped review retries, preserved the partial diffs/results, and committed the implementation as a review-blocked candidate. OpenSpec review and archive remain open. Restarting the whole selected protocol requires resolving that explicit restart boundary; an alternative registered B such as `Mapleluv/gpt-6.1-sol-pro:high` is a concrete same-protocol option, not a completed or approved review.
