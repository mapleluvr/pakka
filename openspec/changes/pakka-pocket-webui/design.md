## Context

Implementation has started from the proposal prepared over Pakka `90a235f` on `feat/monorepo-mas-migration`; P0 records are in [the source/native ledger](../../../docs/archive/webui/PAKKA-POCKET-P0.md). M1–M6 and the bounded optional Dynamite pair are accepted under their own artifact identities. P1 has now added controlled Conversation paging/display/job services, persistent people/invitations, the human workspace/profile ceiling and independent finite Pocket protocol/client exports; service evidence is in [the P1 record](../../../docs/archive/webui/PAKKA-POCKET-P1.md). P2 has added the actual `@pakka/webui` workbench, cookie/finite-v2 RPC, scoped SSE, one-use invitations/QR and explicit TLS-proxy transport, verified with real isolated browsers and installed executable assets (see `docs/PAKKA-POCKET-P2.md`). P3 now supplies public manifest/UI/components/client/backend exports, bounded commands/RPC and independently installed non-MAS examples, including persistent unknown initialization handling (see `docs/PAKKA-POCKET-P3.md`). Agent-facet product composition, complete UI adoption, MAS Board and measured launcher modes remain P4–P6 work. Existing v1 application consumers use a finite loopback RPC, not the complete pi-pocket product model.

The operator selected one product package, UI adoption without old data import, complete removal of pi-pocket subagent/PiP authority, multi-user/invitation/remote retention, trusted installed extensions, server-side visibility, custom backend RPC and custom Preact content. Slash commands default to human actions. These scope decisions are settled; the implementation choices below must not reopen them as excuses for a local-only or hardcoded-board delivery.

### Source baselines

| Input                  | Fixed reference                                                 | Role and evidence status                                                                |
| ---------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Upstream pi-pocket     | `TannerMidd/pi-pocket@de612d5622cdc66b6b8b4900c650c6f2efdf4c63` | MIT UI/product reference; package declares Pi/Durable cohort `1.1.0`                    |
| Native commands        | `mapleluvr/pi-pocket@2cb652c465f670ba8c66fc3ee639798caca8afbc`  | Phase 1 in issue #35 / PR #36; human dispatch, toast/card and operation semantics       |
| Native interfaces      | `mapleluvr/pi-pocket@58a4fdcc88ed755023aea9fac897735fca7396fe`  | Phase 2 stacked on Phase 1; custom Preact content, generation-bound RPC/assets          |
| Accepted Pakka runtime | `@pakka/agent@0.5.0`, Durable `1.0.3-pakka.1`                   | Public controlled ports and append-only compatibility record remain authoritative       |
| Existing product pair  | `docs/verification/DYNAMITE-PRODUCT-ACCEPTANCE.md`              | Optional static-member composition only; GUI does not expand that pairing automatically |

Read-only proposal research is under `artifacts/research/pi-pocket/`; executable P0 evidence is under `artifacts/pakka-pocket/p0/`, with [versioned source checks and notices](../../../integrations/pocket/README.md). These are not an installed or accepted product. P0 measured the unmodified main tree independently on Windows: install/check pass; 548 tests = 378 pass + 40 fail + 130 skip. Failures/skips stay recorded and are not promoted to Pakka acceptance. Phase 2 is a separate Durable `1.0.2` branch whose parent is Phase 1; it does not contain the main Durable `1.1.0` UI baseline. Source/tree/license checks and the common ancestor are fixed in `integrations/pocket/source-lock.json`.

## Goals / Non-Goals

**Goals:**

- Deliver the adopted Conversation/collaboration GUI as `@pakka/webui`, with multi-user, invitations and remote operation in the same completion scope.
- Make MAS Board an optional MAS DevPack contribution through public slots that another extension can also use.
- Let an extension supply settings or an arbitrary useful Preact interface, with human commands, backend work and typed clients as independent facets.
- Preserve native admission/lifetime/unknown/receipt semantics, server-owned identity and one writer per storage.
- Give extension authors concrete UI, protocol, lifecycle and testing conventions.

**Non-Goals for this change:**

- Plan mode and Goals/Done when, explicitly excluded by the operator. Park their provisional work for later removal and stop related implementation/acceptance; this exclusion does not affect scheduled inputs.

