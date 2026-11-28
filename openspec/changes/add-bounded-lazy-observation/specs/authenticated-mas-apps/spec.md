# Authenticated Apps Delta

## ADDED Requirements

### Requirement: Previews and contents retain authenticated resource boundaries

The workbench SHALL authorize preview, version and range reads with the current person and exact Session/Conversation/source identity. It SHALL recheck authority after asynchronous reads, coalesce changes at a bounded cadence and keep no-change/backpressure/control work bounded.

#### Scenario: Revoked detail read

- **GIVEN** a previously visible large tool result
- **WHEN** read permission is revoked before a pending range is published
- **THEN** the response is refused and no new body bytes are delivered
- **AND** cached bytes are not treated as renewed authority

#### Scenario: Unchanged observation

- **GIVEN** an idle Conversation with completed large tools
- **WHEN** observation remains connected without changes
- **THEN** only small liveness/version messages are sent, not repeated completed tool bodies

#### Scenario: Slow observer with control action

- **GIVEN** slow or capacity-filled observation streams
- **WHEN** an authorized short stop/status control is submitted
- **THEN** bounded server stream admission does not consume the entire short-control budget
- **AND** unavailable browser connection-pool capacity is reported independently from server limits
