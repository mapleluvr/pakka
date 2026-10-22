## Purpose

Present authorized Pakka Conversation and MAS workflows through the pinned Devin frontend structure and interaction language, using real service state and the controlled runtime contracts.

## ADDED Requirements

### Requirement: Pinned frontend is the structural base

The workbench SHALL use devin-ui-comparison@ed20cec0aef82daa22aa50da19597b7ba1607e02/clean-room/current as its structural and interaction base. Reference CSS MUST retain its original UTF-8 LF Git blob bytes. The pinned reference SHALL determine shell, hero, navigation and menu geometry; product additions SHALL style product-specific content separately.

#### Scenario: Render the product shell

- **WHEN** the product renders the sidebar, home composer, Conversation, palette or settings
- **THEN** the pinned reference supplies their structure and geometry, product-specific content uses separate additions, and the production layout styles and source attribution identify that reference and those additions

### Requirement: Real services and native behavior

Visible identity, resources and outcomes SHALL come from authorized Pakka services. Explicit Send alone submits native input; create only opens a real Conversation. Prompt, Steer, Follow up, human chat, incarnation, permissions and original-request reconciliation MUST preserve their owning contracts.

#### Scenario: Creation response is lost

- **WHEN** the original create response is unconfirmed
- **THEN** the UI retains the original create identity and remains in read-only reconciliation until its outcome is confirmed; model submission requires a separate explicit Send

#### Scenario: Use an authorized control

- **WHEN** a user invokes a model/cwd, input, search, command or extension control through its menu/page
- **THEN** the authorized service returns its real result or refusal under the current role and resource scope, using the owning native scheduling and original-request contracts

### Requirement: Team uses one coherent interaction language

The optional MAS page SHALL use Team with Graph/Activity/Agents, a contextual desktop inspector or mobile bottom panel, and the same compact composer language. Relationships MUST come from authorized records; reply edges MUST use explicit reply associations. Team SHALL preserve Conversation navigation, selection, view and personal layout; viewing and filtering SHALL operate on presentation and authorized reads.

#### Scenario: Inspect a member and return

- **WHEN** a user selects a real member, opens its Conversation and returns
- **THEN** the same controlled resource is opened and Team restores the selection and view; navigation uses authorized reads and model input requires an explicit sending action

#### Scenario: Apply member retirement

- **WHEN** a permitted user requests retirement
- **THEN** confirmation and current server authority govern the member lifecycle operation; denied and unknown retain their distinct refusal or reconciliation states, while personal hiding changes presentation only

### Requirement: Stylesheet readiness precedes Board interaction

Team SHALL retain the same stylesheet node through loading, success and error. Successful stylesheet load MUST be a prerequisite for mounting any actionable Board. A stylesheet error MUST expose an accessible alert and remain fail closed, including after leaving and re-entering Team.

#### Scenario: CSS response remains pending

- **WHEN** the real board.css response is held pending
- **THEN** Team remains in its stylesheet-loading state, with actionable Graph/Activity/Agents and member controls gated on successful load

#### Scenario: CSS response fails

- **WHEN** the stylesheet returns 503 or emits error
- **THEN** the same link identity is retained, an accessible alert appears and the actionable Board remains unmounted

### Requirement: Responsive accessible controls

The UI SHALL use the complete actual viewport for responsive layout and remain usable on desktop and mobile, including 360x600, 390x650 and 390x844. Hints, directory confirmation and navigation MUST remain reachable; keyboard/focus/Escape/Back behavior and accessible SVG controls SHALL preserve the declared hit-area requirements.

#### Scenario: Drawer or modal transitions

- **WHEN** navigation closes an overlay or hands off to settings
- **THEN** readiness requires the target to be visible and actionable, and closing or cleanup acts only on its owning overlay instance while the destination page remains open

### Requirement: Distinct acceptance gates

Functional, visual, installed-consumer and required independent GUI/review results SHALL each have evidence for their own conditions and candidate identity. Visual evidence SHALL retain direct inspection and full-frame differences as observations. Independent acceptance MUST use the specified environment and workflow; full acceptance requires every mandatory gate to satisfy its conditions.

#### Scenario: A required environment is absent

- **WHEN** local checks pass but a specified independent gate cannot run
- **THEN** that gate remains BLOCKED and the candidate retains incomplete acceptance status
