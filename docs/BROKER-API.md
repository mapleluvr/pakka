# Multi-Session Broker and Workers

M3 accepted with bounded support limits; see [MIGRATION-M3-ACCEPTANCE.md](MIGRATION-M3-ACCEPTANCE.md). This is not a published release. This API extends, not replaces, [same-Session MAS](MAS-API.md). Dynamite remains deferred.

## Composition and authority

Trusted bootstrap creates a coordinator `Runtime`, obtains `runtime.store({ namespace, maxBytes })`, and calls `createBroker` from `@pakka/mas/broker` with approved `SessionPlacement` ports and finite `maxMembers`/`maxMessages`. Only frozen JSON snapshots, CAS commands and logical references cross these boundaries. Pi objects and native transactions remain in `durable-adapter.ts`.

`Broker.connect({ principal, source, grants })` returns a frozen client with `discover`, `send`, `reply`, `receipt` and `wait`. Grants are `discover|send|reply`; communication does not grant resource management or transcript access. `source` is an exact enrolled `BrokerAgentRef` or null for a trusted external actor. `revoke(principal)` revokes existing closures and signals pending transport admission; it does not prove withdrawal of already admitted work. A newly created client is a new explicit bootstrap authorization, not revived old authority.

A broker reference separates logical member key, approved placement, Pakka storage/provenance Session ID and native Conversation resource reference. A catalog's physical resource key is not necessarily its logical member key. The provider Session identity is separate from both.

## Enrollment

`bootstrap(plan)` first commits a fixed plan, then prepares each approved placement, records its exact Session/member references and enters `ready`. `activate()` activates and verifies each placement before committing broker `active`. Business input is refused before broker `active`; there is **no cross-Session atomic commit or rollback**. A partial or unconfirmed transition is `unknown` and must reconcile the original management slot, never allocate replacement members. Repeating bootstrap with a changed plan is a conflict.

`inProcessPlacement({ runtime, namespace, maxDeliveries, maxPending })` wraps an independently owned runtime using the existing MAS catalog. It is not process isolation. A failed initialization promise remains latched to that fixed runtime/configuration; explicit trusted reconstruction is required, rather than automatically retrying an unconfirmed initialization. `SessionEndpoint`/`SessionPlacement` are trusted transport ports and must not be given to model tools: they can prepare/activate and reach native receipt routing.

## Delivery and retention

`send(target, { requestId, text, mode? })` commits an outbox record before target admission. Mode is native `prompt|steer|followUp`; the broker does not replace steering with serial prompts. Outbox identity binds broker namespace, principal, source incarnation and stable request ID; the retained envelope additionally fingerprints source, target, mode and text. A conflicting retry is rejected.

The recipient's M2 ledger atomically records its fingerprint and original native submission ID. Lost responses are reconciled using that same identity. `wait(id)` may retry a locally owned unknown outbox record **only with a fresh check of its original send/reply grant and bound source**. Merely being able to inspect a receipt does not authorize dispatch. A sender or addressed receiver may await an already-admitted native submission without a send/reply grant; this observes the existing submission and does not re-admit work. A receiver may reply to an addressed receipt if the original source is known and its reply grant is current.

Receipts retain `pending|queued|placed|done|unanswered|unknown` and, when known, the native receipt. Confirmed `done`/`unanswered` outcomes are sticky: worker unavailability and late failed observations cannot downgrade them, including concurrent receipt updates. Provider/tool/filesystem effects are not covered by admission deduplication. Abort, timeout, disconnect or process exit never proves non-delivery. Capacity is finite, non-evicting, whole-lifetime retention: no TTL or unsafe expiration reset. External side effects are not exactly-once.

The current relay uses a trusted coordinator outbox and target native admission ledger, not a public network A2A protocol. It does not yet inject DevPack tools, serialize capabilities for browsers, or expose a remote worker-control RPC. Cross-Session revocation is checked before dispatch; it is not a distributed transaction with the recipient's independent commit line.

## Worker app

`apps/server` is the M3 executable worker/bootstrap app; its `@pakka/server` package is private, not a released server framework. `createWorkerManager` accepts fixed runtime/catalog presets, `maxWorkers`, `startupTimeoutMs` and `requestTimeoutMs`. Each runtime preset requires absolute approved cwd/dataDir and a lowercase `reservedSessionId` UUID, using the same grammar as the adapter and validated before deriving a storage path. Only string/profile configuration supported by the worker is accepted; arbitrary extension/tool functions are not transmitted over IPC.

`runtime.reservedSessionId` is a trusted create-once storage/provenance address. Existing storage is never overwritten: direct creation rejects an existing directory; explicit `reopenSessionFile` must match the reservation and provenance. The manager computes the exact reserved path before starting the process and uses explicit reopen for an existing complete storage. An incomplete initialization or unconfirmed writer ownership blocks startup, not a replacement allocation.

The manager exposes `placement(key)`, frozen `view()` (including PID/generation), `stop(key, { force? })` and `close()`. Every child uses actual Node fork IPC with sanitized environment, version/generation/request correlation, bounded finite JSON and an allowlisted command schema. Old endpoint closures fail after close/exit; normal close/reopen preserves native identity and reconstructs fresh command authority. A duplicate writer is refused by the adapter. Forced termination leaves an unknown/crash claim; neither PID reuse nor a timeout authorizes deleting it. There is no automatic stale-lock theft or process-crash recovery claim. A protocol-faulted slot immediately rejects further commands and replacement allocation, but its process is retained until explicit `stop()`/`close()` (initialization failures terminate immediately); sealing does not claim to have stopped previously admitted effects.

The worker has no HTTP listener, authentication endpoint or GUI/client protocol. Running `start:worker` without its manager's private IPC channel fails closed. Public server/CLI protocol remains M5.

## Evidence and limits

Source tests: `runtime-store.test.ts`, `packages/mas/test/broker.test.ts`, `apps/server/test/workers.test.ts`. Installed consumer: `scripts/consumer-broker.mjs` via `npm run smoke:package`; it installs real agent/mas/server tarballs outside the workspace and reopens coordinator and actual workers after losing a native admission response.

M3 completed clean install/check/build/format, 196/196 full tests, 20/20 focused tests, installed HTTP/storage consumers and two bounded passes of the operator-selected `adversarial-review.js` (OK with notes). Existing M1/M2 evidence remains historical. M3 nested receipt decoding originally relied on trusted producers; M5 adds nested identity/status shape checks and relay request/source/target correlation, with real malformed-storage regressions. The codec validates relay-principal shape, not the exact derivation involving the target MAS namespace. Trusted deliver constructs that principal internally; endpoint receipt/wait verifies its exact value. A structurally valid saved native receipt is not proof of delivery. Arbitrary/untrusted restore or public broker transport remains unsupported and requires full endpoint provenance re-verification before publishing saved native results. Stronger isolation (containers/users/sandbox/permissions), crash-claim resolution, dynamic business-selected sessions, outbox GC, public network protocol and Dynamite compatibility remain unsupported.