- Importing pi-pocket SQLite, identities, pending tasks or settings; retaining or replacing PiP with another privileged assistant.
- Running existing Pi CLI/TUI extensions unchanged; a PTY bridge, untrusted marketplace/sandbox or arbitrary global monkey-patch compatibility.
- Upgrading Durable, copying pi-pocket's runtime alongside Pakka, changing Dynamite algorithms or automatically enabling strategies on newly created members.
- Declaring every upstream workflow migrated without a mapped real backend and a tested consumer.

## Decisions

### D1. One product artifact with pure SDK entry points

Plan `apps/webui` as the source location for package `@pakka/webui`, retaining the repository's app/composition-root convention. This is one package/executable/asset delivery, not a second `pocket` product plus an empty UI-SDK package. Public subpaths for extension declarations/components are browser-safe and inert; backend-only contracts have separate exports. P3 fixes `extension`, `ui`, `components`, `client` and `backend` public subpaths through DOM-only/NodeNext consumers and real separately located examples. The loader remains independent of MAS; Agent installation requires the explicit approved-profile composition consumer in P4.

The single-product requirement needs a narrow dependency-rule exception: an optional extension facet may peer-depend on the product's documented pure SDK subpaths, never its executable, router/store, backend startup or private source. `@pakka/agent`, `@pakka/mas` and existing root Agent-only DevPack imports do not depend on the Web product. The host loads selected facets by public descriptor; it does not statically import the MAS Board. An installed consumer checks there is one Preact instance and no browser-to-Node/Pi import edge.

Alternative: a new extension-SDK package would simplify naming, but adds a release unit before a second product consumer exists and conflicts with the chosen single-product start. Alternative: copying internal UI imports into plugins would make refactoring a hidden breaking change. Neither is adopted.

### D2. Adopt UI and interaction contracts, not PocketHost

The upstream `PocketApp` owns a raw Harness, SQLite, native tasks and broad `PocketHost` services. Its command context exposes `Tx`/snapshot and its loader installs native Durable extensions. Those APIs cannot enter Pakka outside the adapter. Adopt reusable Preact/htm layouts, renderers, themes, interaction patterns and tests, adapting all data/action access.

The basic shell consumes generic Conversation DTOs and person-scoped commands. `Session` continues to mean Pakka storage/commit scope, `Conversation` means the agent's transcript/context; an upstream UI label called session does not redefine either ID. MAS-specific member/ownership views live in the plugin. WebUI and app metadata never become a second native scheduler or a reader/writer of native JSONL/SQLite.

Conversation/tool projections, display-only entries and controlled long-job support may need new adapter ports. P0/P1 of the plan must prove their feasibility against the pinned public Durable API before the GUI adopts them. If the public API cannot support a needed boundary, propose a versioned patch/spec delta with evidence; do not import private APIs or relax admission checks.

### D3. Human authorization is not Agent invocation authority

Persist people, invitation/redemption records, role/resource scope and session invalidation in the product's own controlled metadata namespace. Bind a fresh current human actor at request/stream admission, and recheck current role/resource/driving permission before controlled effects. Never persist a WeakMap capability or trust browser user/source/grant strings.

Use owner, scoped driving/operator and viewer distinctions, plus explicit service action permissions. Installation/configuration administration is owner-only initially; an invitation to steer does not authorize installing server code or minting stronger invitations. Agent creation/configuration/fork in a contribution-enabled product must establish a real actor-to-Agent ceiling, not bypass the M6 startup refusal. The old v1 path keeps its accepted refusal until independently extended.

People who can drive tools have the practical reach of those tools on the host. Application scope is not an OS sandbox. A trusted backend extension is also not contained against malicious host access. These are separate from the correctness requirement that normal service queries/actions enforce current scope.

### D4. Separate Pocket protocol/client path; preserve v1 defaults

Add explicitly negotiated Pocket request/result/event schemas and a separate browser client export in the existing protocol/client packages. Do not change `createClient` from loopback dedicated-token semantics to ambient cookie auth. Existing v1 decoders keep rejecting unknown fields/commands; new Pocket operations have closed host envelopes and per-extension registered action schemas, not an unchecked arbitrary-RPC escape hatch.

The Pocket backend composes public controlled services; reusable server logic is extracted to its owning public service/port or a documented composition export only when a second consumer exists. It must not import a sibling app's private `src` path. An extension backend gets identity-bound service closures and scoped JSON storage/job ports, not raw adapter/runtime or credentials.

