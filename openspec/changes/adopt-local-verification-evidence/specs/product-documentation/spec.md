## ADDED Requirements

### Requirement: Local-only verification evidence

Verification records SHALL contain only candidate, environment, scope, actual results, necessary limitations, and the filename, byte size and whole SHA-256 of a complete local evidence bundle. Raw evidence and bundles SHALL stay local, without Git commits or GitHub uploads. The operator SHALL handle cloud storage; product-installation and source-patch identities SHALL remain distinct.

#### Scenario: Preserve a completed verification run

- **WHEN** a selected verification run is ready to record
- **THEN** its actual outputs are preserved in a uniquely named local bundle and its final byte size and whole SHA-256 are checked
- **AND** Git receives only key results and the bundle identity, with actual failures or unavailable checks preserved as such
- **AND** raw logs/TAP, screenshots, verbose pack inventories, complete dependency trees and intermediate evidence remain in local custody
- **AND** the agent does not upload raw evidence or bundles to GitHub repositories, attachments, Releases or Actions artifacts

#### Scenario: Add evidence after computing its checksum

- **WHEN** further evidence changes the final bundle bytes
- **THEN** the changed bundle receives a new identity rather than overwriting an earlier result or reusing its checksum

### Requirement: Complete submission artifact review

Every commit and PR creation/update SHALL require complete artifact review, independently of runtime Verification selection. Review SHALL cover staged paths, the full actual PR-base diff including inherited commits, diff sizes, large-file contents and sensitive/redundant outputs. Force-add SHALL NOT bypass raw-evidence exclusion; required product artifacts SHALL follow their delivery contracts.

#### Scenario: Create or update a stacked PR

- **WHEN** a branch includes inherited commits and is proposed or updated against dev
- **THEN** the review covers the entire actual base range rather than only the newest commit
- **AND** raw evidence, local bundles and redundant generated inventories are identified before submission
- **AND** required product code, tests, licenses, vendor archives, source patches and reproducible locks are reviewed under their delivery contracts

#### Scenario: Submit a documentation-only change

- **WHEN** runtime tests are not selected for a document-only change
- **THEN** complete artifact review remains required before commit and PR creation or update
