## ADDED Requirements

### Requirement: Single adopted product with traceable sources

Pakka-Pocket SHALL be delivered as one product package named `@pakka/webui`, with executable, Web assets and pure public extension SDK exports. Adopted code/assets SHALL retain source commit, license and modification provenance. The product SHALL NOT load pi-pocket's old SQLite/user/task data, introduce a second Durable cohort or silently upgrade Pakka's audited runtime.

#### Scenario: Clean product start

- **WHEN** an isolated user installs and starts the product using explicit test configuration and a fresh data directory
- **THEN** the UI uses the accepted Pakka runtime and preserved attribution, without reading old pi-pocket directories, provider sign-ins or another browser profile

### Requirement: Runtime-independent Web shell

The base workbench SHALL provide Conversation navigation, committed transcript/tool rendering, input and native steer/follow-up controls without requiring a MAS WebUI contribution. Pi-pocket subagent dispatch, SubagentsDoc/reporters/couriers and PiP privileged-assistant paths SHALL be absent from the production graph. The shell SHALL NOT hardcode MAS topology, member ownership or MAS Board state.

#### Scenario: MAS interface is not installed

- **WHEN** the product runs without the MAS DevPack WebUI facet
- **THEN** users can perform authorized ordinary Conversation work, but no MAS-specific board/navigation/commands are registered and no old subagent/PiP runtime is loaded

### Requirement: Adopted UI preserves usable workflows

The product SHALL migrate the selected pi-pocket Conversation, composer, timeline, files/changes, approval/browser and collaboration interfaces to controlled Pakka services. A source-to-target inventory SHALL identify each upstream surface, its new owner and executable acceptance; only the explicitly removed subagent/PiP authority is an automatic removal. Other exposed workflows SHALL NOT be left as decorative controls or silently dropped to obtain a passing subset.

#### Scenario: User follows an adopted control

- **WHEN** a user opens a migrated view or invokes one of its actions
- **THEN** the view reads the current authorized Pakka state and the action produces its real controlled result, conflict or honest unconfirmed outcome, not fixture-only state

### Requirement: One public UI extension path

Navigation, pages, sheets, panels, settings entries, command triggers and scoped subscriptions SHALL be exposed through documented versioned public slots sufficient for MAS Board and an unrelated custom extension. Custom Preact content SHALL use the host's component instance and lifecycle, not a private store/router import. Trusted code is not sandboxed, but ordinary contribution APIs SHALL NOT require monkey patches or hidden built-in identity.

#### Scenario: Independent extension uses the same slots

- **WHEN** MAS DevPack and a separately installed GUI-only extension register their interfaces
- **THEN** both use the same public registration mechanism and the GUI-only interface opens without an Agent tool, model or Conversation

### Requirement: Actual product and browser acceptance

Acceptance SHALL exercise the installed product executable/assets and public SDK in an out-of-repository consumer with no workspace paths/root overrides. Tests SHALL use isolated desktop/mobile browsers, synthetic people/invitations, deterministic local providers and real persisted state. Required cases, source/asset identities, admitted inputs, provider/tool effects and unresolved outcomes SHALL be recorded separately from schema validation.

#### Scenario: Delivered archive is the test subject

- **WHEN** the final package is installed and driven from two authorized browsers and an unauthorized browser
- **THEN** real product behavior and privacy boundaries are verified against that exact archive; source-only tests or upstream self-reported counts do not clear delivery
