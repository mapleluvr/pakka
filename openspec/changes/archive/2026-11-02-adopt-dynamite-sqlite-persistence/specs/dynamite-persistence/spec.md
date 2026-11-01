## ADDED Requirements

### Requirement: SQLite-owned persistent storage

Pakka SHALL create business Session and Compresser storage using the public Pi SQLite Storage API. Storage identity SHALL bind the Session, backend, schema and file. The database SHALL use WAL and synchronous FULL. The owner SHALL acquire its writer claim before opening storage and release it only after closure is confirmed.

#### Scenario: New storage and reopen

- **WHEN** an authorized host creates a Session and commits work
- **THEN** the SQLite file SHALL contain the committed native records
- **AND** reopening the same identity SHALL recover those records without creating a replacement Session

#### Scenario: Format or identity mismatch

- **WHEN** an existing storage file or description does not match its declared backend and Session
- **THEN** opening SHALL fail before admitting work
- **AND** existing bytes and ownership uncertainty SHALL be preserved

#### Scenario: Closure is not confirmed

- **WHEN** database or Harness closure cannot be confirmed
- **THEN** the host SHALL retain the writer claim and failure reason

### Requirement: Persistent plans and attempts

Dynamite work SHALL persist its stable job/plan identity, fixed sources, configuration, attempt identities and checkpoint. Each externally dispatched attempt SHALL have a durable reservation and dispatch intent. A restarted process SHALL re-establish authorization before executing local continuation.

#### Scenario: Planned work resumes

- **WHEN** work has a committed plan and no uncertain external effect
- **THEN** the host SHALL validate its fixed sources and current authority before advancing its saved checkpoint

#### Scenario: Dispatched outcome is unknown

- **WHEN** an attempt has a dispatch intent and no confirmed outcome after interruption
- **THEN** recovery SHALL preserve the original attempt and reservation as quarantined pending reconciliation
- **AND** recovery SHALL NOT dispatch a replacement request merely because the process restarted

### Requirement: Atomic artifact adoption

Within one business storage domain, run/block, P1 text, the P2 graph with P3 annotations and P4 clues, exact adoption receipt and corresponding work checkpoint SHALL become visible through one confirmed commit. The receipt SHALL bind transactionId, attemptIds and artifactVersion.

#### Scenario: Concurrent windows commit

- **WHEN** independent source windows finish inference concurrently
- **THEN** each confirmed commit SHALL allocate a distinct block/run identity against the current artifact version
- **AND** commit serialization SHALL preserve inference concurrency

#### Scenario: Repeat confirmation

- **WHEN** a caller reconciles a transaction already committed
- **THEN** it SHALL receive the original artifact version and receipt rather than append a duplicate artifact

### Requirement: Cross-Session confirmation

The business Session and Compresser SHALL exchange stable job, attempt, submission and result identities. Each storage domain SHALL persist its own confirmation. Recovery SHALL distinguish stored results, definite failure and unknown effects.

#### Scenario: Result stored before business adoption

- **WHEN** the Compresser has stored a result and the business checkpoint has not adopted it
- **THEN** continuation SHALL read that fixed result and perform local validation/adoption under current authority

### Requirement: Conversation-local policy continuity

Each Compressor Conversation SHALL persist its own incidents, counters, lastError and seal. Reopen SHALL preserve these facts. Storage failure SHALL close the affected storage domain; source-local outcome uncertainty SHALL retain its source identity.

#### Scenario: One Conversation is sealed

- **WHEN** a Conversation reaches its configured error tolerance
- **THEN** its seal and lastError SHALL remain durable
- **AND** healthy work in another Conversation SHALL retain its independent policy state

### Requirement: Addressed persistent reads

History and artifacts SHALL be readable by stable identity, version and cursor. Runtime working state SHALL retain current projections and active work independently from stored historical records.

#### Scenario: Fixed artifact read after reopen

- **WHEN** a consumer requests a committed artifact identity and version after reopen
- **THEN** it SHALL receive that same bundle and its source relationships

### Requirement: Trusted writer maintenance

A trusted host maintenance command SHALL acquire an exclusive maintenance gate, verify the database identity using a read-only connection, and confirm the exact prior claim and process termination before releasing a residual writer claim. Ordinary opens SHALL continue to require writer exclusivity.

#### Scenario: Live or mismatched writer

- **WHEN** the expected writer is live, cannot be verified as terminated, or its claim differs
- **THEN** maintenance SHALL reject and preserve the existing claim

#### Scenario: Confirmed dead writer

- **WHEN** the expected writer has terminated and the claim and database identity match under the maintenance gate
- **THEN** maintenance SHALL release that exact claim and return a frozen receipt
- **AND** database and WAL bytes SHALL remain unchanged
- **AND** maintenance SHALL issue no model request

### Requirement: Persisted chain verification and incremental reads

Daily refresh SHALL use the last confirmed immutable entry identity and a cursor to read new history pages. A new Conversation or explicit reload SHALL reset that read cursor. Explicit reload SHALL revalidate persisted domain batches and source-work proofs through a consistent public Storage snapshot.

#### Scenario: History grows beyond a page

- **WHEN** history grows beyond one page and is subsequently reloaded or reopened
- **THEN** the current Conversation history SHALL preserve its complete ordered entry identities without duplicates

#### Scenario: Persisted domain chain is damaged

- **WHEN** stored domain records or their proofs are inconsistent during explicit reload
- **THEN** the host SHALL fail closed before admitting further work
- **AND** an old in-memory document snapshot SHALL NOT substitute for persisted verification
