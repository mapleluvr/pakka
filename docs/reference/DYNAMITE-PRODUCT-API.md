# Optional Dynamite product configuration

> Accepted with notes only in the bounded explicit configuration below. Core 255/255, library 345/345, installed library 47/47 and actual product 5/5 passed; the complete selected product review converged OK with notes and its identity omission was corrected. Exact pairing, both opinions and the product-budget observability limitation are in [the acceptance record](../verification/DYNAMITE-PRODUCT-ACCEPTANCE.md). No default activation is implied.

The supported installation target is the packaged `@pakka/server` bootstrap with an explicit, exact `@pakka/dynamite@0.2.1` optional peer and the accepted `@pakka/agent@0.5.0` archive. The core archive is unchanged. Omitting `dynamite` keeps native context and imports no strategy. Explicit selection without the peer refuses before opening storage. See [application setup](../guides/MAS-APPLICATION-API.md) for the existing server, connection-file and CLI startup path; authentication and resource references do not change.

## Host-owned selection

Add this optional field to the trusted `pakka.server.v1` configuration:

```json
{
	"dynamite": {
		"members": [
			{
				"key": "A",
				"config": {
					"autoCompress": false,
					"protectedTail": { "steps": 10, "tokens": 20000 },
					"queueThresholdTokens": 30000
				}
			}
		]
	}
}
```

`A` must be one unambiguous initial persistent member in `members`. Each selected Conversation gets its own controlled strategy binding, artifact namespace and lease. Same-profile membership does not grant a strategy: an unselected peer may see an advertised tool but its real native invocation is refused. An explicitly unselected profile does not advertise `ctx_reduce`.

The configuration accepts only the member key and the bounded strategy options below. It cannot name an import path, extension, new owner, credential, provider endpoint or arbitrary tool. Dynamite remains an independent optional package, not an agent/MAS dependency. RPC `spawn`, `configure` and `fork` grants are refused before storage in this contribution mode; model-created members do not inherit a strategy service.

## Queueing and automatic work

`ctx_reduce` queues selected source ordinals; a queued result is not an adoption receipt. Actual omission occurs on an allowed trigger. Queue cost is based on billed usage differentials, not the number of queued strings. `threshold` can explicitly select a positive integer token limit or a finite percentage greater than 0 and at most 80. The default remains the library's occupancy policy.

Allowed options are `autoCompress`, `threshold`, `protectedTail`, `queueThresholdTokens`, `compressionWindowTokens`, `compressionMaxWindowTokens`, `compressionMaxOutputTokens`, `compressionContextSteps`, `compressionAttemptsPerModel` and `compressionModel`. The protected tail requires at least two steps and positive tokens. Window/queue/attempt values must be positive safe integers; context steps and output cap may be zero. Zero strategy output cap means the host cap applies, not unlimited provider authority.

Automatic compression is **off by default**. Enabling it also requires the trusted `runtime.inference` model registry and a finite policy for `default-context-strategy`, with the chosen `compressionModel` allowlisted. The existing host owns credentials, endpoints, model identity, Session budget, per-job budget, timeout and real provider output cap. Neither tools nor RPC can supply or expand these fields. A ready summary is only a candidate until an allowed trigger adopts it; inspect actual next HTTP rather than treating a ready notification as successful compression.

A governed attempt without an exact returned inference receipt cannot produce artifact adoption. This does not prove zero cost or rollback. Known reservations and unknown outcomes remain under host control; no budget is refunded. Failed calls with valid attempt IDs retain the existing audit/adoption path. Native source history is not rewritten to perform reduction or compression.

## Revoke, disable and reopen

Programmatic `bootstrapServer()` returns a frozen trusted `revokeDynamite(key)` command only when this feature is selected. It revokes the current lease and disposes that member's strategy; it is not an HTTP/model command and cannot re-grant or configure a service. Revoking A must not affect B's next request.

Lease revocation is not a durable permission-registry deletion. Explicit re-bootstrap uses the operator's approved configuration to create fresh authority. To keep A disabled across restart, remove A from `dynamite.members`; omit `dynamite` entirely to return all members to native context. Retained raw history and artifact records are not erased. Normal closed reopen uses the same storage, Conversation refs and persisted admissions, with fresh leases and the previously consumed strategy+Session quota. It neither creates replacement storage after an unknown nor restores old capability objects. The product regression observes no added auxiliary HTTP after more inputs/reopen; it does not positively distinguish a refused later plan from a plan never generated. Positive budget state is checked separately in the real host/library regression; do not claim a new RPC refusal observer.

Shutdown cancels and drains owned strategy work before closing the runtime, including failure cleanup. Forced exits and unknown writer claims retain the core's existing fail-closed limitations.

## Scope and evidence

Acceptance requires the compiled executable and CLI/client, exact archives, native tool call/result IDs, real HTTP, terminal receipts and original storage—not only library/service calls. The product gate is `npm run test:dynamite:product -- <accepted-agent.tgz> <accepted-dynamite.tgz>`. It rejects changed archives, missing/skipped/cancelled cases, workspace/sibling shortcuts and oracle production dependencies.

This does not enable Dynamite by default, provision it in private workers or dynamic children, support arbitrary restored state, validate vision transport or promise semantic summary quality. The historical M0 failed pairing remains failed; a later accepted pairing is a new record, not a rewrite of that evidence.