Cookies are for the explicit browser product, with session rotation/revocation, CSRF and Origin checks, finite body/concurrency limits, validated origins and a configured proxy trust boundary. Invitation/initial-owner links are exchange flows; secret-bearing values are removed from navigation after redemption and excluded from logs, broadcasts and exports. Authentication remains independent of provider credentials.

### D5. Retain remote modes without widening the headless listener

Preserve local, LAN, tailnet and public-tunnel launcher workflows. Local remains the default. Approved external HTTPS termination forwards only from a configured trust boundary; arbitrary forwarded Host/Proto headers are not accepted. Plain HTTP LAN, if retained for upstream parity, is an explicit insecure trusted-network mode with truthful disclosure, not a public confidentiality claim. Tailnet encryption does not grant application roles.

Do not download/install tunnel binaries or open public tunnels during automated tests. Use real local HTTP/HTTPS proxy fixtures and independent browsers for core remote semantics; provide an operator-run check for the actual configured tunnel tools. Simulated tunnel URLs do not prove Cloudflare/Tailscale connectivity. Their acceptance matrix must distinguish automated transport/security coverage from measured host-deployment evidence before declaring those modes supported.

Alternative: ship a single-user local UI first and call migration finished. Rejected: the operator explicitly retained multiplayer, invitations and remote in this scope. Dependency stages may develop locally, but final acceptance cannot omit them.

### D6. Scoped read model plus bounded SSE

Add human-authorized Conversation entry/tool/activity/receipt views from the controlled owner. Read permission is distinct from MAS send/discover. Strip credentials, private config, host objects and unapproved tool payloads before serialization; files/changes/browser/approval routes receive their own resource/action checks. If public broker receipts are exposed, close the exact endpoint/namespace provenance gate before publication; JSON shape alone is insufficient.

Use SSE initially because upstream interaction patterns fit it; WebSocket is not required for the current product. Streams have server/resource incarnation and scoped cursor identity, bounded buffers, gap/resnapshot behavior and per-resource ordering, not a global cross-Session revision. Subscribe/snapshot handoff must prevent gaps; role changes invalidate server subscriptions and browser caches. No mutation is replayed on reconnect. An expired cursor requires a fresh authorized snapshot.

Persist human chat/notes/pins/reactions with explicit conflict rules and attribution; keep presence ephemeral. Human-side content and display cards do not enter model context by default. UI metadata has one owning writer; a write to product metadata and a Durable effect are not claimed to be one atomic transaction. Their operation record preserves partial/unknown outcomes.

### D7. Multi-facet registration and public composition slots

An extension has identity/compatibility metadata and optional Agent, Backend, WebUI, Client exports. Facet selection is independent of code trust and of per-person business authorization. Installing UI alone must not add model tools; Agent-only imports must remain headless.

The public WebUI API covers navigation entries, routes/pages, Conversation panels, settings entries, sheets, command/action registration, approved reads/subscriptions, notifications and shared primitives/tokens. These are sufficient for both MAS Board and an unrelated GUI-only example. The host owns authentication, routing namespace, focus/navigation, error/loading boundaries and interface instance lifetime. Custom Preact content is ordinary code, not a mandatory schema form. No MAS-specific slot privilege or core store is introduced.

Internal application composition can evolve separately, but MAS Board is not allowed to depend on internal layout overrides. Public slots that cannot express a real Board interaction are improved in the host rather than bypassed by a built-in flag.

### D8. Human commands, RPC and model effects have explicit semantics

Typed slash input, suggestions and buttons invoke one command identity. Every action declares resource scope, permissions, argument/result schema, finite deadline policy, mutation/read classification and whether it intentionally submits model work. Reserved built-ins/templates keep deterministic precedence; collisions are rejected, not overwritten.

Results distinguish private notice, shared display-only card, opened interface and accepted job/receipt. Cards need a controlled display-only append/projection with zero model contribution and unchanged head/requester; inspect the next real provider payload. Browser command history and operation logs are not secret-entry forms. Private configuration uses dedicated replace/clear behavior and never round-trips saved secrets.

Backend RPC has a closed extension/action/version envelope and per-action finite schemas. Mutating actions persist stable actor/resource/request/payload identity before controlled dispatch. Known local pre-effect refusals can report denied; opaque callback failures, lost responses and uncertain effects remain unknown. Do not blanket-map error classes/status codes to no-effect denial. Long work returns a controlled job/receipt; arbitrary unknown handlers are not replayed after restart.

### D9. Registration generation is not a business transaction

