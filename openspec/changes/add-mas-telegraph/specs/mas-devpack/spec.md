## ADDED Requirements

### Requirement: Explicit telegraphic prompt guidance

The DevPack SHALL offer independent host-controlled reasoning and inter-agent communication prompt options, both default off. Guidance MUST preserve needed analysis, verification, exact syntax, semantic anchors and unknown effects. It SHALL NOT demand private reasoning traces or claim enforcement, losslessness or measured savings. Human-facing artifacts SHALL remain readable for their final audience and obey requested formats.

#### Scenario: Independent profile selections survive composition

- **WHEN** a host selects reasoning, communication or both for an approved DevPack profile through public composition, Server preset or worker JSON
- **THEN** that profile receives exactly the selected guidance and common semantic/audience rules
- **AND** unrelated profiles receive no Telegraph guidance; malformed options or targets not selected for DevPack are refused

#### Scenario: Disabled or removed contribution

- **WHEN** options are omitted or disabled, or a member switches to an approved profile without this contribution
- **THEN** defaults remain unchanged or the current prompt/tool selection follows the new profile respectively
- **AND** native historical prompt updates remain context; tool authority, request text, delivery identity, admission, persistence and budgets are unchanged

### Requirement: Portable explicit Skill delivery

The MAS DevPack archive MUST ship a versioned `mas-telegraph/SKILL.md` reachable through a public package export. Its instructions SHALL be the source for selected prompt contributions and MUST declare explicit opt-in discovery/invocation semantics. Installation SHALL NOT change global Pi configuration or require Coding Agent for ordinary DevPack use.

#### Scenario: Installed public Skill loading

- **WHEN** a clean archive consumer resolves the public Skill export and explicitly supplies its path to a compatible loader
- **THEN** the versioned Skill is available with valid name/description and disabled automatic model invocation
- **AND** the installed DevPack can compose selected guidance from that same delivered source

### Requirement: Telegraph preserves MAS intent and final audience

Telegraphic communication SHALL convey useful new information, concrete requests, requested results, actionable blockers or corrections. Passive inform SHALL request no acknowledgment, and repeated pending projection SHALL NOT imply consumption or justify a new identity. A real root request receives one substantive response, without response chains or ceremonial loops. Novel findings from the same source and genuinely blocking new clarification requests remain allowed.

#### Scenario: Repeated inform and a human-facing draft

- **WHEN** a member sees an inform again while preparing a draft for a human through another agent
- **THEN** it does not create an acknowledgment loop or infer consumption
- **AND** it preserves readable human-facing draft text, while any enabled compact coordination retains exact identifiers, values/units, evidence, uncertainty, approvals and obligations
