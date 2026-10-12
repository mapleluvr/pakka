# conversation-runtime Specification

## Purpose
Provide a controlled bootstrap and runtime boundary for multiple independent agent Conversations in one Durable Session, without confusing context identity, authority, persistence atomicity, or process isolation.

## Requirements

### Requirement: Explicit runtime bootstrap

The package SHALL retain the legacy single-Conversation host and provide a separate trusted runtime bootstrap. The runtime MUST use one Harness and one storage writer, expose only frozen DTOs and bound commands, and accept only bootstrap-approved profiles and finite Session limits.

#### Scenario: Concurrent Conversations share one persistence domain

- **WHEN** bootstrap creates two Conversations and submits distinct inputs concurrently
- **THEN** both are durably recorded in the same storage with different Conversation/provider identities and neither request contains the other's context

#### Scenario: Unapproved creation fails before effects

- **WHEN** a requested profile is absent or the Session Conversation limit is exhausted
- **THEN** creation is rejected without a new Conversation, provider request, or configuration fallback

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

### Requirement: Explicit bounded legacy namespace migration

The runtime SHALL preserve legacy journal schema, source bytes, physical transaction/adoption identities and spent budgets. Migration MUST be explicitly requested for an exact closed Pakka Session/Conversation, only when a unique ownerless root and settled work are proven. The mapping and evidence receipt MUST commit with managed metadata; implicit adoption, fork-history guesses, unknown journal/intent/completion/adoption or budget reset MUST be refused.

#### Scenario: Migrate a proven legacy root

- **WHEN** approved bootstrap explicitly maps a closed single-Conversation legacy storage
- **THEN** the same Conversation/provider identity and original journal receipts survive, new members use independent namespaces, inspection sends no HTTP and aggregate/strategy limits include original reservations

#### Scenario: Legacy state is ambiguous

- **WHEN** a migration has foreign identity, fork history, pending work or unknown journal state
- **THEN** it is refused without source rewriting, new dispatch or speculative reset

### Requirement: Stable recovery and changed authority

The runtime SHALL restore existing Conversation identities and state without starting provider work on inspection. Reopen MUST invalidate previous runtime capabilities; navigation that creates a fork MUST publish its changed Conversation identity rather than redirecting stale addresses implicitly.

#### Scenario: Reopen and inspect

- **WHEN** a runtime is closed and reopened with its approved profiles
- **THEN** committed contexts, metadata and Session quotas are restored, old bound commands are rejected and inspection adds no HTTP calls
