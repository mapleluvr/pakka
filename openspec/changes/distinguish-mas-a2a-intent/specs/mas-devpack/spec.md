## ADDED Requirements

### Requirement: Passive inform tooling does not imply a reply or wakeup

The optional DevPack MUST expose `mas_inform` only through the configured MAS client and invocation-bound authority. It MUST describe inform as bounded, source-labelled, requesting no reply, and not scheduling or waking the target. Without exact host GenerationTask completion evidence, it MUST NOT describe projected inform as understood or consumed.

#### Scenario: Agent contributes information passively

- **WHEN** an approved invocation calls `mas_inform`
- **THEN** it stores the contribution under its bound source and target without a native target request
- **AND** future natural requests may receive the contribution while its durable status remains pending/at-least-once

### Requirement: DevPack tool descriptions preserve request and response intent

DevPack MUST describe `mas_send` as a request for a concrete deliverable or decision, `mas_reply` as one response to an actual root receipt, and `mas_ask` as waiting for a generation receipt rather than an application response.

#### Scenario: Ask remains a generation wait

- **WHEN** an agent uses `mas_ask` for a native request
- **THEN** the tool waits for the native generation receipt and does not wait for or imply an application response
