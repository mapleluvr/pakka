## ADDED Requirements

### Requirement: Scripted collaboration guidance

The project SHALL provide human- and Agent-readable guidance for composing approved Runtime, MAS, DevPack and application tools into collaborative programs. Guidance SHALL connect a runnable example, Mermaid visualization, application completion conditions, persistence decisions and the public API references.

#### Scenario: An Agent prepares a collaborative program

- **WHEN** an Agent prepares a workflow using existing Pakka capabilities
- **THEN** the guidance directs it to express participants, messages, tool effects, artifacts, waits and completion conditions in a Mermaid diagram corresponding to the code and instructions
- **AND** the runnable example distinguishes generation completion or idleness from application completion

#### Scenario: Artifacts and state survive according to their use

- **WHEN** a workflow produces artifacts or requires persistent progress
- **THEN** the guidance directs its author to identify the retained content, identity or version, storage and confirmation boundary, reopen behavior and cleanup dependencies
- **AND** it distinguishes persisted data from current authority and separates the example's result inspection from checkpoint-based continuation

#### Scenario: Feasibility evidence progresses to an approved real-model trial

- **WHEN** an Agent evaluates workflow feasibility
- **THEN** the guidance orders ordinary tests before real-runtime local deterministic inference checks
- **AND** after these pass it directs the Agent to proactively request a small trial using an available cheap fast model and a simple matching task, specifying data, effects, success criteria, limits and cost basis
- **AND** the trial executes only under applicable explicit user approval with supplied credentials, separately from automatic repository regressions
- **AND** the findings retain the actual scope of each form of evidence
