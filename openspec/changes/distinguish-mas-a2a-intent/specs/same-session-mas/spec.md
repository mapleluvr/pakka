## ADDED Requirements

### Requirement: Passive A2A informs are durable and do not wake recipients

The MAS MUST require explicit inform authority and an active, approved target. It MUST bind identity to source, principal and request ID, reject changed payload or route, and enforce finite capacity and recipient admission. Accepted informs MUST persist without creating native transcript input, a GenerationTask, a provider request, a wakeup or an acknowledgement.

#### Scenario: Passive contribution waits for natural work

- **WHEN** an authorized principal informs an active approved target
- **THEN** the contribution is durably recorded and an identical retry returns the same identity
- **AND** no native input, task, wakeup or acknowledgement is created
- **AND** a later natural request to that exact target may receive bounded, source-labelled untrusted context without changing its transcript

#### Scenario: Changed target, payload or revoked authority

- **WHEN** an inform reuses its identity with changed payload/route, addresses an inactive/unapproved target, or loses authority before persistence
- **THEN** it fails closed and does not create a contribution under the changed request

### Requirement: Inform context is bounded and remains pending without completion evidence

The MAS MAY project bounded, source-labelled, untrusted inform context only into later natural requests to the exact approved target, outside its transcript. Status MUST remain pending/at-least-once unless a public lifecycle callback proves successful completion of the exact host GenerationTask containing the contribution. Without that evidence, the MAS MUST NOT claim it was understood or consumed.

#### Scenario: Projection has no completion evidence

- **WHEN** a context source renders an inform into a provider request, or that request fails, is cancelled, times out or has unknown outcome
- **THEN** the inform remains pending/at-least-once and the service does not claim it was understood or consumed

### Requirement: Responses preserve native request and root association

The MAS MUST preserve `send()` as the native request path and bind each response to one verified root receipt and its source/target. Each root MUST accept at most one response, and responses MUST NOT create response-to-response chains. Existing prompt/steer/followUp placement and `mas_ask`'s generation-receipt contract MUST remain unchanged.

#### Scenario: One associated response and stable retry

- **WHEN** a recipient replies to a verified root request
- **THEN** the response preserves the root association and an identical retry reuses the same native response without another generation
- **AND** a new request ID cannot extend or replace that response

#### Scenario: No implicit confirmation or response chain

- **WHEN** an inform is persisted or a response receipt is received
- **THEN** neither event implicitly creates an acknowledgement or a new response root

### Requirement: Confirmed response refusal releases active capacity

The MAS MUST verify the reply grant, recipient activity and readiness before reserving a response. If first-time recipient admission explicitly returns `false`, no active reservation may remain. Corrected payloads MUST be allowed for the same root after recovery, and confirmed initial refusals MUST NOT consume the 256 active-response limit.

#### Scenario: Deterministic refusal does not consume the response reservation

- **WHEN** a reply target is inactive/not-ready or recipient admission explicitly returns `false`
- **THEN** no active response reservation remains and a corrected payload may be submitted for the same root after recovery
- **AND** the refusal does not consume the bounded active-reservation capacity

### Requirement: Unknown response outcomes preserve identity

Admission exceptions, unknown reservation commits, uncertain native delivery, cancellation or timeout MUST preserve the original response identity and fail closed. An identical approved retry MUST recheck current recipient admission and reuse its native request; a later refusal MUST NOT release an already approved/unknown identity. A changed payload or request ID MUST be refused. Active reservations MUST remain bounded to 256 per MAS namespace.

#### Scenario: Unknown admission or delivery remains bound

- **WHEN** admission throws or native delivery has an uncertain outcome
- **THEN** the root remains pinned to the original response identity and payload
- **AND** a different payload or request ID is refused while an identical approved native request may be retried
