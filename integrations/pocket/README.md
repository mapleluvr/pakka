# Pakka-Pocket source and native feasibility

This is the executable P0 evidence path, not an installed WebUI or a claim that the migration is finished. Product scope and sequencing remain in [the Pocket plan](../../docs/plans/PAKKA-POCKET-PLAN.md).

## Immutable sources

[The lock](source-lock.json) distinguishes two divergent trees:

- Adopt UI from `TannerMidd/pi-pocket@de612d5622cdc66b6b8b4900c650c6f2efdf4c63` (`pi-durable@1.1.0`).
- Inspect commands/interfaces from `mapleluvr/pi-pocket@58a4fdcc88ed755023aea9fac897735fca7396fe` (`pi-durable@1.0.2`), whose immediate parent is Phase 1 `2cb652c465f670ba8c66fc3ee639798caca8afbc`.
- Their common ancestor is `096b7e198cb69846ce91ca45a18d144f688d478e`; **Phase 2 does not contain the newer adopted UI baseline**. Do not substitute one for the other or claim that Phase 2 was already merged into that baseline.
- Neither upstream cohort is installed into Pakka. Production keeps the pinned `pi-durable@1.0.3-pakka.1` and its existing build/patch gates.

Code and font notices are retained byte-for-byte in [licenses/](licenses/). Every adopted asset must retain its own source/blob/SHA and notice; this directory is not permission to relabel the whole upstream tree as Pakka-authored.

## Reproduce

From the Pakka repository root, create the two ignored source checkouts. Fetch the three exact commits without depth truncation, not a floating branch. Do not execute their application or use user credentials.

```powershell
$root = 'artifacts/pakka-pocket/p0'
New-Item -ItemType Directory -Force $root | Out-Null
git init "$root/upstream-source"
git -C "$root/upstream-source" remote add origin https://github.com/mapleluvr/pi-pocket.git
git -C "$root/upstream-source" fetch --no-tags origin de612d5622cdc66b6b8b4900c650c6f2efdf4c63 58a4fdcc88ed755023aea9fac897735fca7396fe 2cb652c465f670ba8c66fc3ee639798caca8afbc
git -C "$root/upstream-source" checkout --detach de612d5622cdc66b6b8b4900c650c6f2efdf4c63
git init "$root/pi-pocket-source"
git -C "$root/pi-pocket-source" remote add origin https://github.com/mapleluvr/pi-pocket.git
git -C "$root/pi-pocket-source" fetch --no-tags origin 58a4fdcc88ed755023aea9fac897735fca7396fe
git -C "$root/pi-pocket-source" checkout --detach 58a4fdcc88ed755023aea9fac897735fca7396fe
```

`upstream-baseline.mjs` first verifies source commit/tree/licenses and a clean worktree (including rejection of untracked inputs), then runs upstream `npm ci --ignore-scripts`, check and tests in a fresh isolated HOME/AppData/temp/data profile. Its environment excludes inherited credentials and user npm configuration. It uses the selected Node/npm, not `npx node`, and never upgrades Pakka. On the measured Windows baseline its exit is **1**, not a passing Pakka gate.

```powershell
node integrations/pocket/upstream-baseline.mjs
node --test integrations/pocket/source.test.mjs
node integrations/pocket/source.mjs "$root/upstream-source" "$root/pi-pocket-source" "$root/source-inventory.json"
node --test --test-concurrency=1 integrations/pocket/native-jobs.test.mjs packages/agent/test/conversation-observation.test.ts packages/agent/test/conversation-observation-safety.test.ts
```

The inventory uses Git blob bytes, not a raw copy of a dirty checkout. The AST parser is the **upstream lock-installed TypeScript 6.0.3 public API**, explicitly resolved from its isolated installation. Pakka's TypeScript 7 root exports version metadata only; this tool neither downgrades it nor reaches into unstable/private compiler APIs.

## Results and what they establish

[The original baseline](upstream-baseline.json) records **548 = 378 passed + 40 failed + 130 skipped**, no cancelled/todo, on Windows/Node 24.18.0. Install and check passed. Failures and skips are preserved, not fixed or counted as acceptance. Raw logs are under `artifacts/pakka-pocket/p0/`. Faux-provider upstream results do not substitute for the real pinned-Durable production path.

`source.mjs` emits per-file modes/blob IDs/SHA-256/lengths and AST call/route/old-authority candidate locations. The initial primary inventory contains **259 files, 364 call locations, 113 route conditions, 880 candidate authority references**. These are lexical/AST inventory counts, not counts of distinct user features or confirmed vulnerabilities. [The adoption map](adoption-map.json) assigns all **61** upstream Web modules exactly one owner, scope, effect policy and real acceptance path. The generated action locations stay associated with those module owners; generic store/API endpoints are mapped by the service ledger in [the P0 record](../../docs/archive/webui/PAKKA-POCKET-P0.md).

The committed adapter tests exercise actual `createRuntime`/Harness, real local provider HTTP, real live tool execution and native storage:

- Scoped, frozen committed transcript/tool/live/usage DTOs; no system/config/provider identity or credential fields.
- No new work or storage commits from reading. Revoke is checked after asynchronous native watch cleanup, immediately before publication.
- Idempotent, actor/namespace/Conversation-bound display-only writes, concurrency/reopen/conflict/finite-capacity rejection.
- Cards/chat have zero model contribution, do not advance the model head or replace the original requester, and are absent from the next actual provider request even when written during a tool run.

`native-jobs.test.mjs` is **test-only feasibility** of the public locked Durable API: waiter cancellation rejects with the exact cancellation reason without cancelling work; explicit task abort has a terminal native receipt; committed checkpoints continue after close/reopen without replaying prepare. It does not expose native task objects to application/extensions and is not a production long-job service. P1 must bind such a service to actors, limits and effect-time checks. The earlier scratch `native-jobs.log` is superseded: its waiter-cancellation assertion accepted an unrelated API error; only the corrected exact-reason run and committed test count as evidence.

## Human authority decision

The new read/display ports take bootstrap-owned checks, not browser-supplied permissions. A UI command will need a current human/resource/profile check at each controlled effect. MAS send/discover is not human read authority. Existing DevPack-mode v1 startup refuses RPC spawn/configure/fork grants; keep this guard until P1 proves an explicit person-to-profile ceiling. A generic owner check or `profile: "approved-name"` is not sufficient to bypass it.

Native mechanics above need **no new Durable patch**. People/session metadata, actor/profile ceilings, finite Pocket protocol, event streams and the controlled long-job interface remain P1/P2 work. Broker native receipts are not newly published; the exact endpoint/namespace gate remains closed until verified. No WebUI package, second Harness/SQLite writer or original subagent/PiP backend is introduced by P0.
