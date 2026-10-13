# same-session-mas Specification

## Purpose

Provide same-Session multi-agent membership, independent communication and resource-control permissions, durable receipts and declared task lifetimes through controlled runtime ports.

## Requirements

### Requirement: Atomic membership and readiness

The service MUST commit new Conversations, approved configurations and membership records together. Rejected creation SHALL leave no members; uncertain persistence MUST remain unknown. A committed member SHALL receive business work only after real controlled-runtime readiness succeeds.

#### Scenario: Rejected bootstrap batch

- **WHEN** a member profile, ownership proof or creation quota is invalid
- **THEN** no partial member registration or provider dispatch occurs

#### Scenario: Committed bootstrap is not ready

- **WHEN** authority attachment or readiness fails after creation committed
- **THEN** the recoverable preparing/failed state is retained and business dispatch is refused

### Requirement: Independent communication and administration

The service MUST bind each client to a host-approved principal, source identity and revocable lease. Communication SHALL NOT grant full target transcript access or administrative actions; resource-control actions MUST follow owner/grant policy. Forged sources, stale references and late revoked calls MUST fail before target effects.

#### Scenario: Sender has no administrator grant

- **WHEN** an agent with discover/send permission communicates with a peer and requests its retirement
- **THEN** communication succeeds under recipient admission policy but retirement is refused without target effects

#### Scenario: Revocation during an awaited operation

- **WHEN** a principal or tool invocation is revoked before the effect commit
- **THEN** the operation is rejected with no unauthorized target write or HTTP request

### Requirement: Native durable delivery and receipts

A2A MUST retain native inbox steer/followUp placement and generation task execution. Identity, payload/mode conflict checks, bounded recipient admission and native submission creation MUST share a controlled persistence boundary. Admission, placement and generation outcomes SHALL remain distinguishable; timeout or requested abort MUST NOT prove withdrawal.

#### Scenario: Duplicate or conflicting message

- **WHEN** the same principal/source/request identity is retried with identical or changed payload/mode
- **THEN** identical messages reuse the durable native admission and changed messages are refused without additional effects

#### Scenario: Busy peer and placed abort

- **WHEN** steering and follow-up are sent to a busy peer and an already-placed message is aborted
- **THEN** original native placement boundaries remain, the committed input is retained and no receipt incorrectly claims release

### Requirement: Task lifetimes and retirement

Persistent, temporary, task-owned and background-owned resources MUST have distinct declared lifetimes. Native ownership edges SHALL be created from current proven task invocation, not arbitrary task strings. Retirement MUST stop admission and drain/abort before tombstoning, retaining transcript history. Background boundaries MUST preserve their native cancellation semantics.

#### Scenario: Task-owned subtree abort

- **WHEN** the owning task/Conversation is aborted while its child runs
- **THEN** the native ordinary subtree stops, new admission to the ended owner is refused and historical receipts remain inspectable

#### Scenario: Background boundary

- **WHEN** a parent Conversation stops without crossing background ownership
- **THEN** its background-anchored child continues and explicit retirement can subsequently drain it

### Requirement: Composed live authority

A bound client SHALL support checking an existing action grant without performing the action and composing additional authority checks without dropping the original principal, source, revocation or invocation checks. Additional checks MUST be applied on every underlying effect boundary, including after awaited recipient admission and during controlled commit.

#### Scenario: Contribution revoked while admission waits

- **WHEN** a composed authority check becomes invalid while recipient admission is awaited
- **THEN** the native admission and target provider dispatch are refused

#### Scenario: Rebinding cannot restore revoked authority

- **WHEN** an old revoked client attempts to add a permissive check or bind another invocation
- **THEN** its original lease remains revoked and no action is authorized
