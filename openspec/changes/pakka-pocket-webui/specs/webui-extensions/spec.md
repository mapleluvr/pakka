## ADDED Requirements

### Requirement: Optional versioned trusted facets

An extension SHALL declare a stable identity, compatibility version and any subset of Agent, Backend, WebUI and Client facets. Addition by an authorized installer SHALL constitute code trust; the host SHALL NOT claim a hostile-plugin sandbox. Loading WebUI/Client exports SHALL NOT pull in backend code, Pi objects, secrets or provider initialization. Installation SHALL NOT implicitly enable Agent tools in every profile or grant all users administrative actions.

#### Scenario: UI-only and Agent-only contributions

- **WHEN** separate extensions contribute only a GUI or only Agent tools
- **THEN** each operates without fabricating the other facets, and importing its public declaration/browser entry starts no server, storage or inference

#### Scenario: Explicit executable composition of approved native profiles

- **WHEN** the operator starts the actual executable with an explicitly selected absolute local ESM options module
- **THEN** the trusted root can compose public Agent contributions for approved profiles and current-human backend services, while the finite JSON startup path and its defaults remain available
- **AND** browser/RPC commands cannot select that module, credentials, a native owner or a stronger profile; importing the browser facet does not activate Agent tools

#### Scenario: Opaque host configuration failure

- **WHEN** the operator-owned ESM root has an external effect and then throws during startup
- **THEN** startup remains unconfirmed, output is redacted, no automatic module retry occurs, and the failed result is not represented as rollback

### Requirement: Human commands share explicit dispatch

Slash input, command suggestions and equivalent buttons SHALL dispatch the same namespaced command identity with checked arguments, current actor, declared scope and model-effect classification. Reserved names and collisions SHALL be rejected without silently replacing another command/template. Human commands SHALL NOT implicitly submit model input, invoke inference or change the current model requester.

#### Scenario: Display command and explicitly model-affecting command

- **WHEN** a user types or taps a status command and then chooses a separately declared send-work command
- **THEN** status produces no provider request or model-context entry, while send-work uses the actual controlled input path and exposes its original receipt

### Requirement: Private feedback and display-only cards

The command result contract SHALL distinguish private notices, authorized shared display cards, opened interfaces and accepted-operation receipts. Display-only cards SHALL remain visible after reconnect without contributing model messages, rewriting the active head or changing requester attribution. Shared output SHALL exclude private configuration and secrets.

#### Scenario: Card followed by inference

- **WHEN** an authorized command appends a shared display-only card and a later ordinary user input triggers inference
- **THEN** peers with access can read the card while the captured provider payload omits its display content and retains the correct requester

### Requirement: Custom content in host-owned surfaces

Trusted extensions SHALL be able to provide custom Preact sheets, panels and full subpages, settings and navigation entries through public slots, rather than only schema-generated forms. The host SHALL own route identity, focus/navigation, loading/error states and per-open instance lifetime. Cleanup SHALL remove owned subscriptions/listeners; late imports/results/callbacks SHALL NOT alter a replacement interface.

#### Scenario: Closed or replaced interface completes late

- **WHEN** a component is closed or replaced before its import or RPC completes
- **THEN** the late completion cannot close, notify or render into a newer instance; accepted backend work is not described as rolled back

### Requirement: Namespaced checked backend operations

Custom backend RPC SHALL declare finite input/output/event schemas, extension/action/version identity, resource scope, required permissions, finite admission/execution policy and read/write behavior. The host SHALL bind current human authority and recheck it at controlled effect boundaries.

#### Scenario: Late revocation and an effect before failure

- **WHEN** a role is revoked during awaited admission, or an opaque handler produces an effect and then fails
- **THEN** the former has no unauthorized controlled effect and the latter remains unknown; raw error text or a generic exception type does not prove no effect

### Requirement: Scoped persistence and durable backend work

Stateful changes SHALL use scoped persistence/conflict rules; long work SHALL return a job/receipt through a controlled task service rather than exposing raw Tx/Harness or relying on an unbounded HTTP handler.

#### Scenario: Scoped persistence and durable backend work

