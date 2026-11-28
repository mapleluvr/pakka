## ADDED Requirements

### Requirement: Durable extension operation receipts independent of cumulative count

The extension host SHALL store each write operation independently and preserve its original identity, actor, target, fingerprint and done/unknown result. Settings and initialization metadata SHALL remain bounded separately. Read-only subscriptions SHALL not accumulate durable operation receipts.

#### Scenario: More than 512 confirmed writes

- **WHEN** a consumer issues more than 512 write operations through the authenticated extension boundary
- **THEN** later operations remain available and retrying the earliest original operation returns its stored result without re-entering the handler

#### Scenario: Legacy operation migration

- **WHEN** a legacy extension catalog is opened
- **THEN** original operation rows are copied idempotently before the small metadata layout is published, and pending or unknown handlers are not executed again
