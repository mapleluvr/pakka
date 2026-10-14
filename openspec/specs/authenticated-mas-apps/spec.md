# authenticated-mas-apps Specification

## Purpose

Expose controlled MAS operations to actual operator and browser clients through validated versioned messages and server-bound, revocable authority without exposing runtime internals.

## Requirements

### Requirement: Browser-safe closed protocol

Commands, responses, resource references, errors and receipts MUST use finite runtime-validated serializable schemas and explicit protocol version negotiation. Unknown versions, fields, malformed bodies or oversized data MUST be refused before operations. Protocol/client production graphs MUST NOT import Pi, Node storage, server implementation or model credentials.

#### Scenario: Invalid wire input

- **WHEN** a request supplies an unknown version, authority-bearing extra field or invalid target reference
- **THEN** the operation is refused before a target write/provider dispatch and no raw credentials or internal handles appear in the response

### Requirement: Host-bound remote authority

Every authenticated request SHALL use the server's current principal/source/grants and live issuer state, never caller-provided identity or serialized in-process capabilities. Authentication, approved origins and authorization SHALL fail closed. Revocation MUST block new requests and uncommitted late effects, including reconnects.

#### Scenario: Revocation during awaited admission

- **WHEN** an authenticated role is revoked while recipient admission is awaited
- **THEN** the pending target effect is denied by the existing commit-bound check and a fresh connection cannot restore the revoked role

#### Scenario: Cross-principal replay

- **WHEN** another authenticated identity reuses a receipt or request belonging to the original sender
- **THEN** authority is checked anew; copied fields do not confer ownership, source identity or receipt access

### Requirement: Scoped snapshots and honest reconnect

Connections SHALL obtain fresh scoped snapshots with server and Session identity. Catalog versions MUST NOT be called a global cross-Session revision. Reconnect SHALL reconcile retained message identity through persistent native admission, not automatically replay operations under new identity. Disconnect, timeout or wait cancellation MUST preserve unknown outcomes after possible effects.

#### Scenario: Lost response after admission

- **WHEN** an input was admitted and its HTTP response is lost
- **THEN** a fresh authenticated client reuses the original message request identity, observes the same native receipt and causes no extra provider dispatch

#### Scenario: Wait cancellation after placement

- **WHEN** a client stops waiting after input placement
- **THEN** the input remains admitted and quota is retained; explicit target abort/retirement remains a separate owner-authorized operation

### Requirement: Executable operator and browser consumption

Actual server bootstrap and CLI SHALL consume the same controlled services and protocol as the shared client. Configuration MUST be explicit and trusted; remote requests SHALL select only approved profile/template references. Browser clients MUST compile and connect without host file access. Import MUST NOT start server/storage or read user credentials. Trusted bootstrap MAY enable approved optional DevPack profiles; native invocation and capability-owner grant ceilings MUST constrain their model calls. Until RPC-owner-to-agent ceilings are supported, DevPack-enabled bootstrap MUST reject spawn/configure/fork RPC grants before opening storage. No-DevPack mode SHALL preserve the accepted M5 command surface.

#### Scenario: Product path

- **WHEN** an isolated operator starts the configured server and uses CLI/browser clients to create, deliver, inspect, withdraw or abort supported work
- **THEN** real production MAS/native receipts and provider HTTP are observed through the protocol, not simulated service success

#### Scenario: Optional model contribution

- **WHEN** an operator starts an approved contribution configuration and sends input to that member
- **THEN** actual advertised tools run through its native invocation and grants; unsupported profile-changing RPC combinations are refused without storage/model effects

### Requirement: Bounded initial deployment

The initial transport SHALL bind IPv4 loopback with explicit approved origins and finite body/concurrency limits. It MUST NOT advertise public Internet confidentiality, hostile-code sandbox, remote arbitrary configuration, complete crash recovery or deferred Dynamite support.

#### Scenario: Unapproved origin or capacity

- **WHEN** an unapproved browser origin or an over-capacity request reaches the server
- **THEN** it is rejected without bypassing gate policy or exposing sensitive host state
