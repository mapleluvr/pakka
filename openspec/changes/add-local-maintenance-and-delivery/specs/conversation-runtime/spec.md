# conversation-runtime maintenance delta

## ADDED Requirements

### Requirement: Trusted offline maintenance

The runtime SHALL expose a trusted, identity-bound offline storage port using public Durable Session APIs without constructing a Harness or registering execution definitions. It SHALL provide bounded inspection, approved coordinator CAS and consistent SQLite snapshots without exposing mutable Pi objects.

#### Scenario: Existing unfinished work remains unexecuted

- **WHEN** maintenance inspects and backs up an original Session containing a persisted unfinished task
- **THEN** task and submission identities and state SHALL remain unchanged and no model, tool, job handler or extension SHALL execute

#### Scenario: Conflicting storage ownership

- **WHEN** a live writer, foreign identity or unknown physical commit prevents maintenance
- **THEN** the operation SHALL refuse and retain uncertain ownership rather than replacing storage

### Requirement: Product maintenance fencing

Ordinary runtime opens SHALL respect product maintenance and restored-execution holds, including publication windows where a data root is temporarily absent. Writer recovery SHALL require an exact original claim and known exited process.

#### Scenario: Interrupted publication

- **WHEN** restore stops between parking the original directory and publishing its verified replacement
- **THEN** ordinary startup SHALL remain fenced and the original restore operation SHALL reconcile publication without creating a replacement Session
