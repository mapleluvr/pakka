## MODIFIED Requirements

### Requirement: Separate expectation and implementation records

The project SHALL expose adopted contracts through domain state and mapped API/spec owners. OVERVIEW and the owning OpenSpec tasks SHALL identify current work and gaps. Version-scoped candidate results and historical confirmations SHALL have explicit record identities.

#### Scenario: Resume without local scratch files

- **WHEN** a contributor resumes from the tracked repository without docs/.temp or the removed Pocket status aggregate
- **THEN** OVERVIEW, state and the owning OpenSpec tasks provide adopted requirements, current work and detailed open items, while candidate results remain version-scoped

### Requirement: Verified recoverable removal

Removed tracked material SHALL be recoverable from an identified immutable Git commit or verified backup. Unique untracked material needed for future work SHALL be retained or backed up with its identity before removal. Reference repair SHALL preserve append-only compatibility entries by adding an explicit replacement mapping.

#### Scenario: Remove a redundant tracked entry

- **WHEN** a selected tracked entry has an immutable published version and its useful content has an owner
- **THEN** the entry can leave the working tree, current readers reach that owner, and historical citations retain a recoverable version

## ADDED Requirements

### Requirement: Downstream patch as a product artifact

Current state SHALL describe the project-owned Pi Durable patch through its pinned baseline, source/build inputs, generation rejection and request-check behavior, installed artifact and validation entry points. Compatibility changes and their evidence SHALL remain in the append-only ledger.

#### Scenario: Inspect or rebuild the current patch

- **WHEN** a contributor follows the patch state page
- **THEN** they can identify its current behavior, exact baseline, source patch, dependency lock, artifact/hash metadata and build/regression commands without extracting the contract from historical ledger entries

### Requirement: Local visual output and stable test inputs

Generated visual runs SHALL be ignored and untracked. Tests SHALL consume their required stable inputs from tracked fixtures independently of local visual run output. References to retained historical output SHALL use an immutable published version.

#### Scenario: Run the reference test in a tracked-only checkout

- **WHEN** only tracked files are materialized and no visual run directory exists
- **THEN** the reference identity regression executes using its tracked fixture
