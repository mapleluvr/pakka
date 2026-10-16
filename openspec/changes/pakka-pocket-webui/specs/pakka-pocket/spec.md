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

### Requirement: Approved project-file workflows

File and Git workflows SHALL be supplied through ordinary public extension slots and host-bound services. The host SHALL explicitly approve roots, resource visibility, write authority and optional managed worktree locations. Browser requests SHALL NOT introduce arbitrary roots, shell commands or native storage access. File views, human edits and Git operations SHALL NOT implicitly become model input.

#### Scenario: Read-only person opens real project files

- **WHEN** an authorized viewer opens approved text or image content and attempts a direct write RPC
- **THEN** the actual content is displayed or decoded, active uploaded markup is not executed, the service rejects the write independently of UI controls, and the underlying bytes remain unchanged

#### Scenario: Competing edit and original result

- **WHEN** another writer changes a file before the expected-content check or a completed request is repeated after normal reopen
- **THEN** the competing content is not overwritten by the failed check or by replaying the original completed request, the local draft is retained, and original request/result association remains inspectable

#### Scenario: Real bounded Git effects

- **WHEN** a permitted person requests changes, a branch operation or a managed worktree operation
- **THEN** the service executes only its declared Git operation with hooks disabled and disallowed local configuration refused, the real branch/worktree and disk result can be verified independently, and a busy native input prevents branch changes

### Requirement: Approval decisions bind actual pending native calls

Approvals SHALL be created only by a host-approved tool wrapper running inside a validated native invocation. A decision SHALL bind that invocation, the current Conversation incarnation, the host-selected tool and the exact checked arguments. Browser requests SHALL NOT create approval candidates or replace arguments, requester, scope or grants. Initial approval policy SHALL require the current person's resource management authority; a visible viewer list alone SHALL NOT grant decision authority.

#### Scenario: Allow and deny an actual tool effect

- **WHEN** an authorized person allows or denies a pending call produced by a real model tool invocation
- **THEN** the original native call either executes its approved effect once or returns a definite refusal without the effect, and the corresponding native tool result and external state can be inspected independently

#### Scenario: Late decision and uncertain recovery

- **WHEN** the native call ends, its resource incarnation changes, approval authority is revoked, or the product reopens with an unresolved approval
- **THEN** the stale decision cannot release an external effect, unknown execution remains unknown, and no stored decision causes automatic tool-effect replay

### Requirement: Owned browser views use controlled services

The browser contribution SHALL use an isolated host-owned browser profile and Conversation-bound pages through the same public extension slots as other contributions. The host SHALL explicitly approve the executable and navigation origins; browser requests SHALL NOT select an executable, expose a debugger endpoint, introduce arbitrary script evaluation or read another browser profile. Views SHALL report real page state and action results rather than substituting images for execution evidence.

#### Scenario: Real page interaction and safe display

- **WHEN** an authorized person opens an approved page, interacts with a real control and views its frame or artifact
- **THEN** the target application records the actual action, the displayed image decodes from the owned page, untrusted artifact markup cannot access the product origin, and no model call is introduced merely by viewing

#### Scenario: Resource and lifetime checks precede a browser effect

- **WHEN** a viewer attempts a write action, an old interface/generation submits an action, or navigation leaves approved origins
- **THEN** the server refuses the action or blocks the request before an unauthorized target effect, limits publication to current resource visibility, and does not automatically replay an unconfirmed input

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
