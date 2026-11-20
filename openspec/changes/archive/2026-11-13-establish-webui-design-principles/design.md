# WebUI guidance design

## Context

See [proposal](proposal.md) for scope and operator authority. The inspected product has explicit extension exports and real default consumers, but browser application responsibilities are spread across a flat JS tree and a large App. Astryx is React 19-based; the operator allows changing stacks. The task is to establish development guidance, not implement that migration.

## Goals / Non-Goals

**Goals:** make code ownership and extension boundaries easy to find; keep arbitrary composition possible; apply the early-refactor test exception without weakening service contracts; provide a source-grounded recommendation and a small path to evaluate it.

**Non-goals:** selecting and installing final dependency versions, changing protocol or renderer ABI, moving source, rewriting pages, adding an SDK package, building a component registry, running a production Astryx trial, or adding/removing product tests.

## Decisions

### Keep three readable entry documents

- [Design-system research](../../../../docs/development/WEBUI-DESIGN-SYSTEMS.md): comparable categories, actual sources, trade-offs and unverified integration work.
- [Existing frontend guidelines](../../../../docs/development/FRONTEND-GUIDELINES.md): adopted development principles and the explicit low-test policy.
- [WebUI architecture](../../../../docs/development/WEBUI-ARCHITECTURE.md): current file map, recommended target, responsibilities and existing public interfaces.

Use links from AGENTS, development/state and verification entry points rather than duplicate the full guidance. Preserve existing product behavior/reference declarations; a visual or runtime migration requires its own scope.

### Recommend native React adoption, not an assumed compatibility layer

Astryx's pinned manifest requires React/React DOM >=19 and a StyleX runtime peer; the read Button uses React `use` and transition-driven actions. Preact preservation was an initial consideration, but the operator explicitly removed it as a requirement. React 19 + TSX + packaged Astryx is therefore the primary evaluation path. The maintained backend remains unchanged.

Precompiled consumption does not require adopting StyleX for all product source. Swizzle is an optional ownership transfer with its own compiler, shared-state and upgrade responsibilities. A new Vite/esbuild choice is not a permanent component-interface rule.

### Separate UI capability from product authority

Theme/primitives/patterns stay below features and platform. The application composes these; extensions use the same public slots and shared UI as built-ins. A typed client handles domain decoding; the existing service binds actor/resource and actual effects. Keep original request/operation/native-receipt identities distinct.

Prefer named public exports and native content composition over a universal component wrapper or schema renderer. A thin re-export intentionally inherits upstream types; do not call it a framework-independent abstraction.

### Keep the proposed file tree operational, not normative API

Show both the present `web/` sources and proposed `src/browser/{app,platform,features,ui}` layout. Preserve public facade paths while moving internals, only when a real slice is migrated. File names and counts are navigation aids, not compatibility contracts or a reason to generate source-path assertions.

### Test only when indispensable in this scope

The operator's early-WebUI-refactor instruction overrides Ockle TDD. Persistent tests need a distinct, uncovered external contract or high-risk failure that cheaper feedback cannot protect. Otherwise prefer types, builds, direct real-path checks and disposable exploration. Do not add one test/story/snapshot per component or remove existing safety coverage merely to make changes easier.

## Risks / Trade-offs

- **Recommendations mistaken for implementation** → mark runtime, directory, token and component-export targets explicitly; keep actual interfaces separately documented.
- **UI async completion mistaken for durable success** → document the observed Astryx `clickAction` boundary and retain feature/service-owned unknown reconciliation.
- **Open-source marketing mistaken for measured capability** → pin source identities, name read paths and separate official claims from trials not performed.
- **Too much process becomes another source of rigidity** → no invented product spec delta, no new toolchain or mandatory test templates, and no public promises for hypothetical consumers.
- **Source ownership shifts maintenance to Pakka** → prefer package consumption, use swizzle only for a demonstrated need and retain provenance/upgrade responsibilities.

## Delivery and Follow-up

This documentation change uses `skip_specs: true`; no product capability has changed. Validate changed documents, exact source/claim correspondence, formatting, links and the complete base diff. Preserve raw research/check evidence locally; commit only concise results and the whole bundle hash. Submit the independent branch to `dev`, without merging or releasing.

A later implementation task can use the report's bounded trial: real Pakka asset/runtime path, GUI-only and RSI consumers, shared renderer/portal/theme identity, and representative input/recovery behavior. This task does not mark that trial passed or pre-create its product artifacts.
