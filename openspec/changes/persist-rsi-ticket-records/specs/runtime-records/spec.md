## ADDED Requirements

### Requirement: Atomic bounded namespace records

The host SHALL provide exact-key versioned records and independent cursor streams in the owning Session SQLite domain. A finite commit SHALL validate record versions and current authority, then atomically save writes, append items, activity markers and the original transaction receipt. Stored DTOs SHALL be detached from native mutable objects.

#### Scenario: Conflict or storage failure

- **WHEN** a read version conflicts or an actual SQLite commit fails
- **THEN** no subset of the proposed writes is published; known conflicts preserve healthy access and unknown persistence prevents further execution

#### Scenario: Original transaction response is lost

- **WHEN** a caller repeats the identical transaction request
- **THEN** the original confirmed receipt is returned without new stream items, and a changed fingerprint is rejected

### Requirement: History and active work have separate resource bounds

The host SHALL bound per-record bytes, transaction work, page bytes and active responsibilities. Accumulated historical records SHALL remain addressable independently of active work capacity. Unobserved document trackers SHALL be eligible for immediate release through public Pi settings.

#### Scenario: Long history is traversed

- **WHEN** a stream grows beyond earlier application limits
- **THEN** each read returns a finite page and continuation cursor; opening and appending do not materialize the complete archive

#### Scenario: Offline restore inspection

- **WHEN** maintenance inspects a stored active record
- **THEN** its exact checkpoint identity participates in the pending-work fingerprint, with no model or tool execution

### Requirement: Legacy migration freezes the source

An explicitly authorized migration SHALL atomically freeze the exact legacy namespace version and save its migration marker. Deterministic batches SHALL retain original identities and receipts; a completed layout SHALL publish only after all batches are confirmed.

#### Scenario: Migration interruption

- **WHEN** a batch is committed but its result is lost before publication
- **THEN** reopening the same migration resumes original batches without duplication, preserves source bytes, and leaves normal business access closed until publication
