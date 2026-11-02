## MODIFIED Requirements

### Requirement: Explicit runtime bootstrap

The package SHALL provide a single-Conversation host and a trusted multi-Conversation runtime. Each new Session MUST use one Pi Durable SQLite storage domain and one writer, expose only frozen DTOs and bound commands, and accept only bootstrap-approved profiles and finite Session limits. Runtime metadata and exact resource identities SHALL determine the owned storage reopen mode. A bootstrap-approved Conversation profile MAY select a bounded model identifier on the Runtime's configured provider; an omitted identifier SHALL inherit the configured default. This selection SHALL NOT introduce another endpoint, credential source or provider from a browser request. Profile model choices SHALL participate in persisted bootstrap identity and use the existing authority, incarnation and aggregate-attempt gates.

#### Scenario: Concurrent Conversations share one persistence domain

- **WHEN** bootstrap creates two Conversations and submits distinct inputs concurrently
- **THEN** both are durably recorded in the same storage with different Conversation/provider identities and neither request contains the other's context

#### Scenario: Unapproved creation fails before effects

- **WHEN** a requested profile is absent or the Session Conversation limit is exhausted
- **THEN** creation is rejected without a new Conversation, provider request, or configuration fallback

#### Scenario: Open mode matches persisted runtime identity

- **WHEN** bootstrap reopens an owned Session through its matching host or runtime entry point
- **THEN** the same committed identities and spent budgets are restored, while a mismatched entry point is refused with the original records preserved

#### Scenario: Approved profile model affects the actual next request

- **WHEN** an authorized person selects a bootstrap-approved profile with another model identifier
- **THEN** the next actual provider request uses that exact identifier, the old incarnation remains invalid, and normal reopen retains the selection and spent attempt total without dispatching again
- **AND** a malformed model identifier is rejected before opening storage; a profile outside that person's ceiling cannot be selected and no credential is published in the Conversation read model
