# Change: Streamline document entry points and describe the Durable patch

## Why

The operator requested removal of three migration redirects, local-only visual workspaces, a review of verification history, removal of the redundant WebUI status page when its useful content has an owner, and a state description of the project-owned Pi Durable source patch.

## What Changes

- Use state for adopted product contracts, OVERVIEW and owning OpenSpec tasks for current work, and version-scoped records/Git for candidate history.
- Remove the three root migration redirects and the WebUI status aggregate after mapping their content and readers.
- Ignore visual run output and stop tracking it; retain stable reference metadata as a test fixture and cite historical artifacts by immutable Git links.
- Describe the pinned downstream patch, generation rejection/check behavior, build inputs, artifact and validation entry points in state.
- Keep the existing verification-method page as the method owner and separately assess further historical-report retirement.

## Capabilities

### Modified Capabilities

- `project-documentation`: current work discovery, recoverable removal, local visual output and downstream patch documentation.

## Impact

Documentation, ignore rules and one static reference-test input path. Runtime code, patch bytes, package dependencies and compatibility behavior retain their identities.
