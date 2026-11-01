# Pi Durable 1.0.3-pakka.1 source patch

This directory defines a fixed downstream Pi Durable source build.
The patch adds generation rejection to the task's public hook contract; it does not change the
report-and-skip semantics of ordinary extension exceptions.

## Baseline and artifacts

- Upstream repository: <https://github.com/earendil-works/pi>
- Tag: `v1.0.3`; exact commit: see `baseline.json`.
- Source patch: `source.patch`, including upstream generation/recovery regression tests.
- Isolated build dependency lock: `build-lock.json` (the build uses `npm ci`).
- Downstream version: `1.0.3-pakka.1`.
- Installed artifact: `packages/agent/vendor/earendil-works-pi-durable-1.0.3-pakka.1.tgz`.
- SHA-256 and build identity: `artifact.json`.
- Pakka selects its production tarball via a locked `file:` dependency; see [the patch state](../../../docs/state/durable-patch.md). `npm run pack:agent` installs production
  dependencies in an isolated staging directory and bundles Durable, rewriting the packed manifest
  to the exact downstream version. Consumers receive the same implementation without install scripts
  or workspace overrides. Do not use raw `npm pack --workspace` on the hoisted workspace.

## Generation rejection and checks

The patched hook accepts `{ block: string }`, or `{ messages, check? }`. The first block wins;
subsequent hooks do not run. It atomically settles the run's placed submissions as
`unanswered(reason="blocked", detail=reason)` and completes the generation with `{ blocked: reason }`.
No assistant error entry is fabricated. Admitted user inputs remain committed.

`check` is a synchronous request-scoped callback re-run after all hooks and at the provider's
`onPayload` boundary. It is never serialized. Recovery runs hooks anew. This revalidates the source and lease at the request boundary.
A check rejection ends the generation as blocked; unrelated model/storage faults remain faults.

Pakka exposes intentional rejection via a projector plan:

```ts
binding.installProjector((frame) => ({
	status: "blocked",
	basis: frame.basis,
	reason: "policy denied",
}));
```

After `waitForIdle()`, the receipt has `state: "committed"` and
`generation: { status: "blocked", reason: "policy denied" }`; the Host stays ready.
Invalid projection protocols or storage uncertainty still latch Host failure.

## Rebuild and verify

From Pakka's root, provide a checkout at the **exact** upstream commit:

```powershell
npm run build:durable-patch -- C:/path/to/pi-v1.0.3 1.0.3-pakka.1
node scripts/verify-durable-patch.mjs 1.0.3-pakka.1
npm install --ignore-scripts
npm run check
npm test
npm run smoke:package
```

The script exports committed source to an isolated Git root, applies `source.patch` with `--check`,
installs pinned build inputs, compiles the package, runs generation/recovery/inbox/tools tests,
and packs it. It never edits the supplied checkout or an installed package. The build hash is
recorded; bit-identical output across different Node/npm/compiler versions is not promised.
The normal Pakka build verifies tarball, source patch and build-lock hashes, cleans stale `dist`
output, and compiles the production graph. Git attributes keep hashed inputs byte-stable across
Windows and Unix checkouts.

## Maintenance

Re-evaluate this patch if the upstream commit, hook result, generation checkpoints, run/submission
settlement, retry/recovery behavior, provider stream/payload callback, or dependency integrity changes.
Do not fuzz-apply to another release. Append a compatibility-ledger entry with the new evidence.

Replace the downstream package only when an upstream release supports equivalent block settlement
and request/payload revalidation, and the same local HTTP plus persistence/recovery tests pass.
An upstream `{ block }` that faults the Host, discards an admitted input, skips guard revalidation,
or calls the provider before rejection does not satisfy this contract.

The configured production transport is OpenAI-completions with retries and automatic compaction disabled.
Auxiliary inference retains its own allowlist, budgets and pre-payload source guard.
