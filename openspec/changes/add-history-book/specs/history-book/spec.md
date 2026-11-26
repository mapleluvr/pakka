## ADDED Requirements

### Requirement: Standalone Book service

Dynamite SHALL provide authorized query, read, edit, annotation, version and receipt operations usable by an ordinary Agent without Memo or active Historian generation.

#### Scenario: Direct edit without Memo

- **WHEN** an authorized Agent submits a bounded edit with the current base revision
- **THEN** Dynamite publishes the new version and original receipt atomically
- **AND** the operation starts no Historian or Patchouli inference.

#### Scenario: Independent annotation identities and views

- **WHEN** authorized callers annotate different Books with the same local request ID
- **THEN** each Book stores its own annotation and receipt
- **AND** an annotation view uses its own Book authority without inheriting permission to read its citation targets.

### Requirement: Fixed versions and bounded persistence

Book roots and immutable pages SHALL preserve directly addressable old revisions; reads, writes and caches SHALL be bounded independently of cumulative history.

#### Scenario: Read a historical revision after growth

- **WHEN** many later revisions exist
- **THEN** the original revision and receipt remain addressable without loading or replaying the entire Book.

#### Scenario: Authorization changes before the Book wrapper resumes

- **WHEN** the actual read object authority is revoked after an internal Book read completes but before its public asynchronous wrapper resumes
- **THEN** the wrapper synchronously rechecks current authority after its final await and publishes no protected content.

#### Scenario: Book content and cited targets have separate authority

- **WHEN** Book own read remains authorized but a cited target loses body-read permission or becomes unavailable
- **THEN** its saved Book body, graph and reference metadata remain readable as-is
- **AND** an actual target fetch separately checks the target version and current authority.

#### Scenario: Native scope remains live while Book authority is lost

- **WHEN** a native History tool finishes its internal Book operation and the actual Book or fetched-object authority is revoked before the final tool response
- **THEN** the tool synchronously rechecks the original Book result after its final await
- **AND** no protected body, title, excerpt or reference is serialized despite the still-live invocation scope.

#### Scenario: Committed write loses final publication authority

- **WHEN** an edit or annotation has committed and loses its operation authority before final publication
- **THEN** the result remains unknown rather than a definite denial or success
- **AND** the original request receipt remains available under current receipt authority.

#### Scenario: Publication result identity

- **WHEN** a caller asks a Book client to recheck a copied, invented or another client's result
- **THEN** the check refuses that value without changing stored Book health or content
- **AND** a same-client original result retains its current source, actor and operation checks.

### Requirement: Original Historian execution and publication

Historian SHALL fix its input, base, authority and allowance before execution, preserve per-job native repair state, and reconcile unknown results by original identity.

#### Scenario: Sealed result after response loss

- **WHEN** the original native result is sealed but the business receipt is missing
- **THEN** recovery checks the original result and completes local publication without another model call.

#### Scenario: Agent edit precedes background publication

- **WHEN** an Agent commits an edit before a candidate based on an older Book version is published
- **THEN** publication reports a conflict and retains the candidate and consumed budget
- **AND** the confirmed Agent edit remains authoritative.

#### Scenario: Retirement races original-result recovery

- **WHEN** an authorized retirement commits while an original-result lookup is pending
- **THEN** the recovery write preserves the retirement terminal state
- **AND** the work cannot publish a new Book revision.

### Requirement: Explicit execution and finite native resources

Historian SHALL establish cancellation before its first asynchronous state read and release request-local native resources after initialization failure or completion.

#### Scenario: Pause during the initial state read

- **WHEN** pause or stop occurs while the initial state read is pending
- **THEN** that operation starts no new model request and publishes no Book revision.

#### Scenario: Native setup fails before dispatch

- **WHEN** native provider or Conversation initialization fails
- **THEN** the request's provider and extension resources are released while the shared Session remains open
- **AND** original execution records and unknown-effect protections remain available.

### Requirement: Separate Memo knowledge

Memo SHALL own its adaptation of Dynamite public capabilities, including library identity, sharing, source format and final consumption checks; Patchouli may publish derived knowledge into Memo DB with fixed citations. Dynamite SHALL NOT own a Memo-specific source adapter. Memo knowledge SHALL retain independent library authority.

#### Scenario: Independent research publication

- **WHEN** Patchouli reads a Book and produces knowledge
- **THEN** Memo persists it with its own permission, revision and request receipt
- **AND** any Book correction uses a separately authorized Dynamite edit.

#### Scenario: Bounded exact source navigation

- **WHEN** a fixed Book source exposes many child references or long source locators
- **THEN** each response contains at most 32 references with locators of at most 1,024 characters and preserves continuation
- **AND** child reads resolve the original Book revision and source window, refusing changed identities or traversal beyond its finite budget.

#### Scenario: An ancestor is revoked during descendant reading

- **WHEN** a root or intermediate evidence authority is revoked during the asynchronous descendant read or before the outer operation resumes
- **THEN** the outermost publication synchronously rechecks the entire resolved path and returns no descendant content.

#### Scenario: Returned navigation is not a child-body read

- **WHEN** a parent source remains authorized but only its referenced child loses body-read authority
- **THEN** its original child reference metadata remains navigable
- **AND** an actual child-body read is separately refused.

#### Scenario: Unselected intermediate sibling loses authority

- **WHEN** an unrelated sibling from a transient intermediate source window loses authority while the selected path and leaf remain authorized
- **THEN** the leaf publication remains usable under its original path and terminal result checks.

#### Scenario: Source authority survives Memo DTO conversion

- **WHEN** actual Book own or fetched-object authority is revoked after the provider helper settles but before Memo or a native consumer publishes
- **THEN** final publication runs the original synchronous result verifier and returns no protected source content
- **AND** separately published Wiki text is not revoked merely because it cites that source.

#### Scenario: Core installation does not force unused capabilities

- **WHEN** only Memo knowledge storage is installed
- **THEN** the core operates without Dynamite, MAS, RSI or EI runtimes
- **AND** the separately installed Book adapter and MAS driver consume their actual public upstream capabilities without private state access.

#### Scenario: Ordered source-window continuation

- **WHEN** the same external source window changes the ordered sequence of its child references while a continuation is outstanding
- **THEN** the continuation rejects the changed sequence rather than silently returning another reference at the same index.
