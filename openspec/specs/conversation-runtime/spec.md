# conversation-runtime Specification

## Purpose

Provide a controlled bootstrap and runtime boundary for multiple independent agent Conversations in one Durable Session, without confusing context identity, authority, persistence atomicity, or process isolation.

## Requirements

### Requirement: Explicit runtime bootstrap

The package SHALL provide a single-Conversation host and a trusted multi-Conversation runtime. Each newly created Session MUST use one Pi Durable SQLite storage domain and one writer, expose only frozen DTOs and bound commands, and accept only bootstrap-approved profiles and finite Session limits. The runtime metadata and its exact resource identities SHALL determine how the owned storage is reopened.

#### Scenario: Concurrent Conversations share one persistence domain

- **WHEN** bootstrap creates two Conversations and submits distinct inputs concurrently
- **THEN** both are durably recorded in the same SQLite storage with different Conversation/provider identities and neither request contains the other context

#### Scenario: Unapproved creation fails before effects

- **WHEN** a requested profile is absent or the Session Conversation limit is exhausted
- **THEN** creation is rejected without a new Conversation, provider request or configuration fallback

#### Scenario: Open mode matches persisted runtime identity

- **WHEN** bootstrap reopens an owned Session through its matching host or runtime entry point
- **THEN** the same committed identities and spent budgets are restored, while a mismatched entry point is refused with the original records preserved

### Requirement: Independent Conversation authority

The system MUST bind grants, owner leases, projection permits, jobs, artifacts, admissions, receipts and tool invocation scopes to the active Conversation and lifecycle identity. Equal principal or strategy names MUST NOT imply shared authority.

#### Scenario: Equal strategy IDs remain independent

- **WHEN** two Conversations use the same strategy ID and independently write artifacts and project context
- **THEN** physical journals and next provider payloads remain independent and a copied or foreign scope is rejected

#### Scenario: Lifecycle change does not revoke a peer

- **WHEN** one Conversation aborts, navigates, reloads or fails its own generation
- **THEN** its old capabilities and late results lose authority while its peer continues with unchanged valid capabilities

### Requirement: Declared persistence failure domain

A confirmed local Conversation failure SHALL affect that Conversation. Unknown storage, commit/adoption or unclassified extension failures MUST seal the entire owning Session; an abort request MUST NOT be treated as proof that effects rolled back.

#### Scenario: Session storage becomes unknown

- **WHEN** storage cannot provide an exact persistence receipt
- **THEN** every Conversation in that Session is denied further effects, while another independent Session can continue

### Requirement: Conservative aggregate quotas

The runtime SHALL persist finite Session-wide primary and auxiliary attempt reservations before dispatch. Concurrent Conversations and reopen MUST NOT reset or overspend these limits; cancellation or unknown outcomes MUST NOT release an existing reservation.

#### Scenario: Competing primary attempts reach the Session cap

- **WHEN** multiple Conversations request attempts beyond the configured Session total
- **THEN** observed HTTP dispatches do not exceed the cap, refusals are explicit, and the reservation total survives reopen

### Requirement: Stable recovery and changed authority

The runtime SHALL restore existing Conversation identities and state without starting provider work on inspection. Reopen MUST invalidate previous runtime capabilities; navigation that creates a fork MUST publish its changed Conversation identity rather than redirecting stale addresses implicitly.

#### Scenario: Reopen and inspect

- **WHEN** a runtime is closed and reopened with its approved profiles
- **THEN** committed contexts, metadata and Session quotas are restored, old bound commands are rejected and inspection adds no HTTP calls
