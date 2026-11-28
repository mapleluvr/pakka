## Purpose

Provide durable, permission-scoped tickets shared by humans and Bots, with nonblocking submission, author revisions, observable progress and explicit links to MAS execution. Keep ticket collaboration independent of the business workflow used to resolve it.

## ADDED Requirements

### Requirement: Durable nonblocking submission and revision

The service SHALL return a persistent ticket receipt after submission without waiting for Agent execution. The authenticated author SHALL be able to revise ticket content using an expected version. Mutations SHALL retain their original request identity and revision history across normal reopen.

#### Scenario: Bot submits and revises without generation

- **WHEN** a bound Bot submits a ticket and edits it at the current version
- **THEN** both writes produce persistent receipts and the current ticket and previous content remain readable without dispatching a provider request

#### Scenario: Duplicate or conflicting mutation

- **WHEN** an actor repeats an existing request or edits from an old version
- **THEN** identical requests return their original receipt, conflicting payloads and stale edits are rejected, and no duplicate ticket or overwritten revision is created

### Requirement: Scoped observation and management

The service SHALL bind actor identity and current role on the server. Authors SHALL read and edit their own tickets; assigned handlers SHALL read and report on assigned tickets; managers SHALL manage the service's tickets and assignments. All reads and writes SHALL recheck current authority after asynchronous preparation. Queries SHALL filter before pagination and result publication.

#### Scenario: Foreign author and expired authority

- **WHEN** a different author queries or edits another author's ticket, or a lease expires while a write is prepared
- **THEN** protected content and the write are refused and the ticket remains unchanged

#### Scenario: Assigned handler reports progress

- **WHEN** an assigned handler records progress or closes a ticket
- **THEN** the ticket retains the actor, state, text and result references in its history while authors can observe the change

### Requirement: Ticket and execution identity remain separate

The MAS integration SHALL explicitly dispatch an assigned ticket revision to an approved handler and retain the original delivery identity. Submission and content editing SHALL remain independent from dispatch. A generation terminal outcome SHALL NOT by itself close the ticket. Unconfirmed delivery effects SHALL remain observable and SHALL NOT be automatically replayed.

#### Scenario: Revision changes during processing

- **WHEN** the author edits a dispatched ticket
- **THEN** the current content changes while the original run retains the content revision it received and no additional run is started

#### Scenario: Dispatch and query native progress

- **WHEN** a manager dispatches a ticket and later refreshes the retained native receipt
- **THEN** the original target receives the ticket context, the observed delivery status is linked to that run, and ticket closure remains a separate business decision

#### Scenario: Delayed observation after native completion

- **WHEN** an earlier queued/placed observation or a failed refresh returns after a confirmed terminal native receipt
- **THEN** the recorded terminal delivery remains unchanged and no replacement execution is started

### Requirement: Shared Agent and WebUI surfaces

The package SHALL provide invocation-bound Agent tools and an optional public WebUI extension consuming the same service. The UI SHALL expose ticket creation, editing, scoped listing/detail, progress/history and authorized handling. Closing an interface SHALL leave persisted tickets intact. Unknown responses SHALL preserve the original request for read-only reconciliation.

#### Scenario: Bot submission is visible in the workbench

- **WHEN** a real model tool call creates a ticket and an authorized user opens the extension
- **THEN** the UI displays that same ticket and permitted edits and progress use the same persisted service records

#### Scenario: Browser reload and permission changes

- **WHEN** the UI is reopened or the actor's permission is revoked
- **THEN** current authorized records reload and revoked reads/writes fail without disclosing protected ticket content

#### Scenario: Saved submission response is lost

- **WHEN** storage accepts a submission but the browser loses the HTTP response
- **THEN** it retains its original request key, resolves the host operation and its service receipt, and restores the ticket without a second mutation

### Requirement: Bounded storage and independent package assembly

The service SHALL validate persisted data and finite capacities, fail closed on unknown storage, and retain tickets independently of handler lifetimes. Agent/headless imports SHALL be independent of WebUI runtime imports. The monorepo SHALL contain a buildable inert Memo package whose functional semantics remain deferred.

#### Scenario: Normal reopen and malformed storage

- **WHEN** the owning Runtime closes normally and reopens the same storage
- **THEN** tickets, revisions and request receipts remain queryable; malformed or incompatible persisted state is refused rather than reset

#### Scenario: Installed public consumer

- **WHEN** an isolated consumer installs the produced archives
- **THEN** it can use RSI public exports with real Runtime storage, load the optional UI contribution explicitly, and import Memo without starting services or accessing user data
