# Durable request policy delta

## ADDED Requirements

### Requirement: Versioned reproducible Durable patch

Every project-owned Durable patch SHALL identify its exact upstream release/commit, source delta, dependency lock, installable archive and integrity metadata. Build and verification tools SHALL accept explicit patch version selection. Default selection SHALL match the current production patch.

#### Scenario: Build the selected release

- **WHEN** a contributor supplies the pinned 1.4.0 checkout and selects 1.4.0-pakka.1
- **THEN** the build exports committed source, checks/applies the patch in isolation, builds with locked public dependencies and produces the identified downstream archive

#### Scenario: Verify a selected version

- **WHEN** the selected patch or archive differs from its recorded identity
- **THEN** integrity verification fails for that version even when another version remains intact

### Requirement: Explicit request policy refusal

The generation beforeRequest chain SHALL accept an explicit block or request messages with optional synchronous attempt-local checks. The first block SHALL stop later hooks. Checks SHALL run after the hook chain and after the existing final onPayload callback chain. Ordinary hook exceptions SHALL retain report-and-continue behavior.

#### Scenario: Refuse a request

- **WHEN** a selected hook blocks or its check rejects
- **THEN** the run inputs atomically settle unanswered with reason blocked and policy detail, the generation completes with a blocked result, and the refusal adds no provider request or assistant entry

#### Scenario: Recovered authorization

- **WHEN** an interrupted request resumes
- **THEN** authorization hooks/checks are reconstructed for the new attempt while committed settlements and native partial recovery retain their Durable semantics

### Requirement: Installed archive consumer

The 1.4.0 patch build SHALL exercise public exports from an independent npm installation of its archive with a deterministic local HTTP provider before publishing its artifact metadata.

#### Scenario: Consume compiled code

- **WHEN** the archive is installed outside the source workspace
- **THEN** policy refusal, final payload revocation and ordinary hook exception behavior run against compiled dist without workspace aliases or overrides
