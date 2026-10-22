# Change: OpenSpec-backed documentation and reversible cleanup

## Why

The document system needs one complete change history, not parallel records in docs and OpenSpec. The operator requires docs/changes summaries to cite the whole OpenSpec change and its specs, and permits backed-up removal of superseded documents and unrelated temporary files.

## What Changes

- Keep OpenSpec proposal/design/tasks/specs and its archive lifecycle.
- Use OVERVIEW and state as reading/expectation entry points; docs/changes only summarizes and enumerates complete change/spec references.
- Back up, hash-verify, and remove superseded copies and stale experiments; retain useful contracts, current evidence and active local state.
- Fill two old Purpose placeholders without modifying existing runtime requirements.
- Record validation failures honestly and keep product acceptance separate.

## Capabilities

### New Capabilities

- `project-documentation`: find current expectations and complete change/spec provenance, with recoverable material cleanup.

### Modified Capabilities

None. Existing runtime/MAS requirement wording and scenarios are not weakened or split for a formatter or strict-validation score.

## Impact

Documentation, OpenSpec configuration and ignored working materials only. No runtime, tests, package dependencies, paid model calls or main merge.
