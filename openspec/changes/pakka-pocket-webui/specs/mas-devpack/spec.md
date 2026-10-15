## MODIFIED Requirements

### Requirement: Optional controlled extension contribution

The DevPack MUST contribute tools and instructions only to an explicitly approved Conversation profile. Import SHALL NOT start a server, open storage, read user credentials or create a Session. The model SHALL receive provider-safe `mas_*` tools for logical `mas.*` actions and frozen serializable results, never native objects or authority-bearing tokens. Optional Backend, WebUI and Client facets SHALL use separate public exports so Agent-only consumers need no Web runtime and Web-only use does not advertise model tools. Facet installation SHALL NOT grant additional business authority.

#### Scenario: Enabled and disabled profiles

- **WHEN** enabled and disabled Conversations request inference
- **THEN** only the enabled profile advertises current MAS tools and instructions; removal replaces current prompt sections and prevents execution of former tools
- **AND** Durable's historical positional system updates remain immutable transcript context, not active extension selection; removal does not physically delete old messages

#### Scenario: Independent Web and Agent installation

- **WHEN** an operator enables only the MAS WebUI facet or consumes only the existing Agent export
- **THEN** the former adds no model tools and the latter imports no WebUI/backend application startup code

## ADDED Requirements

### Requirement: Plugin-owned MAS workbench

MAS Board, member detail/controls, ownership/lifetime presentation, receipt inspection and related human commands SHALL belong to the DevPack's optional WebUI/Backend/Client facets. They SHALL use the same public navigation/page/panel/command/subscription interfaces as another trusted extension, not a reserved built-in identity or pi-pocket state. The generic WebUI shell SHALL NOT require MAS-specific stores, SubagentsDoc or PiP.

#### Scenario: Enable and remove MAS interface

- **WHEN** an operator adds and then disables the MAS WebUI facet
- **THEN** its navigation/pages/commands/subscriptions appear and disappear through the public lifecycle, while ordinary Conversation UI works and existing members, history and admitted jobs are not deleted

### Requirement: Human MAS views use current authority

The MAS WebUI SHALL display only server-filtered members and related receipts/events authorized to the current person. Viewing, sending, steering, management and complete transcript reading SHALL remain separate permissions. Human controls SHALL use current actor-bound service commands; Agent actions SHALL retain their actual native invocation. Native lifetime/status and unknown effects SHALL be presented without reinterpreting admission as successful work or pending abort as release.

#### Scenario: Scoped viewer and driving operator

- **WHEN** a viewer observes MAS Board while an authorized operator sends or retires a member
- **THEN** the viewer receives only allowed state and cannot cause the action; the operator receives the original native result and late revocation is checked at the controlled effect boundary
