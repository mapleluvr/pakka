## MODIFIED Requirements

### Requirement: Executable operator and browser consumption

Actual server bootstrap and CLI SHALL consume the same controlled services and protocol as the shared client. Configuration MUST be explicit and trusted; remote requests SHALL select only approved profile/template references. Browser clients MUST compile and connect without host file access. Import MUST NOT start server/storage or read user credentials. Trusted bootstrap MAY enable approved optional DevPack profiles; native invocation and capability-owner grant ceilings MUST constrain their model calls. Until RPC-owner-to-agent ceilings are supported, DevPack-enabled bootstrap MUST reject spawn/configure/fork RPC grants before opening storage. No-DevPack mode SHALL preserve the accepted M5 command surface. A new Pocket profile-management path SHALL NOT bypass this guard: it MUST establish its own tested authenticated-actor-to-Agent ceiling before enabling such actions, while preserving v1 behavior.

#### Scenario: Product path

- **WHEN** an isolated operator starts the configured server and uses CLI/browser clients to create, deliver, inspect, withdraw or abort supported work
- **THEN** real production MAS/native receipts and provider HTTP are observed through the protocol, not simulated service success

#### Scenario: Optional model contribution

- **WHEN** an operator starts an approved contribution configuration and sends input to that member
- **THEN** actual advertised tools run through its native invocation and grants; unsupported profile-changing RPC combinations are refused without storage/model effects

#### Scenario: Pocket actor boundary

- **WHEN** a Pocket interface requests a profile-changing action in a model-contribution configuration
- **THEN** the server proves the actor's approved ceiling at allocation/configuration and native invocation, or refuses the action; adding an interface never widens v1 authority

### Requirement: Bounded initial deployment

The existing v1 headless transport SHALL bind IPv4 loopback with explicit approved origins and finite body/concurrency limits. It MUST NOT advertise public Internet confidentiality, hostile-code sandbox, remote arbitrary configuration, complete crash recovery or deferred Dynamite support. An explicitly configured Pocket product entry SHALL support the separately specified authenticated multi-user remote deployment, without widening the existing listener/client defaults or serializing in-process capabilities. New protocol versions/actions SHALL be negotiated and runtime-validated; old consumers SHALL retain their accepted closed v1 schemas.

#### Scenario: Unapproved origin or capacity

- **WHEN** an unapproved browser origin or an over-capacity request reaches the server
- **THEN** it is rejected without bypassing gate policy or exposing sensitive host state

#### Scenario: Existing headless consumer

- **WHEN** the unchanged v1 server/client is used after Pocket support is added
- **THEN** it retains loopback, explicit credential/origin and finite-schema behavior; remote listening and arbitrary extension dispatch are not enabled implicitly

## ADDED Requirements

### Requirement: Controlled Pocket observation bridge

GUI observation SHALL use authorized frozen DTOs and identity-bound commands produced by the owning controlled adapter/services. Conversation history access SHALL have explicit human read permission rather than borrowing MAS send/discover or a strategy frame. Backend code SHALL NOT read native JSONL/SQLite to construct a second runtime or export raw Pi objects.

#### Scenario: Read view and cross-scope receipt

- **WHEN** an authenticated human opens a Conversation or a saved broker receipt
- **THEN** the server validates the current resource scope and receipt provenance before returning only approved display fields; malformed or foreign state fails closed without routing or provider effects

### Requirement: Broker receipt publication provenance

Stored broker receipt provenance SHALL be verified against the exact endpoint/namespace before publication if the new public path exposes those receipts.

#### Scenario: Broker receipt publication provenance

- **WHEN** A stored broker receipt is published
- **THEN** The exact endpoint and namespace are verified before publication; a foreign receipt causes no routing or provider effect.
