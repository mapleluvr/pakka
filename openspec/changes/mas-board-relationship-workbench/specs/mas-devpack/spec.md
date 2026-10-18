## ADDED Requirements

### Requirement: Persistent relationship observations

The MAS catalog SHALL preserve proven creation source, fork source and delivery observations in the existing native transaction. Delivery observations include body, order, time, initiator and explicit reply association. Missing legacy fields SHALL remain unknown.

#### Scenario: Human reply and reopen

- **WHEN** a human replies through an Agent's incoming receipt and the Session reopens
- **THEN** the same delivery, human initiator and original reply association remain available
- **AND** inspection neither invokes the provider nor repeats admission

### Requirement: Authorized exchange projections

Board history SHALL require current read authority on both endpoints, independently of send authority. Filtering SHALL precede search, pagination and counts. Asynchronous reads SHALL recheck current authority before returning.

#### Scenario: Scoped reader

- **WHEN** a Viewer has access to only one endpoint of an exchange
- **THEN** that exchange, its count, body, cursor and hidden peer identity are omitted

### Requirement: Direct live activity

The Board SHALL separate member availability from actual runtime activity. It SHALL display bounded original thinking, tool arguments matched by callId, reply and actual error observations. A generation receipt SHALL NOT be presented as an application reply.

#### Scenario: Failed provider request

- **WHEN** a native Conversation retains a provider rejection
- **THEN** its card displays the recorded cause without retrying the input
- **AND** structured status codes are displayed only when supplied by the observation

### Requirement: Authorized Conversation resource navigation

The host SHALL support registered Conversation sources through the ordinary resource boundary. Board navigation SHALL retain current authorization, native input, independent model/cwd configuration and transcript reading.

#### Scenario: Open and return

- **WHEN** an authorized reader opens a Board member and returns
- **THEN** the full Conversation and prior Board selection are available without replaying work

### Requirement: Personal relationship presentation

The Board SHALL provide creation and communication layers, directional exchange counts, a member-list alternative, recoverable hidden links and personal layout controls. Hidden relationships SHALL NOT change message delivery or history. Mobile controls SHALL remain usable at a 3:5 viewport and the configured typography.

#### Scenario: Hidden exchange

- **WHEN** a person hides a communication link or an Agent's communication links
- **THEN** that personal view changes and the exchange remains available in the authorized log

### Requirement: Recover original member operations

An unconfirmed member command SHALL remain bound to its original request across panel close and reopen. Further effects SHALL stay locked until read-only original-operation lookup reaches a known result.

#### Scenario: Response lost after admission

- **WHEN** input is admitted and its transport response is lost
- **THEN** reopening and checking the original command reports that same operation with exactly one admission
