# WebUI design-system principles

## Why

Pakka is evaluating Astryx for its WebUI and default extension primitives. Developers need a source-grounded comparison and a readable ownership map before the refactor turns today's component shapes, file layout or rendering stack into permanent constraints.

## What Changes

- Compare Astryx with open-code, headless, themed and Web Component alternatives using pinned official sources; distinguish advertised capabilities from unperformed integration trials.
- Adopt maintainability, open composition, small public surfaces and risk-selected verification as WebUI development principles. During the early refactor, add tests only when indispensable; this operator instruction takes precedence over Ockle TDD.
- Document current entry points and a recommended React 19 / TypeScript / Astryx target layout, module responsibilities, extension interfaces, runtime ownership and an incremental adoption path.
- Explain that source moves are not public API changes, while a Preact-to-React consumer/type migration is. Preserve the existing authorization, persistence, native scheduling, request identity and unknown-effect contracts.
- Update the developer entry points and verification guidance. No product code, dependency, runtime, asset, public export or test changes are included.

### Basis and authority

- **Operator requirements:** investigate similar open-source systems; establish high maintainability, high openness and low rigidity; write as few tests as possible during the early refactor, only when extremely necessary. The operator subsequently stated that changing the technology stack is acceptable.
- **Existing agreements:** one product package and shared browser runtime; default extensions use the same public contribution slots; backend authority, original operation identity and fail-closed uncertainty remain intact. Existing page behavior/reference contracts are not revoked by this documentation task.
- **Observed baseline:** fetched `origin/dev` at `cc1cdd8aead42cd0afe018c75973f09fd369184d` uses Preact 11.0.1 / htm 3.1.1. Astryx 0.7.15 declares React/React DOM >=19 and a StyleX runtime peer. No Astryx integration was found in the inspected baseline.
- **Design recommendation:** evaluate native React 19 adoption rather than pay an assumed Preact compatibility cost. The recommendation is not an implemented runtime or a promise that existing extensions already work on it.

## Capabilities

### New Capabilities

None. This change maintains development rules, a research report and an architecture guide; it does not add a product capability.

### Modified Capabilities

None. `.openspec.yaml` sets `skip_specs: true`. Concrete runtime, component API and visual behavior changes require their own adopted scope when implemented; no speculative product requirement is created here.

## Impact

Documentation and agent-facing development instructions only. Current source, manifests, locks, public exports, reference CSS, service behavior and tests remain unchanged. Checks cover document consistency, links/anchors, formatting and the complete PR diff; this task neither runs nor claims a production Astryx integration or independent/subagent review.
