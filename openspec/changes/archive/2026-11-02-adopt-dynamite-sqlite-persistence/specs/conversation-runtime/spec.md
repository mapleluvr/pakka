# Conversation runtime persistence

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Explicit bounded legacy namespace migration

**Reason**: The adopted internal-development layout establishes new SQLite Sessions and their current namespace identities. The source-prefix mapping contract was designed for an earlier append-only layout.

**Migration**: Internal development uses the new SQLite layout. The historical mapping implementation and its scenarios remain addressable at the fixed source baseline; current bootstrap rejects its retired option before creating storage.
