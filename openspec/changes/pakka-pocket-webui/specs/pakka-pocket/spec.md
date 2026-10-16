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

### Requirement: Scoped human model settings and usage

The workbench SHALL list only profile/model choices approved for the current person, and SHALL apply a selected profile through the existing resource management boundary. The next actual provider request SHALL use that approved model ID. Provider credentials, endpoint configuration and raw runtime state SHALL NOT be returned by the settings read. Conversation usage SHALL preserve unknown cost; Session-wide quota totals SHALL be visible only to an administrator with global resource scope.

#### Scenario: Real selection and scoped viewer

- **WHEN** an authorized person changes configuration through the workbench and a resource-scoped viewer opens the same settings
- **THEN** the next actual request uses the chosen model, the workbench uses the new incarnation, and the viewer cannot configure the resource or receive Session-wide totals
- **AND** an unknown response to a configuration mutation is not automatically retried; explicit workspace reload reads current state without repeating the mutation

### Requirement: Explicit private provider configuration

The product SHALL expose dedicated administrator-only replace/clear operations for its primary provider key. Reads, results, command palettes, browser persistence and user-visible errors SHALL NOT round-trip the saved value. The current bootstrap resolver SHALL remain the source until an explicit override; clearing SHALL remain cleared across normal reopen rather than falling back to that source. The owned credential store MAY persist the explicitly submitted value for future resolution; this SHALL NOT imply encryption or rollback of requests that already resolved a key.

#### Scenario: Replace and clear change real provider authentication

- **WHEN** a global administrator replaces or clears the key from the dedicated form
- **THEN** subsequent actual provider resolution uses the replacement or refuses dispatch after clear, only public configured/version metadata is returned, and normal reopen preserves the decision and spent attempt reservations
- **AND** a viewer, scoped administrator, late revoked request, malformed operation or uncertain commit cannot bypass the same server authority and stable request identity

#### Scenario: Delayed existing resolver and private errors

- **WHEN** an existing trusted bootstrap resolver finishes after an administrator has cleared it or throws an error containing private text
- **THEN** its stale key is rejected, private error text does not enter the model transcript or browser, and no new provider request is inferred from a status query

### Requirement: Native notifications preserve human resource authority

Notifications SHALL use actual browser service workers and Web Push subscriptions under explicit browser permission. The server SHALL bind devices and preferences to the authenticated person, approve push-service origins and recheck current resource authority before dispatch or publication. Encrypted wake-up payloads SHALL contain only an opaque event reference; the worker SHALL resolve current authorized metadata before displaying or navigating. A push-service acceptance response SHALL NOT be treated as proof that the operating system displayed a notification. Notification registration, viewing and navigation SHALL NOT invoke the model.

#### Scenario: A registered person receives a real resource update

- **WHEN** an authorized person enables notifications and a real controlled resource event occurs
- **THEN** the server submits a correctly encrypted and VAPID-signed push only to that person's approved device, the real worker can display a native notification and navigate to the reauthorized resource, and a resource-scoped viewer cannot receive another resource's private metadata

#### Scenario: Revocation, unsubscribe and uncertain push delivery

- **WHEN** a person is revoked, loses resource authority, changes accounts or unsubscribes, or a completed push response is lost
- **THEN** subsequent dispatch/publication is filtered by current authority and device state, stale wake-ups cannot disclose private content or grant actions, and retry/reopen with the original event identity does not repeat an unconfirmed push

#### Scenario: Lost device registration resolves by the current subscription

- **WHEN** the server commits a device registration but the browser loses its response
- **THEN** an explicit status read exposes only current-person/current-resource device identifiers and a SHA-256 digest of normalized `{ endpoint, keys: { p256dh, auth } }`, which the browser matches to its real subscription without repeating the registration or guessing a newly added device ID
- **AND** device endpoints, auth material and the VAPID private key are not returned, and a legal status for another exact resource is rejected

### Requirement: Scheduled inputs are native durable work

