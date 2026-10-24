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
- **AND** the retry does not create a new trajectory or reset that Conversation's accounting

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

Each Compressor Conversation SHALL own independent cumulative Tool_Calling_Tolerance and Unresolved_Error_Tolerance counters under explicit positive finite integer settings. An incident SHALL increment exactly one counter once in its originating Conversation. Reaching either configured value SHALL seal only that Conversation immediately. Other Conversations' incidents and outcomes SHALL NOT consume this allowance or reset it.

#### Scenario: Tool threshold is an error count
- **WHEN** a Conversation's tool tolerance is 3 and its third tool-submission error occurs
- **THEN** that Conversation retains count 3 and seals before its next provider dispatch
- **AND** independent Conversations remain available under their own allowances

#### Scenario: Other-error threshold is independent
- **WHEN** a Conversation's unresolved tolerance is 4 and four final stops have produced no complete candidate
- **THEN** that Conversation retains unresolved count 4 and seals before its next dispatch
- **AND** those stops do not increment its tool-error count

#### Scenario: Interleaved errors and recovery
- **WHEN** one Conversation has two tool errors and three unresolved errors below settings 3 and 4, then a valid candidate
- **THEN** its counts remain 2 and 3 and the candidate may be adopted under its exact source job
- **AND** replaying a recorded incident changes neither count

#### Scenario: Siblings have independent allowances

- **WHEN** two Conversations each repair one tool error under tolerance 2
- **THEN** both can complete with local count 1 rather than a summed count 2
- **AND** success, sealing or failure in one does not change the other's counters

### Requirement: Retained sealed result

A sealed Compressor Conversation SHALL retain its identity, source binding, trajectory, settings, counters and last actual error. Normal reopen SHALL preserve that child's seal. Re-admission of the same job, further dispatch and candidate adoption SHALL check that Conversation's seal. A sibling's tolerance exhaustion SHALL NOT invalidate in-flight work, successful receipts or independently authorized new jobs. Genuine shared storage uncertainty SHALL retain the shared storage failure boundary.

#### Scenario: Reopen a container with a sealed child

- **WHEN** a normally closed container with one sealed child is reopened
- **THEN** that child's counts, last error and seal remain inspectable without provider replay
- **AND** a fresh authorized independent Conversation can run in the same container

#### Scenario: Sibling seals after a candidate has returned

- **WHEN** source B has an exact successful candidate receipt and source A subsequently reaches its own tolerance
- **THEN** B can still adopt that candidate under its current source authority and artifact version
- **AND** A cannot dispatch or adopt through re-admission of its sealed job

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
- **AND** a failure cannot open the engine's primitive retry/fallback chain to bypass its own Conversation's seal

#### Scenario: Required settings survive reopen

- **WHEN** bootstrap reopens an existing Compresser storage
- **THEN** the original settings, counts, source-job bindings and seal are retained
- **AND** changing the tolerances rejects instead of resetting the policy

### Requirement: Interrupted work is quarantined

Reopened unconfirmed running or pending work SHALL be quarantined in its own Conversation, with native continuations stopped before unrelated work can resume. Writer ownership SHALL require explicit trusted resolution after a process crash. Persisted metadata SHALL NOT restore lost source authority or replay unknown model effects. Source-local uncertainty SHALL NOT alone close a healthy separate Compresser storage; genuinely shared persistence uncertainty SHALL remain fail-closed for that storage.

#### Scenario: Process stops after request dispatch

- **WHEN** the owning process exits after dispatch and trusted recovery resolves its stale writer claim
- **THEN** reopening retains that job as quarantined and sends no replayed provider request
- **AND** an independently authorized new job can complete without resuming the old job

#### Scenario: Source audit completion is unknown

- **WHEN** source A's external audit persistence fails while the separate Compresser storage remains healthy
- **THEN** A retains its pending reservation and quarantined Conversation without correction or fabricated refund
- **AND** an independently authorized source B can continue under its own storage and budget

### Requirement: Shared diagnostics retain source privacy

The container's trusted bootstrap snapshot SHALL retain each Conversation's own diagnostic. Other sources' status, audit, failed artifacts and model transcripts SHALL NOT contain that diagnostic or candidate. Shared container faults SHALL use generic source-facing refusal messages.

#### Scenario: One source seals while another is in flight

- **WHEN** source A reaches its tolerance with a diagnostic containing a private candidate and source B has an in-flight request
- **THEN** trusted bootstrap retains A's cause on A's record and B completes under its own policy
- **AND** B's result, status, audit and artifacts expose none of A's diagnostic

### Requirement: Concurrent local production and separate graph merging

Independent compression windows SHALL generate through independent native Conversations concurrently. Generation SHALL NOT wait for another window's result, repair, validation or P2/P3 merge. Shared artifact appends SHALL preserve atomic source/version/receipt checks and distinct block identities. Each job SHALL supply source-linked local P2 graphs/P3 annotations for a separate asynchronous merge mechanism; global graph state or merge completion SHALL NOT be a generation input dependency or P1-adoption prerequisite.

#### Scenario: Multi-window native compression overlaps

- **WHEN** a native batch has at least two independent source windows and the first provider response remains pending
- **THEN** another window's provider request is dispatched before the first completes
- **AND** a sealed window does not cancel valid siblings, whose records retain unique block IDs and their exact receipts

#### Scenario: Local graphs remain independent inputs

- **WHEN** independent jobs submit graph/node identifiers local to their own bundles
- **THEN** each bundle retains its own annotations and provenance for the separate merge mechanism
- **AND** compression does not combine the graphs or require a global merge result
