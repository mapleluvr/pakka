## Purpose

Define the Dynamite-owned Compresser Session and its source-bound Conversations serving external business Sessions, with conversational repair, independent finite error tolerances and retained sealing.

## ADDED Requirements

### Requirement: Compresser service container and source bindings

Pakka-dynamite SHALL maintain one long-lived pi-durable Session named the Compresser Session, containing Compresser Conversations that serve business Sessions and Conversations outside that container. One external business Conversation SHALL be able to trigger multiple Compresser Conversations. Each internal Conversation SHALL retain its own host-bound source job/context identity and trajectory. The Compresser Session SHALL admit work under source authority and resource budgets without a preset Conversation-count limit. Repeated admission of the same job SHALL retain its existing binding and receipt identity.

#### Scenario: Multiple jobs from one external Conversation

- **WHEN** one external business Conversation starts two distinct authorized compression jobs
- **THEN** the Compresser Session can contain two independently bound Compresser Conversations for those jobs
- **AND** each job retains its own source snapshot, repair history, candidate and receipts
- **AND** the external business Session and Conversation remain outside the Compresser Session

#### Scenario: Same job admission is idempotent

- **WHEN** the same source-bound compression job is admitted again
- **THEN** it retains the existing internal Conversation binding and original receipt identity
- **AND** the retry does not create a new trajectory or reset Session accounting

#### Scenario: Conversation cardinality is not an admission quota

- **WHEN** another source-bound job is authorized and within its resource budgets
- **THEN** its admission is not rejected solely because a preset number of Compresser Conversations has already been created

### Requirement: Continuing source-bound trajectory

Each Compresser Conversation SHALL preserve its fixed host-bound source job and prior assistant messages, attempted tool calls and matched error results across recoverable corrections. A failed submission SHALL request a complete replacement of all required P1/P2/P3/P4 fields rather than merge partial arguments. A final stop without an accepted complete candidate SHALL trigger a bounded correction in that same trajectory.

#### Scenario: Submission repair retains earlier work
- **WHEN** a candidate has a missing required field after earlier assistant analysis
- **THEN** the next request contains the analysis, rejected call and call-ID-matched error result requiring all fields again
- **AND** a later partial patch alone is insufficient for adoption

#### Scenario: Stop without complete submission
- **WHEN** the model stops normally with no complete accepted candidate and remaining unresolved-error allowance
- **THEN** the host requests the complete tool submission in the compressor trajectory
- **AND** legal explicit empty artifact collections remain distinct from missing fields

### Requirement: Independent cumulative error tolerances

The Compresser Session SHALL have independently configured positive finite integer Tool_Calling_Tolerance and Unresolved_Error_Tolerance settings. Each categorized incident SHALL increment exactly one cumulative Session counter once, retaining its originating Compresser Conversation and source job identity. Reaching either configured value SHALL seal the Compresser Session immediately, including the incident that reaches it. Interleaving errors across categories and Conversations SHALL retain both counts.

#### Scenario: Tool threshold is an error count
- **WHEN** Tool_Calling_Tolerance is 3 and the third tool-submission error occurs
- **THEN** the tool-error count is 3 and the Compresser Session is sealed before any further provider dispatch

#### Scenario: Other-error threshold is independent
- **WHEN** Unresolved_Error_Tolerance is 4 and four final stops have produced no accepted candidate
- **THEN** the unresolved-error count is 4 and the Compresser Session is sealed before any further provider dispatch
- **AND** those stops have not incremented the tool-error count

#### Scenario: Interleaved errors and recovery
- **WHEN** two tool errors and three unresolved errors occur under settings 3 and 4, followed by a valid candidate
- **THEN** counts remain 2 and 3 and adoption can complete under the original source job
- **AND** replay of a previously recorded incident does not increment either counter again

#### Scenario: Session counts span independent jobs

- **WHEN** two Compresser Conversations contribute two and one tool errors respectively under Tool_Calling_Tolerance 3
- **THEN** the shared tool-error count reaches 3 and the Compresser Session is sealed
- **AND** a new child Conversation cannot reset the count or authorize further dispatch/adoption

### Requirement: Retained sealed result

Sealing SHALL retain the Session identity, child trajectories, configured settings, both counters and the most recent actual error reason with originating Conversation, source job and incident identity. Normal reopen SHALL preserve the seal. New job admission, commands and late results for any Conversation in a sealed Compresser Session SHALL be rejected at dispatch and adoption. A new Compresser Session after a reached tolerance SHALL require explicit authorized admission.

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

### Requirement: Explicit native service assembly

Trusted bootstrap SHALL create a single Compresser container facade with explicit positive finite tolerances and one storage writer. Participating external Hosts SHALL receive the same identity-bound facade. A source job SHALL select the conversational port explicitly; every native continuation SHALL retain the original source authority and an individual auxiliary reservation/completion. Strategies SHALL receive frozen data and commands rather than mutable native handles.

#### Scenario: Finite native correction budget

- **WHEN** an explicitly enabled tool-format Dynamite service supplies a finite per-job request ceiling
- **THEN** native corrections remain within that ceiling and the original host auxiliary policy
- **AND** a failure cannot open the engine's primitive retry/fallback chain to bypass the shared seal

#### Scenario: Required settings survive reopen

- **WHEN** bootstrap reopens an existing Compresser storage
- **THEN** the original settings, counts, source-job bindings and seal are retained
- **AND** changing the tolerances rejects instead of resetting the policy

### Requirement: Interrupted work is quarantined

A reopened unconfirmed running or pending Compresser job SHALL be quarantined and seal the container before native scheduling. Writer ownership SHALL require explicit trusted resolution after a process crash. Persisted metadata SHALL NOT refresh lost source authority or automatically replay an unknown model effect.

#### Scenario: Process stops after request dispatch

- **WHEN** the owning process exits after dispatch and trusted recovery has resolved its stale writer claim
- **THEN** reopening reports the unfinished job as quarantined and the container as sealed
- **AND** inspection or attempted continuation produces no replayed provider request
