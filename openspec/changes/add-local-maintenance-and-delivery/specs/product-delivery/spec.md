# product-delivery maintenance delta

## ADDED Requirements

### Requirement: Complete private cold backup

A cold backup SHALL cover every registered or explicitly declared durable storage domain and managed file under exclusive offline ownership. It SHALL stream large content, record producer and domain identity plus file sizes and hashes, and publish only after verification. External dependencies SHALL be explicitly excluded rather than implied complete.

#### Scenario: Missing registered child

- **WHEN** a registered child database is absent or invalid
- **THEN** a complete backup SHALL not be published and original storage SHALL not be substituted

### Requirement: Original-location staged restore

Restore SHALL validate backup identity and bytes, preserve readable original bytes and record absence, validate isolated staging, journal publication, invalidate restored access and hold execution. A damaged source SHALL not be required to pass healthy-database validation before byte preservation.

#### Scenario: Damaged database with exited writer

- **WHEN** an original database is corrupt but its exact writer record names a confirmed exited process
- **THEN** restore SHALL preserve both original bytes and claim without clearing it, refuse any active or unconfirmable writer, and restore only the verified original-identity backup

### Requirement: Pinned upgrade and data-aware rollback

An upgrade SHALL accept trusted pinned local package archives, install them independently with installation scripts disabled, retain a pre-upgrade cold backup, and select the candidate only after offline compatibility checks. Rollback SHALL preserve current data and restore the original upgrade backup and release selection.

#### Scenario: Repeated original rollback

- **WHEN** a completed rollback is invoked again after subsequent work
- **THEN** it SHALL return the original operation outcome without replacing the subsequent work or reinstating an execution hold
