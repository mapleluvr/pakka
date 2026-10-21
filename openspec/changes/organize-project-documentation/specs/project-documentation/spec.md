## Purpose

Make Pakka's current expectations, complete OpenSpec change history, actual implementation gaps and retained verification evidence independently discoverable, while keeping superseded and temporary material cleanup reversible.

## ADDED Requirements

### Requirement: Separate expectation and implementation records

The project SHALL expose a short docs/OVERVIEW.md entry, domain-based current expectations and explicit mappings to detailed API/spec owners. Implementation progress and candidate results MUST remain distinct from those expectations.

#### Scenario: Resume without local scratch files

- **WHEN** a contributor resumes from the tracked repository without docs/.temp
- **THEN** OVERVIEW and the tracked implementation status identify the adopted requirements and remaining work without relying on old checkboxes or unavailable scratch files

### Requirement: Complete OpenSpec references from summaries

OpenSpec SHALL own complete changes through proposal, optional design, tasks, delta specs and archive/main-spec lifecycle. A docs/changes summary MUST reference the exact change directory, all present proposal/design/tasks files, every delta spec and relevant main specs; it MUST NOT become a parallel full change record.

#### Scenario: Follow a multi-change summary

- **WHEN** a reader follows a docs/changes summary covering multiple changes
- **THEN** each change and all of its spec artifacts are enumerated, including archived paths and resulting main specs where applicable

#### Scenario: Archive a summarized change

- **WHEN** an OpenSpec change is archived
- **THEN** its summary points to the archived change and resulting main specs, while current state and work links remain valid

### Requirement: Verified recoverable removal

Superseded or unrelated material SHALL be backed up to the operator-selected external location and verified before removal. The backup MUST identify original relative paths, bytes and digests or link targets, selection reasons and restore procedure. Unknown verification, changing files or locks MUST prevent removal of the affected source.

#### Scenario: Selected file is removed

- **WHEN** a file is selected for cleanup
- **THEN** its retained backup matches the source identity and the cleanup record can locate and restore it; retained documentation references are repaired

#### Scenario: Symlink or locked source

- **WHEN** cleanup encounters a reparse point, changed source or file lock
- **THEN** it does not traverse the link target or kill a host process, and unverified/unremovable sources remain explicitly reported

### Requirement: Preserve active contracts and truthful evidence

Cleanup MUST preserve active contracts, current product gaps and required fixed evidence. Validation SHALL separate document/link/schema checks from product acceptance and report inherited failures, missing environments and not-run gates honestly.

#### Scenario: Product acceptance was not rerun

- **WHEN** documentation cleanup finishes without new model/browser/installed-product execution
- **THEN** previous FAIL, BLOCKED, cancelled and skipped results retain their scope and are not promoted to PASS
