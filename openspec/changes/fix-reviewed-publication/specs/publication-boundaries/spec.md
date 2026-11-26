## ADDED Requirements

### Requirement: Published object authority

Each service MUST authorize its actual published object after its final asynchronous step. Saved Book content and reference metadata MUST use Book authority rather than automatically inherit cited-target permission or availability.

#### Scenario: Withdrawn citation does not withdraw the Book

- **WHEN** a cited target is revoked or unavailable while Book read authority remains valid
- **THEN** saved Book prose, references, graph, annotations and fixed indexes remain readable without fetching that target
- **AND** an actual target-body fetch checks that target and its fixed version separately

#### Scenario: Fixed optional index metadata

- **WHEN** a Book is published without an optional source-key resolver and one is installed later
- **THEN** the saved empty key snapshot is retained and the old revision is not reinterpreted or made dependent on target reads
- **AND** saved source-key metadata remains bounded as fixed digests rather than large raw strings

### Requirement: Actual consumer final publication

Transport and tool consumers MUST recheck current issuer, invocation, contribution and object permissions applicable to their original operation after the final await and before emitting bytes. Historical read wrappers MUST recheck their own read authority.

#### Scenario: Read publication loses authority

- **WHEN** issuer or historical-read authority is withdrawn after the internal operation and before the consumer response
- **THEN** no member snapshot, historical work or Historian status is published to that caller

### Requirement: Confirmed effects survive lost publication authority

A confirmed mutation MUST preserve its original effect and receipt when publication authority is lost. It MUST report unknown rather than successful publication or a definite precommit denial, and MUST NOT replay with a replacement identity.

#### Scenario: RSI or research completion commits before withdrawal

- **WHEN** an RSI mutation or research completion commits and its final publication permission is withdrawn
- **THEN** the final response reports unknown while the original receipt or completed run remains queryable under renewed authority
- **AND** publication refusal alone does not invalidate a healthy storage Runtime

### Requirement: Result-bound completion verification

Memo research completion MUST retain a synchronous verifier bound to the same service, original result and invocation for downstream final publication.

#### Scenario: Tool completion is wrapped asynchronously

- **WHEN** a tool awaits a confirmed completion result and then loses its current contribution or invocation
- **THEN** final result verification refuses publication as unknown without undoing the completed run
- **AND** copied results or results from another service do not acquire verification authority
