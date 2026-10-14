## MODIFIED Requirements

### Requirement: Persistent cross-Session delivery

The broker SHALL commit outbox identity and payload before target admission, bind source and target incarnation, and reconcile the target's durable native submission receipt. Target deduplication and admission MUST share a commit boundary. Identical retry MUST reuse the native admission; payload/mode/identity conflicts MUST be rejected. Nested native receipts MUST be validated for complete identity/status shape and relay request/source/target correlation before publication, restore or reconciliation. Actual endpoint authority/provenance checks remain mandatory; structural validity alone MUST NOT assert delivery.

#### Scenario: Receipt lost after target admission

- **WHEN** target admission occurs but its response is lost and the coordinator restarts
- **THEN** retry reconciles the same request without duplicate admission or an extra HTTP dispatch.

#### Scenario: Unknown transport or retained identity expiry

- **WHEN** a response is lost, a deadline elapses, a worker exits or retained identity cannot be proved
- **THEN** outcome remains unknown or explicitly rejected, never inferred as non-delivery and silently retried under a fresh identity.

#### Scenario: Proven terminal result survives a late failure

- **WHEN** a native terminal result has been recorded and the worker later becomes unavailable or a concurrent wait/admission response fails
- **THEN** the confirmed terminal receipt is retained and returned instead of being downgraded to unknown.

#### Scenario: Malformed or foreign nested receipt

- **WHEN** restored or received native receipt fields are malformed or do not correlate with the retained relay envelope
- **THEN** the receipt is rejected before it can assert success, route/replay work or mutate the original native admission.
