## 1. P0 — Source inventory and native feasibility

- [x] 1.1 Pin the adopted pi-pocket tree and Phase 1/2 ancestry, retain code/font licenses and per-file provenance, and record a fresh upstream failure baseline without promoting reported counts.
- [x] 1.2 Expand the migration inventory into actual screens/actions, their service owner and required real consumer; enumerate every old subagent/PiP production edge for removal.
- [x] 1.3 Add real pinned-Durable failing probes for committed Conversation/tool observation, display-only append with unchanged head/requester, and controlled background job/cancellation support.
- [x] 1.4 Prove human action-to-native-effect/Agent-profile ceiling requirements; record any necessary public API/patch delta before using the new path.

P0 evidence/decisions: `docs/PAKKA-POCKET-P0.md` and `integrations/pocket/README.md`. Core 263/263, source/native feasibility 8/8 and actual installed consumers pass. Upstream 378 pass / 40 fail / 130 skip remains a failing source baseline. Actor/profile ceiling implementation and the controlled job service remain P1 tasks; current v1 restrictions are unchanged. No product completion or independent P6 review is inferred from these checks.

## 2. P1 — Controlled services and versioned contracts

- [x] 2.1 Implement and test the smallest adapter-owned sanitized Conversation/activity read ports, with explicit human read permission and no raw storage readers.
- [x] 2.2 Implement and test controlled display-only records and long-job/receipt ports, retaining unknown outcomes, native ownership and single-writer rules.
- [x] 2.3 Define people, role/resource scope, invitation redemption/revocation and browser-session persistence with expiry, concurrency and normal-reopen regressions.
- [x] 2.4 Implement tested actor-to-Agent profile ceilings for Pocket create/configure/fork; keep unsupported combinations refused and preserve the v1 guard.
- [x] 2.5 Add negotiated finite Pocket request/result/event schemas and an isolated browser client entry while keeping existing v1 imports/defaults compatible.
- [x] 2.6 Verify exact broker receipt endpoint/namespace provenance before any new public publication path; otherwise keep that path unexposed and explicit.

P1 service evidence: `docs/PAKKA-POCKET-P1.md`, full 296/296 and actual installed `scripts/consumer-pocket-services.mjs` (1 local HTTP; original admission/budget/job/identity preserved on reopen). v1 consumers also pass. The protocol exports finite v2 schemas; actual network negotiation, sessions and streaming remain P2. No new public broker publication route was added: the exact provenance gate stays required before P4 uses cross-Session receipts. No Web product or independent P6 review is inferred.

## 3. P2 — Actual Web product and multiplayer transport

- [x] 3.1 Create the real apps/webui consumer as @pakka/webui with executable/assets, explicit configuration, isolated data and workspace/build/check/pack coverage.
- [x] 3.2 Port the generic Conversation shell, navigation/composer and committed transcript/tool rendering without MAS-specific core state or original PocketApp authority.
- [x] 3.3 Implement people/invitation/QR/sign-in and role-sensitive controls through the real product, with concurrent one-time redemption and revocation tests.
- [x] 3.4 Add explicit local/remote configuration, browser sessions, CSRF/Origin and trusted-proxy/TLS boundaries without widening headless v1.
- [x] 3.5 Add server-filtered bounded SSE snapshot/cursor handoff, resource incarnation, gap/resnapshot and role-change invalidation with slow/disconnected browser tests.
- [x] 3.6 Complete basic prompt/native steer/followUp/receipt actions through two authorized browsers and an unauthorized browser using deterministic local providers.

## 4. P3 — Public extension host and independent consumers

- [x] 4.1 Fix manifest/version/facet and public SDK/component exports using an independent type consumer; verify one Preact runtime and browser/backend/Agent import isolation.
- [x] 4.2 Implement staged registration, collision/compatibility checks, facet activation/removal and explicit partial/unknown installation handling.
- [x] 4.3 Implement one human-command dispatcher for typed slash, suggestions and buttons with checked scope/schema, private notices, display cards, interfaces and native receipts.
- [x] 4.4 Implement namespaced backend RPC/client bindings, permission rechecks, scoped settings/CAS, finite deadline/job policy and persistent request/payload reconciliation.
- [x] 4.5 Implement public navigation/page/panel/settings/sheet slots, host-owned focus/error/loading state and instance-bound late-result cleanup.
- [x] 4.6 Implement generation-bound asset acceptance/serving and reload-failure tests including changed bytes, traversal, symlink/junction and old-instance calls.
- [x] 4.7 Deliver GUI-only and backend-setting examples installed unchanged through public exports; verify their actual behavior, typed/tapped parity and no implicit model input/secret leakage.

P3 intermediate evidence: `docs/PAKKA-POCKET-P3.md`, full 332/332, focused 22/22 and installed public examples pass. The Backend/WebUI/Client host, command dispatcher, scoped CAS/reconciliation and public containers are implemented. Tasks 4.2/4.5 were subsequently completed by P4's actual approved Agent composition, independent facet removal and member-panel consumer. Task 4.4 was subsequently completed by P5's actual installed native scheduled-input contribution, with stable request reconciliation, due-time authority, cancellation and reopen checks; this does not claim remaining combinations are accepted. No P6 independent review or complete product clearance is inferred.

## 5. P4 — MAS DevPack workbench facets

