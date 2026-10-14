## Why

M1–M4 provide accepted controlled runtime/MAS/DevPack libraries and real private workers, but an operator or browser consumer still cannot use them through an authenticated, serializable product entry point. M5 must expose those same production gates through a finite protocol, not serialize in-process capabilities or create another scheduler.

## What Changes

- Add `@pakka/protocol` with browser-safe runtime validation of versioned commands, references, snapshots, errors and receipts; accept unknown input only after full schema/size validation.
- Add shared fetch-based `@pakka/client`, consumed by an executable operator CLI and a browser-target compilation/real HTTP consumer.
- Extend the server app with explicit trusted bootstrap and loopback HTTP transport, host-bound bearer identities/grants, revocation and controlled resource/message operations. Do not accept source/principal/credentials/runtime configuration from requests.
- Define reconnect as a fresh scoped snapshot plus persistent request/receipt reconciliation. Cancellation of a request/wait does not imply cancellation of an admitted message; explicit abort remains owner-controlled.
- Validate nested native broker receipt shape/provenance before restore/replay. Preserve unknown outcomes, one writer, quota and native steer/followUp boundaries.
- Retain private worker/DevPack behavior and declare unsupported TLS/public Internet hosting, arbitrary config, crash-claim recovery and GUI implementation. No Dynamite enablement.

## Capabilities

### New Capabilities

- `authenticated-mas-apps`: Versioned browser-safe protocol, server-bound remote authority, finite snapshot/reconnect and executable operator client/CLI.

### Modified Capabilities

- `recoverable-multi-session`: Full nested native receipt validation before accepted restoration or transport-facing reconciliation, without claiming that structural validity proves delivery.

## Impact

New protocol/client packages and CLI app have real server/CLI/browser consumers and executable acceptance paths in this stage. Server bootstrap consumes existing agent/MAS/DevPack ports; client/protocol do not import Pi, Node storage, server internals or model credentials. No installed dependency patching, no shared-storage multi-writer, no gate rename, no release/push authorization. New remote authority/persistence boundaries require real local HTTP/storage/CLI tests, isolated tarballs and the selected bounded adversarial review before acceptance.
