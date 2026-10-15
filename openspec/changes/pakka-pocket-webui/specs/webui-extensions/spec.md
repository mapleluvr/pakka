## ADDED Requirements

### Requirement: Optional versioned trusted facets

An extension SHALL declare a stable identity, compatibility version and any subset of Agent, Backend, WebUI and Client facets. Addition by an authorized installer SHALL constitute code trust; the host SHALL NOT claim a hostile-plugin sandbox. Loading WebUI/Client exports SHALL NOT pull in backend code, Pi objects, secrets or provider initialization. Installation SHALL NOT implicitly enable Agent tools in every profile or grant all users administrative actions.

#### Scenario: UI-only and Agent-only contributions

- **WHEN** separate extensions contribute only a GUI or only Agent tools
- **THEN** each operates without fabricating the other facets, and importing its public declaration/browser entry starts no server, storage or inference

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

Custom backend RPC SHALL declare finite input/output/event schemas, extension/action/version identity, resource scope, required permissions, finite admission/execution policy and read/write behavior. The host SHALL bind current human authority and recheck it at controlled effect boundaries. Stateful changes SHALL use scoped persistence/conflict rules; long work SHALL return a job/receipt through a controlled task service rather than exposing raw Tx/Harness or relying on an unbounded HTTP handler.

#### Scenario: Late revocation and an effect before failure

- **WHEN** a role is revoked during awaited admission, or an opaque handler produces an effect and then fails
- **THEN** the former has no unauthorized controlled effect and the latter remains unknown; raw error text or a generic exception type does not prove no effect

### Requirement: Generation and exact asset lifecycle

Command, RPC, subscription and asset registrations SHALL bind the extension generation and actor/resource scope. New calls against disabled, replaced or unauthorized registrations SHALL fail closed. Failed preparation SHALL retain the prior known-good generation only when its registrations/bytes remain confirmed; partial unknown Agent/backend installation SHALL be marked unavailable until reconciled, not described as global rollback. Assets SHALL be restricted to accepted real-root bytes and safe types, excluding links/traversal/private files.

#### Scenario: Changed bytes under an old generation

- **WHEN** a module reload fails after its asset bytes changed, or a browser calls the old generation
- **THEN** the host refuses mismatched assets/new calls rather than serving changed bytes as the previously accepted generation

### Requirement: Stable retries without arbitrary replay

Mutating commands SHALL bind stable request identity, actor, resource, extension/action version and payload fingerprint to persistent operation records. Identical retries SHALL reconcile original receipts; conflicting payloads SHALL fail without another effect. Unknown/interrupted arbitrary handlers SHALL NOT be automatically re-entered. Closing UI, cancelling a wait or uninstalling a facet SHALL NOT prove rollback, refund consumed quota or delete business resources.

#### Scenario: Lost result after an accepted mutation

- **WHEN** a response is lost after a real controlled write or model admission
- **THEN** reconnect can inspect the original operation and retry does not fabricate a new identity or silently re-execute an unknown handler
