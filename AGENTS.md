# Pakka

- Public Pi SDK only; no private imports or monkey patches. A version-pinned Pi Durable downstream source patch is allowed only with its baseline, reproducible build, regression tests and append-only record in `docs/PI-DURABLE-COMPATIBILITY.md`. Never modify an installed dependency by hand. Configuring a public callback slot while preserving its existing callback chain is supported adapter wiring.
- Pi mutable objects stay inside `packages/agent/src/durable-adapter.ts`; callers receive frozen DTOs and identity-bound command closures only. The former AgentSession adapter is a test oracle in `packages/agent/test/pi-adapter.ts` and must not enter the production dependency/import graph.
- Do not call host epoch `treeRevision`; do not silently replace native steering/follow-up with serial prompts.
- Test first against real Pi with local deterministic HTTP providers. Never read user credentials or call paid models in tests.
- Unknown persistence or tool side effects must fail closed; never release an admission merely because abort was requested or text appeared in clearQueue().
- This is a headless integration slice, not full developed-Kappa compatibility. Keep limitations explicit.
