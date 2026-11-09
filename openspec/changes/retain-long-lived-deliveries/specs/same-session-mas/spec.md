## ADDED Requirements

### Requirement: Long-lived retained delivery identity

A same-Session Catalog MUST retain original delivery identities and native submission references independently of a cumulative completed-delivery count. New admission MUST apply recipient pending, current authority, budget and payload protections without scanning completed delivery history. Retained-history storage and model-context projection SHALL have separate lifecycles.

#### Scenario: Work continues across former lifetime capacity

- **WHEN** more than 512 deliveries have completed across Conversations in one Catalog
- **THEN** another authorized delivery with available pending capacity and budget is admitted
- **AND** reopening the original Session preserves old receipt lookup and identical-request deduplication without another model request

#### Scenario: Bounded unfinished work

- **WHEN** a recipient has reached its queued/placed limit
- **THEN** a new request is refused until native status confirms capacity is available
- **AND** completed historical identities remain retained

#### Scenario: Legacy storage evolves atomically

- **WHEN** authorized mutation encounters a valid version-1 Catalog
- **THEN** records and the new index migrate in one native commit preserving identity, order, original submission and consumed budget
- **AND** a write failure or inconsistent provenance prevents new dispatch and exposes no partial migration

#### Scenario: Historical query preserves scope

- **WHEN** a host reads a page or resumes a retained cursor
- **THEN** it receives only records accepted by the current synchronous scope and a cursor from that scope
- **AND** a foreign-scope cursor is rejected and authorization is checked after awaited work
