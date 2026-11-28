## ADDED Requirements

### Requirement: Passive original-request lookup

A bound MAS client SHALL query its original request using target, request ID, exact text and mode. The Catalog SHALL derive its own stable delivery identity, validate the recorded principal/source/target/payload and recheck current authority before publishing a receipt. Lookup SHALL not run admission hooks, submit input or start generation.

#### Scenario: Existing and absent requests

- **WHEN** the authorized sender queries a matching original request
- **THEN** the original delivery is returned if present, otherwise null is returned without admission or model work

#### Scenario: Changed identity or revoked lease

- **WHEN** the target, source incarnation, payload or current authority differs from the original
- **THEN** lookup is rejected without publishing a foreign receipt or causing an effect
