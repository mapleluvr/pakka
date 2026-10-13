## Purpose

Provide optional agent-facing MAS tools over invocation-bound service authority, with approved creation locations, native lifecycle semantics and verifiable delivery receipts rather than privileged runtime objects.

## ADDED Requirements

### Requirement: Optional controlled extension contribution

The DevPack MUST contribute tools and instructions only to an explicitly approved Conversation profile. Import SHALL NOT start a server, open storage, read user credentials or create a Session. The model SHALL receive provider-safe `mas_*` tools for logical `mas.*` actions and frozen serializable results, never native objects or authority-bearing tokens.

#### Scenario: Enabled and disabled profiles

- **WHEN** enabled and disabled Conversations request inference
- **THEN** only the enabled profile advertises current MAS tools and instructions; removal replaces current prompt sections and prevents execution of former tools
- **AND** Durable's historical positional system updates remain immutable transcript context, not active extension selection; removal does not physically delete old messages

### Requirement: Live invocation and revocation

Every action MUST bind to the current Conversation's proven live native invocation and its approved principal/grants. Copies, foreign scopes, expired invocations and revoked contributions MUST NOT authorize effects. Composed authority checks SHALL propagate to the underlying effect commit, rather than only surround awaited service calls.

#### Scenario: Revocation during recipient admission

- **WHEN** the contribution or principal is revoked while admission is awaited
- **THEN** the target write and provider request are refused

### Requirement: Approved creation modes

Creation MUST distinguish current Session, an explicitly approved existing Session, and an approved new-Session template. Temporary/task/background lifetimes MUST use real native ownership and SHALL NOT pretend to provide process isolation. Cross-Session creation MUST use bounded durable reservations and approved host configuration; arbitrary credentials, endpoints, tools, owner/task identity or budgets SHALL be refused.

#### Scenario: Temporary child from an actual tool call

- **WHEN** an agent creates a temporary child and its creating task ends
- **THEN** the child is bound to that real task, cannot receive new input after the owner ends, and historical records remain

#### Scenario: Uncertain new-Session creation

- **WHEN** startup or enrollment cannot be confirmed
- **THEN** the reservation remains pending/unknown and retry reconciles the same approved slot without replacement allocation

### Requirement: Communication and ownership stay distinct

Send, steering, follow-up and receipt-linked reply SHALL preserve native admission behavior and caller authority. Observation MUST NOT expose a peer's full transcript. Abort, retirement, configuration and fork MUST follow existing owner/grant policy; communication alone SHALL NOT authorize them.

#### Scenario: Communicator attempts peer retirement

- **WHEN** a sender can deliver to a peer but is not its authorized owner
- **THEN** delivery succeeds and retirement has no peer effect

#### Scenario: Selecting another worker profile cannot mint grants

- **WHEN** a worker agent spawns a descendant using a profile with stronger approved actions
- **THEN** effective actions are intersected with the full capability-owner ancestor chain
- **AND** missing or cyclic ownership fails closed; only trusted root presets establish an initial grant ceiling

### Requirement: Honest bounded waiting

An ask operation SHALL submit input and await its generation receipt within the tool invocation's cancellation/timeout boundary. It MUST NOT claim that a `done` generation receipt is an application reply or proof that external effects completed. Timeout/abort MUST preserve unknown outcomes and MUST NOT release admission or creation capacity.

#### Scenario: Definitive refusal before effects

- **WHEN** a worker lacks an approved Session service or a fixed slot is occupied by a different request
- **THEN** a trusted pre-effect refusal reports denied, without new allocation or effects for the refused request
- **AND** other attempted-action failures remain unknown; error strings never prove rollback

#### Scenario: Wait refusal after successful send

- **WHEN** send has returned an admission receipt and a later wait preflight is refused
- **THEN** the entire ask reports unknown, not effect-free denial, and the existing admission remains retained

#### Scenario: Wait is cancelled after placement

- **WHEN** waiting is cancelled after the input was placed
- **THEN** the returned outcome does not claim rollback or withdrawal and the original durable admission remains inspectable
