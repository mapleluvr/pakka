## ADDED Requirements

### Requirement: Composed live authority

A bound client SHALL support checking an existing action grant without performing the action and composing additional authority checks without dropping the original principal, source, revocation or invocation checks. Additional checks MUST be applied on every underlying effect boundary, including after awaited recipient admission and during controlled commit.

#### Scenario: Contribution revoked while admission waits

- **WHEN** a composed authority check becomes invalid while recipient admission is awaited
- **THEN** the native admission and target provider dispatch are refused

#### Scenario: Rebinding cannot restore revoked authority

- **WHEN** an old revoked client attempts to add a permissive check or bind another invocation
- **THEN** its original lease remains revoked and no action is authorized
