## MODIFIED Requirements

### Requirement: Executable operator and browser consumption

Actual server bootstrap and CLI SHALL consume the same controlled services and protocol as the shared client. Configuration MUST be explicit and trusted; remote requests SHALL select only approved profile/template references. Browser clients MUST compile and connect without host file access. Import MUST NOT start server/storage or read user credentials. Trusted bootstrap MAY enable approved optional DevPack profiles; native invocation and capability-owner grant ceilings MUST constrain their model calls. Until RPC-owner-to-agent ceilings are supported, DevPack-enabled bootstrap MUST reject spawn/configure/fork RPC grants before opening storage. No-DevPack mode SHALL preserve the accepted M5 command surface.

#### Scenario: Product path

- **WHEN** an isolated operator starts the configured server and uses CLI/browser clients to create, deliver, inspect, withdraw or abort supported work
- **THEN** real production MAS/native receipts and provider HTTP are observed through the protocol, not simulated service success

#### Scenario: Optional model contribution

- **WHEN** an operator starts an approved contribution configuration and sends input to that member
- **THEN** actual advertised tools run through its native invocation and grants; unsupported profile-changing RPC combinations are refused without storage/model effects
