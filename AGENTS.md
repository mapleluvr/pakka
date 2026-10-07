# Pakka

- Public Pi 1.0.3 SDK only. No Pi source patches, private imports, or monkey patches. Configuring a public callback slot while preserving its existing callback chain is supported adapter wiring, not permission to replace SDK methods or private members.
- Pi mutable objects stay inside `packages/agent/src/pi-adapter.ts`; callers receive frozen DTOs and identity-bound command closures only.
- Do not call host epoch `treeRevision`; do not silently replace native steering/follow-up with serial prompts.
- Test first against real Pi with local deterministic HTTP providers. Never read user credentials or call paid models in tests.
- Unknown persistence or tool side effects must fail closed; never release an admission merely because abort was requested or text appeared in clearQueue().
- This is a headless integration slice, not full developed-Kappa compatibility. Keep limitations explicit.
