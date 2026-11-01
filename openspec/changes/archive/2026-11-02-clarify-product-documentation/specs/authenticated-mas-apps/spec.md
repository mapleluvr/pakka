# authenticated-mas-apps

## MODIFIED Requirements

### Requirement: Executable operator and browser consumption

Actual server bootstrap and CLI SHALL consume the same controlled services and protocol as the shared client. Configuration MUST be explicit and trusted; remote requests SHALL select only approved profile/template references. Browser clients MUST compile and connect without host file access. Import MUST NOT start server/storage or read user credentials.

#### Scenario: Product path

- **WHEN** an isolated operator starts the configured server and uses CLI/browser clients to create, deliver, inspect, withdraw or abort supported work
- **THEN** real production MAS/native receipts and provider HTTP are observed through the protocol, not simulated service success

#### Scenario: Optional model contribution

- **WHEN** an operator starts an approved contribution configuration and sends input to that member
- **THEN** trusted bootstrap MAY enable approved DevPack profiles, with advertised model tools constrained by native invocation and capability-owner grant ceilings
- **AND** DevPack-enabled bootstrap MUST refuse spawn/configure/fork RPC grants before opening storage

#### Scenario: Native command configuration

- **WHEN** bootstrap omits DevPack
- **THEN** it SHALL expose the validated MAS command surface under its configured grants

### Requirement: Bounded initial deployment

The headless transport SHALL bind IPv4 loopback with explicit approved origins and finite body/concurrency limits. Configuration and credentials SHALL be supplied by trusted bootstrap. Remote requests SHALL select only approved references and SHALL preserve unknown outcomes after a possible effect. Explicit optional contributions SHALL follow their own fixed pairing and installation contract.

#### Scenario: Unapproved origin or capacity

- **WHEN** an unapproved browser origin or an over-capacity request reaches the server
- **THEN** it is rejected without bypassing gate policy or exposing sensitive host state
