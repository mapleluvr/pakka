# Multi-Session Broker and Workers

The broker composes independently owned Sessions through approved placements, a coordinator outbox and the target native admission ledger. [Same-Session MAS](MAS-API.md) supplies each target’s local membership and delivery contract.

## Composition and authority

Trusted bootstrap creates a coordinator `Runtime`, obtains `runtime.store({ namespace, maxBytes })`, and calls `createBroker` from `@pakka/mas/broker` with approved `SessionPlacement` ports and finite `maxMembers`/`maxMessages`. Only frozen JSON snapshots, CAS commands and logical references cross these boundaries. Pi objects and native transactions remain in `durable-adapter.ts`.

`Broker.connect({ principal, source, grants })` returns a frozen client with `discover`, `send`, `reply`, `receipt` and `wait`. Grants are `discover|send|reply`; communication does not grant resource management or transcript access. `source` is an exact enrolled `BrokerAgentRef` or null for a trusted external actor. `revoke(principal)` revokes existing closures and signals pending transport admission; it does not prove withdrawal of already admitted work. A newly created client is a new explicit bootstrap authorization, not revived old authority.

A broker reference separates logical member key, approved placement, Pakka storage/provenance Session ID and native Conversation resource reference. A catalog's physical resource key is not necessarily its logical member key. The provider Session identity is separate from both.

## Enrollment

`bootstrap(plan)` first commits a fixed plan, then prepares each approved placement, records its exact Session/member references and enters `ready`. `activate()` activates and verifies each placement before committing broker `active`. Business input is refused before broker `active`; there is **no cross-Session atomic commit or rollback**. A partial or unconfirmed transition is `unknown` and must reconcile the original management slot, never allocate replacement members. Repeating bootstrap with a changed plan is a conflict.

`inProcessPlacement({ runtime, namespace, maxPending })` wraps an independently owned runtime using the existing MAS catalog. It is not process isolation. A failed initialization promise remains latched to that fixed runtime/configuration; explicit trusted reconstruction is required, rather than automatically retrying an unconfirmed initialization. `SessionEndpoint`/`SessionPlacement` are trusted transport ports and must not be given to model tools: they can prepare/activate and reach native receipt routing.

## Delivery and retention

`send(target, { requestId, text, mode? })` commits an outbox record before target admission. Mode is native `prompt|steer|followUp`; the broker does not replace steering with serial prompts. Outbox identity binds broker namespace, principal, source incarnation and stable request ID; the retained envelope additionally fingerprints source, target, mode and text. A conflicting retry is rejected.

The recipient's durable admission ledger atomically records its fingerprint and original native submission ID. Lost responses are reconciled using that same identity. `wait(id)` may retry a locally owned unknown outbox record **only with a fresh check of its original send/reply grant and bound source**. Merely being able to inspect a receipt does not authorize dispatch. A sender or addressed receiver may await an already-admitted native submission without a send/reply grant; this observes the existing submission and does not re-admit work. A receiver may reply to an addressed receipt if the original source is known and its reply grant is current.

Receipts retain `pending|queued|placed|done|unanswered|unknown` and, when known, the native receipt. Confirmed `done`/`unanswered` outcomes are sticky: worker unavailability and late failed observations cannot downgrade them, including concurrent receipt updates. Provider/tool/filesystem effects are not covered by admission deduplication. Abort, timeout, disconnect or process exit never proves non-delivery. Capacity is finite, non-evicting, whole-lifetime retention: no TTL or unsafe expiration reset. External side effects are not exactly-once.

The relay uses a trusted coordinator outbox and target native admission ledger. Model tools reach it through approved Session services, documented in [DevPack API](MAS-DEVPack-API.md). Cross-Session revocation is checked before dispatch; the recipient commits on its independent commit line.

## Worker app

`apps/server` contains the private worker/bootstrap app. `createWorkerManager` accepts fixed runtime/catalog presets, `maxWorkers`, `startupTimeoutMs` and `requestTimeoutMs`. Each runtime preset requires absolute approved cwd/dataDir and a lowercase `reservedSessionId` UUID, using the same grammar as the adapter and validated before deriving a storage path. Only string/profile configuration supported by the worker is accepted; arbitrary extension/tool functions are not transmitted over IPC.

`runtime.reservedSessionId` is a trusted create-once storage/provenance address. Existing storage is never overwritten: direct creation rejects an existing directory; explicit `reopenSessionFile` must match the reservation and provenance. The manager computes the exact reserved path before starting the process and uses explicit reopen for an existing complete storage. An incomplete initialization or unconfirmed writer ownership blocks startup, not a replacement allocation.

The manager exposes `placement(key)`, frozen `view()` (including PID/generation), `stop(key, { force? })` and `close()`. Every child uses actual Node fork IPC with sanitized environment, version/generation/request correlation, bounded finite JSON and an allowlisted command schema. Old endpoint closures fail after close/exit; normal close/reopen preserves native identity and reconstructs fresh command authority. A duplicate writer is refused by the adapter. Forced termination leaves an unknown/crash claim; neither PID reuse nor a timeout authorizes deleting it. There is no automatic stale-lock theft or process-crash recovery claim. A protocol-faulted slot immediately rejects further commands and replacement allocation, but its process is retained until explicit `stop()`/`close()` (initialization failures terminate immediately); sealing does not claim to have stopped previously admitted effects.

The worker has no HTTP listener, authentication endpoint or GUI/client protocol. Running `start:worker` without its manager's private IPC channel fails closed. The separate HTTP/CLI interface is documented in [the application guide](../guides/MAS-APPLICATION-API.md).

## Contract checks and limits

Source tests: `runtime-store.test.ts`, `packages/mas/test/broker.test.ts`, `apps/server/test/workers.test.ts`. Installed consumer: `scripts/consumer-broker.mjs` via `npm run smoke:package`; it installs real agent/mas/server tarballs outside the workspace and reopens coordinator and actual workers after losing a native admission response.

Nested receipt decoding validates identity/status shape and relay request/source/target correlation. The codec checks relay-principal shape; the trusted delivery path constructs its exact namespace-bound value, and endpoint receipt/wait verifies that value. A structurally valid saved native receipt alone does not establish delivery. Restored results require original endpoint provenance checks. Retained coordinator outbox records still occupy `maxMessages` capacity for their lifetime. This is a separate broker ledger; the target same-Session Catalog uses independent retained records and a per-recipient pending bound. Worker isolation is the native Node process boundary; additional OS/container restrictions belong to the host deployment.
