# Tasks

- [x] Inspect the operator brief/draft, public profile consumers, Server/worker serialization and Pi Skill discovery contract from the assigned Git worktree baseline.
- [x] Ship a versioned portable Skill and public archive export, without global installation or a Coding Agent dependency.
- [x] Add independently selectable, default-off reasoning/communication options and shared Skill-derived prompt sections.
- [x] Preserve existing grants configuration while wiring per-profile selection through public composition, Server JSON and worker IPC; reject invalid serialized selections.
- [x] Preserve human final-audience readability, exact syntax/semantic anchors and current A2A inform/request/root-response behavior.
- [x] Extend focused default/independent/combined, real profile, worker, removal and serialized-validation coverage; validate the installed public Skill/types and real tool consumer.
- [x] Update MAS state, API, guide, overview, change record and delta spec.
- [x] Complete formatting, strict OpenSpec/link/diff checks, final self-review and evidence summary.
- [x] Parent direct review of the complete staged candidate and evidence; no separate subagent review was run.
- [ ] Parent-owned remote delivery and OpenSpec archival when appropriate.

## Test classification and scope

`packages/mas-devpack/test/telegraph.test.ts` is a focused prompt-composition boundary: default identity, independent/combined selection, shipped-section reuse and no profile-selection leak. It imports the real package graph and remains in the default heavy category; it does not run inference or assert a prose snapshot or performance claim. Existing `devpack.test.ts` and `boundaries.test.ts` remain heavy and cover real native tool calls, passive inform, cancellation/unknown and profile removal. Existing `apps/server/test/devpack-worker.test.ts`, `product.test.ts` and `worker-validation.test.ts` remain heavy: actual separate-PID profile assembly and ancestor authority, product JSON bootstrap, no inherited contribution, plus the serialized malformed-option matrix. Their distinct service boundaries justify retaining them. The existing affected `webui` mapping already covers these paths, and all remain in release; no test-selection edit or addition to core/light is needed.

The selected six files passed 25/25 tests with zero failures, cancellations or skips. `scripts/consumer-devpack.mjs` now checks the installed Skill export, selected prompts, native tools, revocation and temporary worker behavior with eight deterministic loopback HTTP requests; `scripts/consumer-types.ts` exercises the new public options for future complete package gates. A separate clean archive probe checks installed public types through `WorkerManagerOptions.placements[string]`, the actual exported worker configuration seam.

The full workspace build and `npm run check` passed on the final CRLF-normalizing candidate. A local copied-module fixture verified that CRLF Skill text yields the same selected guidance without editing installed dependencies. The targeted clean consumer used five built archives (Agent, MAS, DevPack, Protocol and Server), independent dependencies and HOME, `npm install --ignore-scripts` followed by `npm ci --ignore-scripts`; installed Skill bytes matched source and package directories were not symlinks. Pi's public `loadSkills`/`formatSkillsForPrompt` accepted the installed Skill without diagnostics and excluded it from automatic model advertisement. An initial probe attempted to import the non-exported `WorkerConfiguration`; it was corrected to the existing public manager type and rerun successfully without a product API change. Logs and limitations are retained with the [verification record](../../../docs/verification/MAS-TELEGRAPH.md).

This is a bounded prompt/packaging/configuration change. The full release suite, complete product installation/GUI/platform gates and unrelated MAS storage fault tests were not selected. The previously reported `unknown.test.ts` SQLite lock failure is neither rerun nor claimed fixed. No paid/external-model benchmark ran; this authorized Worker session is a qualitative writing-style trial only.
