## ADDED Requirements

### Requirement: Optional persistent research

A librarian SHALL retain a stable identity and original Runtime binding, while each research request has its own run and dispatch identity. Opening or reading the service SHALL NOT start model work. Explicit activation and wake SHALL advance at most one active research per binding. Native delivery completion SHALL NOT imply research completion.

#### Scenario: Empty publication completion

- **WHEN** the authorized librarian ends a research run without writing a Wiki page
- **THEN** the run is completed with no publications and its native conversation must be idle before the next run starts

#### Scenario: Lost MAS response after reopen

- **WHEN** MAS accepted an input but the Memo side lost the response and both storage domains are reopened
- **THEN** explicit recovery queries the original route and request identity without a second admission

#### Scenario: Unknown cancellation

- **WHEN** cancellation cannot establish whether the original input was accepted
- **THEN** the original slot remains unavailable to replacement dispatch

#### Scenario: Resume an interrupted cancellation

- **WHEN** a saved cancellation later finds the original accepted delivery, or its first abort failed
- **THEN** explicit advance continues that original cancellation and retains the execution slot until cancellation and idle are confirmed

#### Scenario: Business completion with native work remaining

- **WHEN** research_finish completes the business run while its native generation is still active
- **THEN** the original run retains cancellation authority and execution ownership until it is idle; cancellation of a released historical run cannot affect a later research

### Requirement: Independently usable authorized knowledge

The Memo service SHALL expose Wiki and source discovery/read operations to a host-bound actor without creating model execution or MAS members. It SHALL enforce current library and source authorization on metadata and body publication.

#### Scenario: Revocation during source read

- **WHEN** source reading awaits a host response and the reader loses library authorization
- **THEN** the response body is denied before publication

#### Scenario: Registration does not confer source authority

- **WHEN** a library reader lacks the registered source's read permission
- **THEN** catalog/search metadata and source content are not disclosed

#### Scenario: Revocation during citation filtering

- **WHEN** the caller's overall authority ends while Wiki citations are being filtered
- **THEN** the Wiki body is refused at the final publication boundary

### Requirement: Durable versioned Wiki mutations

Wiki mutations SHALL atomically persist the changed page, revision, change fact and original request receipt. Rename SHALL retain page identity; restoring content SHALL create a new revision. Repeated requests SHALL reconcile by actor, request identity and parameters.

#### Scenario: Response authority ends after commit

- **WHEN** the write commits but the actor loses response authority
- **THEN** the caller receives unknown and a later authorized lookup can recover the original receipt

#### Scenario: Stale Markdown import

- **WHEN** an exported document is imported after another revision was committed
- **THEN** its original base revision conflicts instead of overwriting the current page

#### Scenario: Foreign database with a hot journal

- **WHEN** an existing database cannot be confirmed as Memo-owned without writing
- **THEN** opening is refused before writable recovery can change the main file or journal

#### Scenario: Malformed role input

- **WHEN** a manager supplies a non-string role instead of a declared role or null
- **THEN** the request is invalid, no receipt is committed, and the instance remains usable by other authorized libraries

### Requirement: Bounded historical reads

Directory, revision and change reads SHALL use bounded pages with query-bound cursors and current authorization. Body reads SHALL return an exact requested reference and bounded range. Accumulated history SHALL remain separately addressable after reopening.

#### Scenario: Reopen a long Wiki

- **WHEN** a page with more than 128 revisions is closed and reopened
- **THEN** authorized callers can traverse every retained revision and query the first write receipt without loading all history in one response
