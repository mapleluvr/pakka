## MODIFIED Requirements

### Requirement: Executable operator and browser consumption

Actual server bootstrap and CLI SHALL consume the same controlled services and protocol as the shared client. Configuration MUST be explicit and trusted; remote requests SHALL select only approved profile/template references. Browser clients MUST compile and connect without host file access. Import MUST NOT start server/storage or read user credentials. The v1 headless and WebUI entry points SHALL enforce their respective actor-to-Agent grant ceilings at profile allocation, configuration and native invocation.

#### Scenario: Product path

- **WHEN** an isolated operator starts the configured server and uses CLI/browser clients to create, deliver, inspect, withdraw or abort supported work
- **THEN** real production MAS/native receipts and provider HTTP are observed through the protocol, not simulated service success

#### Scenario: Optional model contribution

- **WHEN** an operator starts an approved contribution configuration and sends input to that member
- **THEN** trusted bootstrap MAY enable approved DevPack profiles, with advertised model tools constrained by native invocation and capability-owner grant ceilings
- **AND** DevPack-enabled headless bootstrap MUST refuse spawn/configure/fork RPC grants before opening storage

#### Scenario: Native command configuration

- **WHEN** bootstrap omits DevPack
- **THEN** it SHALL expose the validated MAS command surface under its configured grants

#### Scenario: WebUI actor boundary

- **WHEN** a WebUI interface requests a profile-changing action in a model-contribution configuration
- **THEN** the server proves the actor's approved ceiling at allocation/configuration and native invocation, or refuses the action; adding an interface never widens v1 authority

### Requirement: Bounded initial deployment

The v1 headless transport SHALL bind IPv4 loopback with explicit approved origins, finite limits and trusted configuration. Explicit optional contributions SHALL use their fixed pairing and installation contract. An explicitly configured WebUI entry SHALL support its authenticated multi-user deployment with separately negotiated, runtime-validated actions. Each entry SHALL retain its own closed schemas and transport defaults; serialized in-process capabilities SHALL confer no authority.

#### Scenario: Unapproved origin or capacity

- **WHEN** an unapproved browser origin or an over-capacity request reaches the server
- **THEN** it is rejected without bypassing gate policy or exposing sensitive host state

#### Scenario: Existing headless consumer

- **WHEN** bootstrap selects the v1 headless server and client
- **THEN** it retains loopback, explicit credential/origin and finite-schema behavior; remote listening and arbitrary extension dispatch are not enabled implicitly

## ADDED Requirements

### Requirement: Controlled WebUI observation bridge

GUI observation SHALL use authorized frozen DTOs and identity-bound commands produced by the owning controlled adapter/services. Conversation history access SHALL have explicit human read permission rather than borrowing MAS send/discover or a strategy frame. Backend code SHALL NOT read native JSONL/SQLite to construct a second runtime or export raw Pi objects.

#### Scenario: Read view and cross-scope receipt

- **WHEN** an authenticated human opens a Conversation or a saved broker receipt
- **THEN** the server validates the current resource scope and receipt provenance before returning only approved display fields; malformed or foreign state fails closed without routing or provider effects

### Requirement: Broker receipt publication provenance

Stored broker receipt provenance SHALL be verified against the exact endpoint/namespace before publication if a public path exposes those receipts.

#### Scenario: Broker receipt publication provenance

- **WHEN** A stored broker receipt is published
- **THEN** The exact endpoint and namespace are verified before publication; a foreign receipt causes no routing or provider effect.
