## ADDED Requirements

### Requirement: Paged long-lived ticket records

The service SHALL persist heads, content revisions, events, run checkpoints and actor request receipts independently through the host records port. The default service SHALL not reject work based on cumulative ticket, revision, event, run or receipt counts. Detail SHALL expose current content and explicit bounded history windows with cursors; UI and Bot consumers SHALL use the same semantics.

#### Scenario: Large ticket and old request

- **WHEN** content history grows beyond 128 revisions and requests exceed 4096
- **THEN** new writes remain available, history is completely traversable by bounded pages and the oldest original request remains queryable after reopen

#### Scenario: Filtering exhausts the scan budget

- **WHEN** the bounded index scan finds no currently authorized match but older candidates exist
- **THEN** the result includes a continuation cursor rather than falsely reporting the archive ended

### Requirement: Fixed dispatch checkpoint and explicit recovery

The service SHALL persist a fixed route, content revision, payload hash and dispatch request identity before execution. It SHALL confirm the planned-to-dispatching transition before calling MAS. Normal service construction and queries SHALL remain passive. Current manager authority SHALL be required to continue a planned run. Uncertain sends SHALL be queried by their original request and SHALL not be replayed from a missing receipt alone.

#### Scenario: Process stops before send checkpoint

- **WHEN** a planned run survives a real Session reopen
- **THEN** ordinary reads preserve it without sending, and an explicit authorized recovery can continue the fixed plan once

#### Scenario: MAS accepted but response was lost

- **WHEN** the run has no retained receipt but its original delivery exists
- **THEN** pure lookup recovers that delivery and local checkpoint without a second admission or generation

#### Scenario: Query finds no accepted delivery

- **WHEN** a run entered dispatching and the original delivery is absent
- **THEN** admission-hook effects remain unknown and the run stays blocked for reconciliation

### Requirement: Scoped observation and result references

Confirmed ticket mutations SHALL advance authority-scoped change markers atomically. Observation SHALL read only a small marker until it changes. Result references MAY associate versioned artifact identities with a ticket event and one of that ticket's runs, separately from content and generation status.

#### Scenario: Another author writes

- **WHEN** a different author creates protected tickets
- **THEN** the caller's author-scoped observation token and content remain unaffected

#### Scenario: Foreign run reference

- **WHEN** a report names a run from a different ticket
- **THEN** the service rejects the association without changing ticket state

### Requirement: Explicit compatible migration

Legacy schema 1 migration SHALL require host opt-in after cold backup and paused consumers. It SHALL preserve the source, original IDs, receipts, revisions and routes, and SHALL map receiptless legacy runs to an uncertain phase.

#### Scenario: Normal open encounters legacy data

- **WHEN** the host has not selected migration
- **THEN** opening reports the required migration without publishing a replacement layout
