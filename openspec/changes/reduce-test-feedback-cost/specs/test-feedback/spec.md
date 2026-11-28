## ADDED Requirements

### Requirement: Explicit test selection

The test runner SHALL default to a maintained core set, support explicit affected domains, remaining source release tests and exact file selection, and report selected and excluded paths. Invalid or conflicting selections SHALL fail before execution.

#### Scenario: Execute one regression

- **WHEN** the caller selects an existing exact file
- **THEN** no other source test is implicitly appended

#### Scenario: Shared boundary changes

- **WHEN** a shared protocol or Runtime scope is selected
- **THEN** all source consumers are included conservatively

### Requirement: Isolated observable feedback

Each run and file SHALL have distinct mutable profiles, temporary and artifact directories. Heavy files SHALL execute singly, independently from the bounded light pool. Outcomes SHALL include elapsed time, exit code or signal and resource measurement scope. Failed, blocked and cancelled work SHALL retain its actual status.

#### Scenario: Repeat a test

- **WHEN** the runner executes a second time
- **THEN** it preserves the first run evidence and uses new mutable directories

### Requirement: Retained fault detection

Test consolidation SHALL preserve assertions for distinct failure modes at an appropriate real boundary. Maintenance recovery SHALL retain records-only fingerprint rejection and real process death coverage.

#### Scenario: Omitted records-only hold

- **WHEN** a negative control removes pending-record work from resume gating
- **THEN** the retained records-only regression fails
