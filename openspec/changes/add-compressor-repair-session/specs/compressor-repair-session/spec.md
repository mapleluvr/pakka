## Purpose

Define a source-bound compressor trajectory that repairs complete tool submissions under independent finite error tolerances, retaining evidence and preventing further work once either limit seals the session.

## ADDED Requirements

### Requirement: Continuing source-bound trajectory

A compressor session SHALL preserve its fixed host-bound source job and prior assistant messages, attempted tool calls and matched error results across recoverable corrections. A failed submission SHALL request a complete replacement of all required P1/P2/P3/P4 fields rather than merge partial arguments. A final stop without an accepted complete candidate SHALL trigger a bounded correction in that same trajectory.

#### Scenario: Submission repair retains earlier work
- **WHEN** a candidate has a missing required field after earlier assistant analysis
- **THEN** the next request contains the analysis, rejected call and call-ID-matched error result requiring all fields again
- **AND** a later partial patch alone is insufficient for adoption

#### Scenario: Stop without complete submission
- **WHEN** the model stops normally with no complete accepted candidate and remaining unresolved-error allowance
- **THEN** the host requests the complete tool submission in the compressor trajectory
- **AND** legal explicit empty artifact collections remain distinct from missing fields

### Requirement: Independent cumulative error tolerances

A compressor session SHALL have independently configured positive finite integer Tool_Calling_Tolerance and Unresolved_Error_Tolerance settings. Each categorized incident SHALL increment exactly one cumulative counter once. Reaching either configured value SHALL seal the session immediately, including the incident that reaches it. Interleaving errors SHALL retain both counts.

#### Scenario: Tool threshold is an error count
- **WHEN** Tool_Calling_Tolerance is 3 and the third tool-submission error occurs
- **THEN** the tool-error count is 3 and the session is sealed before a fourth provider dispatch

#### Scenario: Other-error threshold is independent
- **WHEN** Unresolved_Error_Tolerance is 4 and four final stops have produced no accepted candidate
- **THEN** the unresolved-error count is 4 and the session is sealed before a fifth provider dispatch
- **AND** those stops have not incremented the tool-error count

#### Scenario: Interleaved errors and recovery
- **WHEN** two tool errors and three unresolved errors occur under settings 3 and 4, followed by a valid candidate
- **THEN** counts remain 2 and 3 and adoption can complete under the original source job
- **AND** replay of a previously recorded incident does not increment either counter again

### Requirement: Retained sealed result

Sealing SHALL retain the trajectory, source/session identity, configured settings, both counters and the most recent actual error reason with incident identity. Normal reopen SHALL preserve the seal. Commands and late results for a sealed session SHALL be rejected at dispatch and adoption. A new session after a reached tolerance SHALL require explicit authorized admission.

#### Scenario: Reopen sealed compressor
- **WHEN** the host opens a normally closed sealed session
- **THEN** the reported counters and last error are retained and inspection performs zero provider requests
- **AND** an attempted continuation cannot dispatch or adopt a candidate

### Requirement: Host-governed requests and effects

Every compressor request SHALL be checked against its source job, current authority and finite per-attempt/job/strategy/Session budgets, retaining reservation, usage and completion evidence. Cancellation, source/lease invalidation, exhausted hard budgets and unknown persistence SHALL use terminal host rules. Raw argument integrity SHALL be checked before adoption in addition to schema and source validity.

#### Scenario: Invalid source or unknown effect
- **WHEN** authority is revoked or a completion/adoption write is unknown
- **THEN** the relevant host failure boundary closes and a remaining tolerance cannot authorize another request

#### Scenario: Repaired truncated wire arguments
- **WHEN** an SDK presents normalized valid arguments from a truncated raw tool argument stream
- **THEN** the candidate is rejected at the strict wire-integrity boundary despite passing schema validation
