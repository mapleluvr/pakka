## ADDED Requirements

### Requirement: Reachable contribution workflow

Pakka SHALL provide a tracked contribution entry and a maintained Git workflow. README, AGENTS and OpenSpec context SHALL refer to the adopted workflow. The workflow SHALL require current-branch inspection before commits, branch operations and PR management; daily contributions SHALL use independent branches and target dev through PRs. Work PRs SHALL explain Intent, Mechanism and Verification.

#### Scenario: Start a daily contribution

- **WHEN** a contributor starts from dev, main or a checkout without an independent work branch
- **THEN** they fetch successfully and create a work branch from origin/dev, using the documented initialization path when remote dev is absent
- **AND** direct commit/push to main is prohibited

#### Scenario: Finish work on an existing branch

- **WHEN** a stage completes on an independent branch
- **THEN** the contributor commits and pushes that branch, checks for an existing open PR to dev, and creates or updates that PR
- **AND** remote SHA verification records the actual published commit

### Requirement: Explicit integration and release conditions

Direct dev commits and pushes SHALL require an explicit instruction to process multiple PRs into dev. Before pushing, local checks on the integrated dev candidate SHALL confirm no compilation errors and passing core tests. Creating a dev-to-main release PR SHALL require an explicit release-PR instruction, a clean conflict-free checkout aligned with origin/dev, and availability verification for that candidate.

#### Scenario: Integrate multiple PRs

- **WHEN** the operator authorizes batch integration into dev
- **THEN** the integrator synchronizes dev, merges the authorized branches and resolves conflicts locally
- **AND** the local candidate passes the applicable test, build or static checks before push
- **AND** only PRs confirmed in the remote result are closed or recorded as integrated

#### Scenario: Prepare a release PR

- **WHEN** the operator requests a PR to main
- **THEN** the release description summarizes the stage and every included PR with its link, number and a semantic one-line description
- **AND** actual non-PR initialization commits are identified separately

### Requirement: Focused work entry and aligned metadata

OVERVIEW SHALL contain the product position, current work and reachable remaining tasks. State SHALL describe adopted expectations; OpenSpec changes SHALL retain their formation and work records. Fixed candidate results SHALL remain in verification records. Project metadata and README SHALL identify the adopted product and contribution entry points.

#### Scenario: Resume without local scratch materials

- **WHEN** docs/.temp is unavailable
- **THEN** a contributor can locate effective contracts, the Git workflow and remaining work from README, OVERVIEW, state mappings and tracked OpenSpec tasks
- **AND** completed historical results remain accessible through changes and verification indexes
