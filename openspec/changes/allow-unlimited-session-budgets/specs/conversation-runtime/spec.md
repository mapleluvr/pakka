## MODIFIED Requirements

### Requirement: Explicit runtime bootstrap

The package SHALL provide a single-Conversation host and a trusted multi-Conversation runtime. Each newly created Session MUST use one Pi Durable SQLite storage domain and one writer, expose only frozen DTOs and bound commands, and accept only bootstrap-approved profiles and a per-Session policy with three non-negative safe integer limits (zero means no ceiling for that dimension). The runtime metadata and its exact resource identities SHALL determine how the owned storage is reopened.

#### Scenario: Concurrent Conversations share one persistence domain

- **WHEN** bootstrap creates two Conversations and submits distinct inputs concurrently
- **THEN** both are durably recorded in the same SQLite storage with different Conversation/provider identities and neither request contains the other context

#### Scenario: Unapproved creation fails before effects

- **WHEN** a requested profile is absent or the Session Conversation limit is exhausted
- **THEN** creation is rejected without a new Conversation, provider request or configuration fallback

#### Scenario: Open mode matches persisted runtime identity

- **WHEN** bootstrap reopens an owned Session through its matching host or runtime entry point
- **THEN** the same committed identities and spent budgets are restored, while a mismatched entry point is refused with the original records preserved

#### Scenario: Omitted startup policy

- **WHEN** a control or child Session starts without explicit limits
- **THEN** a new Session starts with three zeros, and reopening an existing Session retains its persisted limits, spending, bootstrap baseline and policy version

### Requirement: Conservative aggregate quotas

The runtime SHALL persist Session-wide primary and auxiliary attempt reservations before dispatch. Concurrent Conversations and reopen MUST NOT reset or overspend any positive ceiling; cancellation or unknown outcomes MUST NOT release an existing reservation.

#### Scenario: Competing primary attempts reach the Session cap

- **WHEN** multiple Conversations request attempts beyond the configured Session total
- **THEN** observed HTTP dispatches do not exceed the cap, refusals are explicit, and the reservation total survives reopen

#### Scenario: Unlimited Session admission with bounded work

- **WHEN** a Session ceiling is zero
- **THEN** that ceiling does not reject new Conversations, forks or inference attempts; applicable counters and independent authority, resource and strategy/job policy remain enforced

#### Scenario: Managed zero policy survives recovery

- **WHEN** an authorized operator saves one or more zero limits against the current version
- **THEN** the exact request and receipt retain the zero values, usage does not reset, and querying the original operation does not repeat the write