An optional automation contribution SHALL install a host-approved named job through the public Runtime job port and ordinary Backend/Client/WebUI facets. A schedule SHALL capture its originating person, exact Conversation reference, bounded input, due time and stable request identity. At delivery it SHALL recheck current person/resource and collaboration-driver authority, preserve native follow-up semantics and return the actual native delivery receipt. Closing a UI wait SHALL NOT cancel admitted work. Cancellation SHALL report the native terminal outcome without claiming rollback of an already delivered input. Native backend advance SHALL reject JSON-equivalent recovery data before publishing a new queued state. An unhandled program failure or unknown native input admission SHALL preserve an unknown job outcome rather than claim completed work or start another scheduled occurrence.

#### Scenario: Scheduled work survives a normal writer reopen

- **WHEN** an operator creates a future input, leaves its interface and normally reopens the product before the due time
- **THEN** only the committed checkpoint continues, no input is delivered early, one actual native admission produces the due provider request and the original schedule request resolves to the same job without resetting spent quota

#### Scenario: Revoked or interrupted work cannot be replayed

- **WHEN** the creator loses resource/driver authority, the schedule is cancelled, or a running handler has an unconfirmed delivery result
- **THEN** current checks prevent any not-yet-admitted input, the real job/receipt preserves its outcome, and reading or retrying the original request does not restart the handler or infer rollback

#### Scenario: A program cannot claim progress with equivalent checkpoint data

- **WHEN** an approved native program makes a real filesystem effect and then attempts an unhandled advance with unchanged JSON data, including reordered object keys or equivalent JSON zero
- **THEN** its public receipt becomes unknown without a scheduler progress fault, the original request and normal writer reopen do not repeat the effect, and unknown retained work does not release capacity

#### Scenario: An unknown admission stops the remaining schedule

- **WHEN** a real native input has taken effect but the received admission confirmation is unknown
- **THEN** both a one-shot and a recurring schedule remain unknown, no later occurrence is dispatched and reading or retrying the original schedule does not spend another attempt

### Requirement: One public UI extension path

Navigation, pages, sheets, panels, settings entries, command triggers and scoped subscriptions SHALL be exposed through documented versioned public slots sufficient for MAS Board and an unrelated custom extension. Custom Preact content SHALL use the host's component instance and lifecycle, not a private store/router import. Trusted code is not sandboxed, but ordinary contribution APIs SHALL NOT require monkey patches or hidden built-in identity.

#### Scenario: Independent extension uses the same slots

- **WHEN** MAS DevPack and a separately installed GUI-only extension register their interfaces
- **THEN** both use the same public registration mechanism and the GUI-only interface opens without an Agent tool, model or Conversation

### Requirement: Approved project memory

Memory SHALL be an optional contribution with separate Agent and Backend/Client/WebUI activation. The host SHALL define named projects and their Conversation resource membership; requests SHALL NOT introduce arbitrary directories, project membership or authors. Approved project lessons SHALL apply only to that project and approved global lessons MAY apply across the current product Session. A global administrator SHALL approve new lessons or proposed edits before another person's or model-created content can change future model context. Read-only viewers SHALL NOT write; non-administrators SHALL see only applicable approved lessons and their own pending proposals. Every mutation SHALL bind current authority, exact resource, stable request identity and expected lesson version. Unknown persistence SHALL NOT replay a mutation or falsely approve a proposal.

#### Scenario: Approval changes the actual next model context

- **WHEN** an operator or real native memory tool proposes a project lesson and a global administrator approves its current version
- **THEN** only the explicitly selected Agent profile includes the approved lesson in its next actual provider request, a different project's private lesson is absent, and human-only installation does not activate that Agent contribution

#### Scenario: Conflict, disable and reopen preserve their distinct meanings

- **WHEN** a stale edit is submitted, approved injection is disabled or the product normally reopens after a lost mutation response
- **THEN** a conflicting version does not overwrite the winner or lose a local draft, disabling injection preserves stored lessons while omitting them from future requests, and reading the original request resolves its saved mutation without applying it again or resetting quota

### Requirement: Explicit Conversation webhooks

