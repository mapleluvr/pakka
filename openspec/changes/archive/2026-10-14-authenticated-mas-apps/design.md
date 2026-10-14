## Context

M4 is accepted at 601430c. See proposal.md for motivation. All model configuration and mutable Pi state remain in the existing controlled bootstrap/adapter; the new transport must consume MAS clients rather than recreate authority or scheduling.

## Goals / Non-Goals

Goals: one validated browser-safe protocol and connection implementation shared by CLI/browser; an executable explicitly configured server; authenticated identities fixed by the host; actual native resource operations and persistent admission reconciliation through the accepted services.

Non-goals: public Internet hosting/TLS termination, arbitrary plugin/config execution, GUI, account management, JWT/OAuth issuance, shared-storage writers or Dynamite. The initial listener is IPv4 loopback with explicit approved browser origins. Authentication tokens are dedicated client connection credentials, not model/provider secrets.

## Decisions

- `packages/protocol` owns finite closed command/result schemas, refs and errors; `packages/client` owns fetch, response validation, cancellation and reconnect. Neither depends on Pi/Node/server. Reusing MAS itself as browser client would import server runtime code; protocol-only interfaces plus shared client prevent that.
- The server exposes authenticated versioned JSON RPC, with strict body/response bounds, connection-independent request identity, finite concurrency and no ambient config discovery. Host/Origin checks protect loopback browser access. No cookies or bearer tokens in URLs/logs; remote request fields cannot choose caller, owner, source, endpoint, path, tools or budget.
- Host presets bind token -> principal/source/grants and an issuer-side revocation state. The existing `withAuthority` closure threads request/identity checks into underlying commit boundaries. Revoked roles cannot be reissued just because a new HTTP request reconnects. Any trusted role administration is distinct from agent lifecycle grants.
- Reconnect obtains a fresh per-Session catalog snapshot with server identity; version/cursor are descriptive and scoped, never a global cross-Session epoch or capability. The server does not replay mutations on disconnect. Repeating message identity uses native retained dedup; waiting is distinct from generation and external effects.
- Cancellation terminates a connection wait/lease. Explicit queued withdrawal uses precise native receipt; target abort/retire remain owner controlled. Neither disconnect nor requested abort refunds quotas/creation slots or proves non-delivery.
- Native broker receipt decoding validates identity/shape, target/request correlation and allowed status before publication/replay; actual supported endpoints still verify their namespace-bound receipt principal and authoritative native ID. Schema validity cannot mint delivery proof.

## Risks / Trade-offs

- Loopback HTTP is not remote-network confidentiality -> refuse unapproved hosts/origins and document TLS/proxy as unsupported until separately gated.
- Missing/ambiguous effects after disconnect -> return unknown locally and reconcile the same durable request; never claim cancellation rolled back an input.
- Response schema drift or forged references -> runtime validate both sides, exact version and scope checks; old references fail existing gate checks.
- Limited retention -> native records/capacity remain bounded; do not delete receipts to permit replay.
- CLI config contains trusted bootstrap values -> only explicit operator-selected config, no home/credential discovery, sensitive values never printed. Tests use generated local-only fixtures.

## Migration Plan

Add the decoder counterexample/fix first, then protocol and client with real server consumers, then executable config/CLI and actual browser connection. Preserve accepted private worker/DevPack paths and validate full gates + external tarballs. Version each changed package and freeze hashes. Two bounded selected adversarial passes precede M5 acceptance; revert code never claims to revert data/effects.
