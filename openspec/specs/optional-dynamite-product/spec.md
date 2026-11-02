# optional-dynamite-product Specification

## Purpose

Define explicit host-selected Dynamite support through fixed optional archive pairs, native invocation, authority, identity and finite budgets under trusted bootstrap.

## Requirements

### Requirement: Host-selected optional installation

The executable bootstrap SHALL preserve native context when Dynamite is omitted. Explicit Dynamite selection SHALL load only the exact optional package peer and SHALL bind one existing controlled strategy service to each selected initial persistent member. Tools and RPC MUST NOT select module paths, credentials, inference endpoints, stronger policy or new strategy owners.

#### Scenario: Feature is absent or dependency is missing

- **WHEN** native bootstrap omits the feature, or feature startup cannot load its required optional peer
- **THEN** native startup requires no strategy import and missing-peer feature startup refuses before storage allocation without fallback creation

#### Scenario: Foreign member invokes an advertised tool

- **WHEN** a non-selected member shares a tool-advertising profile and invokes reduce
- **THEN** the native scope cannot bind to a selected member's service and no foreign artifact, projection or auxiliary dispatch occurs

### Requirement: Native lifecycle and controlled budgets

Every model reduce invocation SHALL pass the exact catalog member scope and the library's native invocation validation. Trusted lease revocation SHALL remove authority without new grants, replay or refund. Strategy shutdown SHALL cancel/drain owned work and close the runtime even on cleanup failure. Normal closed reopen SHALL retain source/projection records and spent Session quota with fresh runtime authority.

#### Scenario: Two selected Conversations and revocation

- **WHEN** two Conversations use the same strategy name and only A's lease is revoked
- **THEN** A cannot apply or mutate through the old service/tool while B's actual next HTTP retains its own strategy and records

#### Scenario: Normal reopen after reduction and inference

- **WHEN** the product is closed normally and reopened against the same storage and approved configuration
- **THEN** admission identity, raw source and committed records remain unchanged, inspection/dedup sends no provider request and consumed strategy/Session budget does not reset

### Requirement: Real fixed-artifact product pairing

Product checks SHALL use the compiled server executable and client/CLI with exact agent and external strategy archive hashes, actual native calls and deterministic HTTP. Results SHALL bind that explicit combination, configuration and execution environment. Archive identity, provider dispatch, native receipts and unknown effects SHALL be checked separately.

#### Scenario: Installed operator and model path

- **WHEN** the isolated installed consumer starts configured product, sends through CLI/client and the model invokes reduce or triggers explicitly permitted compression
- **THEN** next HTTP demonstrates checked numbering/omission or summary, native tool IDs/results and terminal receipts are observed, original source history remains intact and unknowns are not treated as rollback