- **WHEN** A backend change conflicts or accepted work outlives an HTTP request
- **THEN** Scoped conflict handling preserves committed state and controlled jobs expose their original receipts without raw native transaction access.

### Requirement: Host-selected external ingress

A trusted backend service MAY declare a finite external ingress with a raw-body byte limit, execution deadline and closed response schema. The product SHALL expose it only under that installed extension's namespaced service route, require the existing host/proxy transport boundary, and bind a live check to the accepted backend generation, resource service and cancellation signal.

#### Scenario: Disabled generation blocks an awaited incoming effect

- **WHEN** an external request has entered an approved handler, but its extension is disabled before a new controlled effect starts
- **THEN** the captured check rejects that effect, later requests cannot enter the handler, and any unconfirmed earlier effect remains unknown without replay

#### Scenario: Oversized request is rejected before invocation

- **WHEN** an external sender exceeds the host-selected raw-body byte limit, changes the transport host/proxy boundary, or selects an undeclared service
- **THEN** the server refuses before invoking the handler and no target effect occurs

### Requirement: Closed ingress data and external authentication

The body, a finite header DTO and validated path segments SHALL be the only incoming request data. Native HTTP sockets, Cookie authority, module paths and arbitrary response headers SHALL NOT be supplied. External identity SHALL be verified by the service before any controlled effect; opening an endpoint SHALL NOT mint a human session.

#### Scenario: Closed ingress data and external authentication

- **WHEN** An external service request enters an installed handler
- **THEN** Only the bounded DTO is exposed, external identity precedes a controlled effect and no human session or arbitrary response authority is minted.

### Requirement: Generation and exact asset lifecycle

Command, RPC, subscription and asset registrations SHALL bind the extension generation and actor/resource scope. New calls against disabled, replaced or unauthorized registrations SHALL fail closed. Failed preparation SHALL retain the prior known-good generation only when its registrations/bytes remain confirmed; partial unknown Agent/backend installation SHALL be marked unavailable until reconciled, not described as global rollback.

#### Scenario: Changed bytes under an old generation

- **WHEN** a module reload fails after its asset bytes changed, or a browser calls the old generation
- **THEN** the host refuses mismatched assets/new calls rather than serving changed bytes as the previously accepted generation

#### Scenario: Interrupted or failed backend initialization survives reopen

- **WHEN** a trusted module initialization fails, or its writer closes after an external effect but before import completes
- **THEN** persisted loading/unknown state prevents automatic module re-entry on normal reopen; the registration remains unavailable until an authorized explicit reload reconciles it

### Requirement: Accepted asset bytes and safe real-root types

Assets SHALL be restricted to accepted real-root bytes and safe types, excluding links/traversal/private files.

#### Scenario: Accepted asset bytes and safe real-root types

- **WHEN** An extension requests an asset outside its accepted real root or through a link
- **THEN** The asset is refused instead of exposing private files or serving unaccepted bytes.

### Requirement: Stable retries without arbitrary replay

Mutating commands SHALL bind stable request identity, actor, resource, extension/action version and payload fingerprint to persistent operation records. Identical retries SHALL reconcile original receipts; conflicting payloads SHALL fail without another effect. Unknown/interrupted arbitrary handlers SHALL NOT be automatically re-entered. Closing UI, cancelling a wait or uninstalling a facet SHALL NOT prove rollback, refund consumed quota or delete business resources.

#### Scenario: Locate an original operation after its response is lost

- **WHEN** a human retained an external request ID but never received the host operation ID
- **THEN** a read-only lookup binds the current person, extension and exact original resource to the saved operation and rechecks its permission before publication
- **AND** closing/reopening the interface can inspect that operation without re-entering its handler; an absent or unknown record never implies rollback or authorizes replay

#### Scenario: Recorded handler retains an unknown native effect

- **WHEN** the extension handler has persisted a result but that result reports its native effect as unknown
- **THEN** querying the original operation does not promote the inner result to success, discard its pending identity or enable another effect as a recovery action

#### Scenario: Lost result after an accepted mutation

- **WHEN** a response is lost after a real controlled write or model admission
- **THEN** reconnect can inspect the original operation and retry does not fabricate a new identity or silently re-execute an unknown handler
