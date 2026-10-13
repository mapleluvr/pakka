## Context

See proposal.md. M2 already binds MAS clients to native invocation scopes; M3 provides fixed placements, atomic coordinator CAS and recoverable brokers. The DevPack can therefore be a public Host tool/instruction contribution installed by `durable-adapter.ts` using public `defineExtension`, not another Harness or transport.

## Goals / Non-Goals

Goals: real agent tool calls, optional approved profiles, composed revocation at effect boundaries, approved location selection, native ownership and honest receipt waiting.

Non-goals: arbitrary code/credential/model/bootstrap configuration from the model, physical Conversation deletion, distributed atomic commits, automatic stale-writer recovery, full product/provider compatibility, public transport or Dynamite support.

## Decisions

1. `@pakka/mas-devpack` captures a trusted resolver and returns immutable tools/instructions. Every execute obtains an existing approved MAS client, narrows its lease with contribution/cancellation checks and binds the exact current invocation. Copies and peer scopes fail through the existing native gate. The model receives only JSON results.
2. Contribution revocation does not pretend to remove advertised tools. Native profile configuration removes tools/instructions from subsequent provider requests. Installing a new contribution is an explicit trusted bootstrap action, not a model action.
3. Logical actions are `mas.*`; wire function names are `mas_*` to stay within the completions function-name grammar. This is an explicit naming translation, not a provider capability claim. All tests remain deterministic local HTTP.
4. Incoming delivery discovery exposes own native receipt metadata under reply permission. The model obtains real receipt IDs without prompt markers or reading peer transcripts; receipt-linked reply retains its source proof.
5. Approved cross-Session creation reuses M3 broker plans and bounded coordinator stores. Each host-fixed template is a single reservation slot. The model selects a template and stable request ID, not a path/endpoint/budget/owner. Reconciliation uses the same placement; pending/unknown never releases it. A template's source roster is fixed: changing it requires trusted reconstruction, not implicit enrollment.
6. Cross-Session operations recheck the native source lease at routing and coordinator CAS. No cross-Session atomic revocation/rollback is claimed: an already-issued remote prepare/admission can remain uncertain. It receives no replacement allocation or false rollback receipt. In-process target gates can compose live checks; private worker commands retain M3's declared boundary.
7. Ask means bounded waiting for generation completion, not an application answer. Application reply is a separate native receipt-linked action. Timeout preserves placement/admission facts and does not refund quota.

## Risks / Trade-offs

- Fixed slots are deliberately less general than dynamic allocation: finite host-approved resources and executable recovery take priority; exhausted/conflicting slots fail closed.
- A contribution shared by several profiles shares its revocation switch: use one contribution per independently revoked role and configure profile removal explicitly.
- Schema validity is not identity or capability evidence: native invocation, owner, revocation and actual HTTP/storage assertions remain the authority tests.
- Cross-process function closures are not transmitted. Worker-side optional extension installation must be explicitly assembled; unsupported combinations remain declared rather than inferred from multi-Harness tests.

## Migration Plan

Add failing native tool tests; implement contribution and minimally extend controlled MAS ports; verify current/existing/new location and native lifetime cases, optional removal/revocation, restored reservations and installed consumption. Run repository gates and the selected adversarial workflow with two bounded review/fix passes before archive/commit. Preserve Dynamite deferral and historical patch records.