The product MAY install a Webhook contribution for a host-approved Conversation. Its human-created hooks SHALL deliver as the current persisted creator, using the same Conversation, driver and native admission checks as other automated inputs. Only explicit human setup MAY create or rotate a hook; WebUI installation SHALL NOT create a model tool or hidden assistant. Normal lists, original-operation results, provider messages and process output SHALL exclude credentials; a separate authorized setup read MAY disclose the current hook URL/signing secret.

GitHub requests SHALL verify HMAC-SHA256 over exact body bytes and screen outsider-authored payloads by default, without discovering GitHub or Pi credentials. A host-approved writer list or explicit human override MAY expand that content policy. Generic hooks SHALL verify their endpoint secret. A fixed delivery/body identity SHALL be recorded before native input; retries, changed unsigned delivery headers, lost responses and normal reopen SHALL NOT re-enter an unknown admission. Rotation, removal, creator revocation or an invalidated extension SHALL block a not-yet-started input without claiming to roll back prior admission.

The contribution SHALL retain finite limits: 20 hooks per person, 60-character names, 2000-character instructions, at most 30 new accepted posts per hook/hour, 5 MiB incoming bytes, and a payload excerpt fitted within the native 8192-character input limit. Invalid signatures, oversized bodies, conflicting identities and unauthorized creators SHALL have no new provider effect. Repository-watch authority and PiP targets SHALL NOT migrate with this interface.

#### Scenario: Signed retry and rotation preserve exact effects

- **WHEN** a valid local signed post is delivered, retried under a changed delivery header, and followed by an explicit secret rotation
- **THEN** the original body produces only one native input, its receipt and consumed attempts persist after normal reopen, the old secret is refused, and a fresh valid event uses the current creator's exact scope

#### Scenario: Late revocation and lost admission result

- **WHEN** the creator or extension is invalidated while a committed incoming intent waits, or native admission occurs before its result becomes unknown
- **THEN** no not-yet-started unauthorized input is admitted; any earlier effect and charged attempt remain accounted for, and retry/reopen does not submit a replacement input

### Requirement: Host-approved context contributions

The Runtime MAY accept named, versioned context sources selected explicitly for approved profiles. A source SHALL receive only a frozen exact Conversation reference and cancellation signal, return bounded text or an explicit omission plus a live validity check, and never receive native Pi objects. The adapter SHALL recheck the exact incarnation and all source checks before actual provider dispatch. Source failures, malformed output or stale checks SHALL block that dispatch. Live checks SHALL complete synchronously with an undefined result; thenables and other returned values SHALL block the request, and opaque source errors SHALL be redacted from native output. Definition identity SHALL participate in persisted profile identity; adding a WebUI facet SHALL NOT activate any source. Current context contributions SHALL NOT rewrite raw history or become permanently replayed instructions after the source omits them.

#### Scenario: Current approved context affects only its selected profile

- **WHEN** an installed Agent contribution supplies current approved memory for one profile and a later read omits that memory
- **THEN** the actual provider payload contains the current text only for that profile, the next request after omission has no stale text, and raw Conversation history is unchanged by the source

#### Scenario: A delayed credential cannot outlive a context check

- **WHEN** context preparation completes but its captured state changes while provider credentials resolve
- **THEN** the live check blocks the actual request rather than sending stale or unauthorized context, and an already prepared attempt is not refunded

### Requirement: Actual product and browser acceptance

Acceptance SHALL exercise the installed product executable/assets and public SDK in an out-of-repository consumer with no workspace paths/root overrides. Tests SHALL use isolated desktop/mobile browsers, synthetic people/invitations, deterministic local providers and real persisted state. Required cases, source/asset identities, admitted inputs, provider/tool effects and unresolved outcomes SHALL be recorded separately from schema validation.

#### Scenario: Delivered archive is the test subject

- **WHEN** the final package is installed and driven from two authorized browsers and an unauthorized browser
- **THEN** real product behavior and privacy boundaries are verified against that exact archive; source-only tests or upstream self-reported counts do not clear delivery