- [x] 5.1 Add optional public DevPack Backend/WebUI/Client exports and peers without altering the headless Agent import graph or automatically enabling tools.
- [x] 5.2 Bind current human MAS observation/actions and checked subscriptions to the same public extension service interfaces used by the independent examples.
- [x] 5.3 Port reusable board/bar components into MAS Board/member/ownership/lifetime/receipt views, removing every original subagent/PiP production authority edge.
- [x] 5.4 Exercise actual model-tool creation and human Board send/steer/reply/abort/retire paths with positive native result/refusal evidence and cross-user filtering.
- [x] 5.5 Verify Board removal/old generation/late callbacks clean only interface resources, preserve members/history/admitted jobs and leave the basic workbench usable.

P4 intermediate evidence: `docs/PAKKA-POCKET-P4.md`, full 343/343 plus the added fixed-profile/removal regression, final focused 22/22, unchanged-production identity and installed actual executable/Chrome consumer (8 local HTTP). A separate headless install contains/resolves neither WebUI nor Preact. Original native receipts/history, scoped viewer responses and spent quota are inspected independently. This is not the final P6 review or complete P5 UI/deployment acceptance.

## 6. P5 — Complete adopted UI and deployment workflows

- [x] 6.1 Port side chat/presence/notes/pins/reactions and turn-taking with conflict/attribution tests and captured proof that human-side content is not implicit model input.
- [x] 6.2 Port files/changes/branches/worktrees/uploads/exports/artifact views to approved services, testing real isolated files, scope/path bounds and safe rendering.
- [x] 6.3 Port approval and browser panels to real controlled pending-call/browser services, including unauthorized/late decisions and actual action results.
- [ ] 6.4 Port settings/model/budget/notification and remaining mapped optional interfaces, with private configuration handling and real subsequent behavior checks.
- [ ] 6.5 Verify normal reopen, persisted people/revocation, original operations and spent quotas; test disconnect/lost response and interrupted jobs without unsafe replay.
- [ ] 6.6 Complete local/LAN/tailnet/tunnel launcher checks with actual proxy/TLS fixtures and recorded operator measurements for external deployment tools; do not claim mocked connectivity as support.
- [ ] 6.7 Close the per-screen/action inventory and run desktop/mobile/keyboard/accessibility inspections against the development rules, leaving no decorative or silently removed control.

P5 intermediate evidence: `docs/PAKKA-POCKET-P5.md`, full 387/387 and all isolated-install consumers pass. Installed collaboration/files use 2 local model HTTP; installed approval/browser controls use 4, with two independently counted page effects and no repeated effect after lost-response reconciliation. Exact-source single-writer merge, wrong-person/resource/revocation checks, nested unknown preservation and owned-service cleanup are recorded. The later settings/private-provider checkpoint passes focused 16/16, full 408/408 and every installed consumer with 406 frozen source/helper/TLS assets unchanged. The real CLI selects the approved model, replaces/clears its key, retains scope and charged attempts across two reopens (1 provider HTTP, 3 charged attempts); lost writes recover through reads, not replay. The notification checkpoint passes focused 21/21, full 419/419 and every installed consumer with 421 frozen files unchanged: actual CLI/worker/TLS and native completion use 2 provider HTTP and 3 push requests, while unknown delivery never replays after reopen. Independent FCM measurements and lost-registration read recovery are retained separately. The genuine native-notification click remains unverified: a script-constructed NotificationEvent lacks native lifetime/activation and is not acceptance. The native scheduled-input checkpoint passes focused 33/33, full 437/437 and all installed consumers with 435 frozen source/helper/TLS files unchanged. Its actual CLI uses 2 model HTTP and 2 spent attempts, preserves original jobs across normal reopen and WebUI removal, and reconciles a lost response without re-entering work. Eight installed archives match their lock integrity; equivalent checkpoint data and unknown input admission retain unknown without repeating effects or dispatching the next occurrence. Task 4.4 is complete; 6.5 remains open for recovery across the remaining product workflows. The memory checkpoint passes 38 focused and 464 full cases, all installed consumers and 450 unchanged source/helper/TLS identities: scoped human approval, native model proposals, current context omission, conflicts and two lost-result recovery paths use 5 model HTTP and 5 spent attempts with one native tool result, and WebUI removal preserves stored records. Eight actual archives match lock integrity. One original pre-login startup deadline remains an unexplained P6 investigation: three instrumented trials and the fresh complete install passed without changing production/driver bytes or the deadline; all original failure evidence is retained. The signed Webhook/ordinary ingress checkpoint passes 31 focused and 489 full cases, all installed consumers and 469 unchanged source/helper/TLS identities. Its actual CLI uses 3 provider HTTP and 3 spent attempts, verifies HMAC, body replay prevention, key rotation, viewer isolation and normal reopen; removing only WebUI preserves the approved Backend ingress. Eight actual archives match lock integrity. Late permission/generation changes block admission, while already queued native input survives interface closure. Remaining optional interfaces, deployment/inventory closure and P6 acceptance stay open; 6.4 is not checked. Markdown lint is deferred per operator instruction.

## 7. P6 — Evidence, bounded review and delivery

- [ ] 7.1 Pass clean install/build/type/format and affected full/focused/legacy consumer gates with no skipped mandatory cases; retain original baseline failures separately.
- [ ] 7.2 Install exact product/runtime/extension artifacts outside the repository and drive executable, browsers and public declarations without workspace paths/root overrides or a second Pi cohort.
- [ ] 7.3 Independently enumerate every changed/untracked candidate, gate/helper and delivered asset in the source identity; test omission/corrupted archives before build/install and retain positive state/effect/privacy evidence.
- [ ] 7.4 Complete at most two designated 90-minute adversarial review/fix passes with both full opinions/disputes/closing, using protocol-preserving infrastructure recovery only.
- [ ] 7.5 Sync actual API/deployment/development/support docs, record exact delivery identity and residual findings, strictly archive only after product acceptance, then commit without implicit publication.
