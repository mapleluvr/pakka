# recoverable-multi-session Specification

## Purpose

Provide recoverable MAS enrollment and delivery across independently owned Sessions, while exposing real process isolation and preserving authority, identity and honest unknown outcomes.

## Requirements

### Requirement: Durable bounded coordinator state

The trusted bootstrap SHALL persist coordinator JSON state with finite capacity and compare-and-set semantics on its owned Session. Callers SHALL receive frozen data and commands, never native transactions or runtime handles. Unknown persistence MUST seal the owning Session.

#### Scenario: Concurrent updates and reopen

- **WHEN** two updates use the same version and the Session is later closed and reopened
- **THEN** at most one update succeeds and its committed data/version remain, without provider dispatch.

#### Scenario: Invalid or unconfirmed write

- **WHEN** state is non-JSON, exceeds capacity, lacks current authority or cannot be confirmed
- **THEN** no successful update is reported; known rejection preserves prior state, whereas unknown persistence seals the Session.

### Requirement: Recoverable multi-Session activation

The broker SHALL retain each placement's plan and exact Session/member references before activation. New Session/storage creation MUST be performed only by trusted management. Business input MUST be refused until all required members are prepared and active; cross-Session initialization MUST NOT claim atomic rollback.

#### Scenario: Interruption after preparation

- **WHEN** preparation succeeds but recording readiness or activating the complete roster is interrupted
- **THEN** recovery reconciles the original placement identity instead of allocating replacement members and incomplete enrollment accepts no business input.

### Requirement: Persistent cross-Session delivery

The broker SHALL commit outbox identity and payload before target admission, bind source and target incarnation, and reconcile the target's durable native submission receipt. Target deduplication and admission MUST share a commit boundary. Identical retry MUST reuse the native admission; payload/mode/identity conflicts MUST be rejected. Nested native receipts MUST be validated for complete identity/status shape and relay request/source/target correlation before publication, restore or reconciliation. Actual endpoint authority/provenance checks remain mandatory; structural validity alone MUST NOT assert delivery.

#### Scenario: Receipt lost after target admission

- **WHEN** target admission occurs but its response is lost and the coordinator restarts
- **THEN** retry reconciles the same request without duplicate admission or an extra HTTP dispatch.

#### Scenario: Unknown transport or retained identity expiry

- **WHEN** a response is lost, a deadline elapses, a worker exits or retained identity cannot be proved
- **THEN** outcome remains unknown or explicitly rejected, never inferred as non-delivery and silently retried under a fresh identity.

#### Scenario: Proven terminal result survives a late failure

- **WHEN** a native terminal result has been recorded and the worker later becomes unavailable or a concurrent wait/admission response fails
- **THEN** the confirmed terminal receipt is retained and returned instead of being downgraded to unknown.

#### Scenario: Malformed or foreign nested receipt

- **WHEN** restored or received native receipt fields are malformed or do not correlate with the retained relay envelope
- **THEN** the receipt is rejected before it can assert success, route/replay work or mutate the original native admission.

### Requirement: Principal and resource boundaries

Broker clients SHALL bind current principal/source grants. Communication SHALL NOT imply management or transcript access. Revocation, inactive source/recipient and stale Session/Conversation incarnation MUST be checked again before effects. Restoring durable state SHALL NOT revive old authority.

#### Scenario: Revocation or replacement during routing

- **WHEN** authority changes or a resource is replaced while asynchronous routing is in progress
- **THEN** the old request is refused before unconfirmed new effects; no message is silently redirected to a replacement.

#### Scenario: Observe without replay authority

- **WHEN** an authorized sender or addressed receiver awaits a known native admission without a send/reply grant
- **THEN** only the existing admission is observed; attempting to replay an unknown outbox still requires its original action grant.

### Requirement: Real worker ownership and isolation

The worker manager SHALL own each storage writer and provide an actual executable process/IPC path with validated finite messages. Independent worker exit SHALL NOT stop other workers. Graceful close/reopen SHALL preserve identities and reconstruct current authority; unconfirmed writer ownership MUST block reopening.

#### Scenario: Worker exits and another continues

- **WHEN** a controlled worker exits while another independent worker receives work
- **THEN** the exited endpoint reports unavailable/unknown, its old client cannot issue effects, and the surviving worker completes through its local provider.

#### Scenario: Duplicate writer or crash claim

- **WHEN** a second process tries to open an owned storage or a surviving writer claim cannot be safely resolved
- **THEN** startup is refused; PID/timeout or a new Harness alone cannot justify stealing the claim.
