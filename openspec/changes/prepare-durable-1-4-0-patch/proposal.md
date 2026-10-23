# Change: Prepare the Pi Durable 1.4.0 downstream patch

## Why

The operator requested the latest released Durable source patch in a new worktree after publishing main. The operator also clarified that development verification is optional and a skipped activity is recorded once rather than repeatedly inherited.

## What Changes

- Pin the latest observed release, source commit and registry identity.
- Prepare 1.4.0-pakka.1 with explicit generation refusal and attempt/payload checks.
- Carry source, dependency lock, installable archive and integrity metadata; extend build/verify commands with explicit version selection.
- Run source regressions and a separate installed-archive consumer against deterministic local HTTP.
- Describe both patch artifacts and their actual dependency roles in state.
- Express optional verification and one-time skip recording in current development documents.

## Capabilities

### Added Capabilities

- `durable-request-policy`: versioned downstream artifacts and request-policy behavior.
- `development-verification`: optional selection, single ownership of skip decisions and version-scoped results.

## Impact

Patch artifacts, build/integrity tooling, documentation and a tooling regression. Production package dependencies and the existing Dynamite pairing retain their current identities. Integrating the 1.4.0 cohort into the Pakka adapter is a distinct source migration identified by the compatibility probe.