Prepare/validate names, facet dependencies, schema versions and asset fingerprints before publishing a generation. Disabling/replacement invalidates new discovery/RPC/subscription use; an already-admitted operation keeps its receipt and is not undone by unmount/uninstall. Live authority checks constrain late controlled effects.

Retain the old generation after failed preparation only if its installed state and bytes are confirmed unchanged. Agent/backend installation may have partial/unknown effects: expose unavailable/unknown and reconcile, rather than promising atomic multi-facet rollback. Trusted module import side effects are not rolled back by the loader.

Assets are accepted finite types under a real public root, with path/link/junction/traversal checks and content fingerprints. Do not serve changed bytes under an old generation or publish backend/private files. Interface callbacks bind both generation and open-instance identity. Old ESM modules cannot be revoked; require an explicit refresh when necessary and clean host-owned resources. Never claim full hot replacement of arbitrary same-origin globals.

### D10. MAS DevPack supplies the Board

Extend DevPack through optional public facet exports/peers. Its backend composes current MAS ports; client bindings provide checked DTOs/actions; its Preact interface adapts useful upstream board components. It displays only authorized members, native readiness alongside persisted membership phase, real ownership/lifetime and original receipts. It never maintains SubagentsDoc/reporters/couriers or fabricates generation success.

Closing or disabling the UI removes its contributions/subscriptions, not members or business jobs. Member abort/retirement remains a distinct explicit authorized command. No PiP replacement or hidden owner assistant is created. A non-MAS interface must be tested through the same loader/slots to disprove a board-only implementation.

## Risks / Trade-offs

- Upstream Durable `1.1.0` APIs do not match Pakka's cohort → port DTO/service seams first; keep imports and installed dependency inventory fail-closed.
- The upstream product has more workflows than the current headless surface → maintain the screen/action inventory and stage backend mappings; no decorative or silently removed controls in a completion claim.
- Trusted code can access host/same-origin state → explicit trust model, no sandbox claims; still test normal endpoint authorization and secret handling.
- Plugin replacement or proxy failure can leave real effects → stable operation identities and receipts; retain unknown/spent budget, never compensate by guessing.
- A public SDK in a product package can create dependency cycles → pure subpath peer contracts, separate facet imports, browser/Node graph tests and installed consumer.
- Raw card/asset content can cause XSS or secret leakage → safe text/Markdown/artifact rendering, CSP/MIME policies, private-setting discipline and two-user canary tests.
- Negative dispatch alone may hide absence of work → pair real effect counts with positive admission/refusal/job/read-model evidence and captured state.
- A source manifest can omit a gate script → independently enumerate changed/untracked inputs, imported helpers and delivered assets; reject omissions and corrupted archives before execution.

## Migration Plan

Execute P0–P6 in [the original preparation plan backup](../../../docs/verification/DOCUMENTATION-CLEANUP.md#备份与恢复), using [WebUI development rules](../../../docs/development/WEBUI-DEVELOPMENT.md). Each stage first adds real failing boundary cases, then minimal implementation and affected gates. P2 created `@pakka/webui` with its actual executable, assets and installed consumers. Do not archive this change as implemented until the actual product and all required scenarios pass.

Rollout uses an explicit new product entry/data directory and opt-in extension configuration. Headless v1 and accepted artifact identities remain available. Normal reopen restores durable business and people records but issues fresh runtime authority. Reverting code does not undo writes, model/tool effects, redeemed invites or consumed quota; version migrations and recovery must retain receipts and refuse uncertain state. Disabling MAS UI is not a resource rollback.

## Open Questions

No unresolved product-scope approval remains from the clarification. The following are implementation investigations with stage deadlines, not invitations to reduce scope:

1. P0/P1: prove the smallest public adapter read/display/job ports and actor-to-Agent ceilings; record any required API/patch delta before coding around it.
2. P0 resolved: adopt `de612d5` UI and use `58a4fdc`/`2cb652c` only as independent command/interface references. The exact commits/trees and divergent ancestry are checked; never adopt floating main/branch HEAD. The observed upstream failure baseline is retained.
3. P1/P2: fix export names, JSON schemas, concrete finite limits, metadata schema and reload protocol through a compilable independent extension consumer. No TypeScript sketch in this preparation is a shipped SDK.
4. P2/P5: record which actual remote launcher tools/platforms are measured, and supply reproducible operator checks where public infrastructure cannot run in deterministic tests. Do not label an untested mode accepted.
