# integrated-mas-product Specification

## Purpose

TBD - created by archiving change integrated-mas-product. Update Purpose after archive.

## Requirements

### Requirement: Executable optional contributions

A trusted product bootstrap SHALL install DevPack only for explicitly approved profiles, retaining the no-DevPack mode. Every model tool call MUST bind the actual native invocation and member principal; tool parameters MUST NOT select credentials, arbitrary extensions, storage or stronger root authority.

#### Scenario: Model-created stronger profile

- **WHEN** a spawn-only member creates a descendant selecting an approved send-capable profile and that descendant attempts peer delivery
- **THEN** its grants remain intersected with the full capability-owner ancestry, no peer provider request occurs and the original native receipts remain observable

#### Scenario: Unselected profile

- **WHEN** an approved default profile has DevPack but a peer/descendant uses an explicitly unselected profile
- **THEN** the peer provider request advertises no inherited DevPack tools and only its approved instructions

### Requirement: Explicit supported combinations

The product SHALL distinguish application RPC, trusted library/fixed-worker composition and unsupported public broker/template allocation. RPC spawn/configure/fork grants MUST be refused before opening storage in DevPack-enabled or Dynamite-enabled product bootstrap until their actor-to-agent ceilings are supported. Lifetime, normal-reopen identity/quota and unknown outcomes MUST remain native/controlled-service semantics.

#### Scenario: Unsupported remote profile management

- **WHEN** trusted startup combines either model contribution with a profile-changing RPC role
- **THEN** startup rejects before storage/model effects rather than silently enabling authority amplification

#### Scenario: Normal product reopen

- **WHEN** a closed owned product Session is explicitly reopened with matching approved configuration
- **THEN** native membership, admission identity and spent quotas are preserved; inspection and stable-ID retries do not add provider dispatch or restore old runtime capabilities

#### Scenario: Retained model-owned roster

- **WHEN** normal explicit reopen uses the matching initial roots after native model tools have created descendants
- **THEN** the product verifies complete owner ancestry, native readiness of active persistent members and known roster state before listening; no new member, owner rewrite, activation of ended tasks or resurrection of retired background is performed

#### Scenario: Conflicting roots or ancestry

- **WHEN** roots conflict, or retained descendants have missing/cyclic owners or an unconfirmed phase
- **THEN** product reopen refuses rather than accepting new authority or allocating a replacement Session

### Requirement: Fixed-artifact product acceptance

Supported combinations SHALL be exercised using real installed artifacts without workspace paths/root overrides and local deterministic providers. Evidence MUST distinguish native admission/generation/tool results from external effects and retain unknowns. GUI inclusion SHALL be a separate documented consumer/repository decision, not a prerequisite for headless acceptance. Dynamite SHALL remain absent by default and SHALL only be advertised as optional supported pairing after the new fixed library and actual product gates pass; historical failed pairing MUST remain recorded.

#### Scenario: Actual operator path

- **WHEN** an isolated consumer starts the product executable and submits work through CLI/shared client
- **THEN** actual native tool calls, original storage, exact HTTP/tool counts and terminal receipts demonstrate the supported composition, not simulation or summed prior-phase test counts
