## Purpose

Present real authorized Pakka Conversation and MAS workflows through the pinned Devin frontend structure and interaction language, without inheriting demo state, legacy layout stacks or weaker runtime semantics.

## ADDED Requirements

### Requirement: Pinned frontend is the structural base

The workbench SHALL adopt devin-ui-comparison@ed20cec0aef82daa22aa50da19597b7ba1607e02/clean-room/current structure and interaction as its base, not a reskin of the old Pakka UI. Reference CSS MUST retain its original LF bytes; product-only additions MUST NOT redefine shell, hero, navigation or menu geometry.

#### Scenario: Render the product shell

- **WHEN** the product renders the sidebar, home composer, Conversation, palette or settings
- **THEN** the pinned reference structure supplies those surfaces, production does not load the old pocket/workbench/devin layout override chain and source attribution remains inspectable

### Requirement: Real services and native behavior

Visible identity, resources and outcomes SHALL come from authorized Pakka services. Explicit Send alone submits native input; create only opens a real Conversation. Prompt, Steer, Follow up, human chat, incarnation, permissions and original-request reconciliation MUST preserve their owning contracts.

#### Scenario: Creation response is lost

- **WHEN** the original create response is unconfirmed
- **THEN** the UI reconciles that request rather than creating a replacement Conversation or automatically sending model input

#### Scenario: Use a moved control

- **WHEN** a user invokes a model/cwd, input, search, command or extension control through the adopted menu/page
- **THEN** the actual authorized service produces its real result or refusal without demo fixtures, authority expansion or serial replacement of native steering

### Requirement: Team uses one coherent interaction language

The optional MAS page SHALL use Team with Graph/Activity/Agents, a contextual desktop inspector or mobile bottom panel, and the same compact composer language. It MUST show only proven authorized relationships and preserve Conversation navigation, selection, view and personal layout without causing model work merely by viewing.

#### Scenario: Inspect a member and return

- **WHEN** a user selects a real member, opens its Conversation and returns
- **THEN** the same controlled resource is opened and Team restores the selection and view; navigation does not submit model input

#### Scenario: Retire is not hide

- **WHEN** a permitted user requests retirement instead of personal hiding
- **THEN** confirmation and server lifecycle checks govern the real operation; denied or unknown outcomes are not shown as successful hiding

### Requirement: Stylesheet readiness precedes Board interaction

Team SHALL retain the same stylesheet node through loading, success and error. No actionable Board SHALL mount before load. A stylesheet error MUST expose an accessible alert and remain fail closed, including after leaving and re-entering Team.

#### Scenario: CSS response remains pending

- **WHEN** the real board.css response is held pending
- **THEN** Graph/Activity/Agents and member controls are not exposed as actionable targets

#### Scenario: CSS response fails

- **WHEN** the stylesheet returns 503 or emits error
- **THEN** the same link identity is retained and an alert appears without exposing an unstyled actionable Board

### Requirement: Responsive accessible controls

The adopted UI SHALL remain usable at actual desktop/mobile viewports, including 360x600 and 390x650. Hints, directory confirmation and navigation MUST remain reachable; keyboard/focus/Escape/Back behavior and accessible SVG controls SHALL preserve the declared hit-area requirements.

#### Scenario: Drawer or modal transitions

- **WHEN** navigation closes an overlay or hands off to settings
- **THEN** obscured content is not treated as ready and cleanup of the previous overlay does not close the newly opened page

### Requirement: Distinct acceptance gates

Functional, visual, installed-consumer and required independent GUI/review results SHALL be retained separately. Full-frame differences and local automation MUST NOT be converted into a restoration percentage or substituted for the specified independent environment.

#### Scenario: A required environment is absent

- **WHEN** local checks pass but a specified independent gate cannot run
- **THEN** that gate remains BLOCKED and the candidate is not described as fully accepted
