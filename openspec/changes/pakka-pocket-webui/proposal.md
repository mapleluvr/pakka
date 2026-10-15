## Why

Pakka has an accepted headless runtime, MAS, DevPack, protocol/client and optional Dynamite product pair, but no Web workbench. The operator has selected pi-pocket as the UI/product starting point, with multi-user collaboration, invitations and remote access retained. Its own subagent runtime and PiP must be removed rather than becoming a second authority. Its native-command and custom-interface work provides a concrete starting point for extensions that create their own interfaces.

## What Changes

- Prepare one product package, `@pakka/webui` (Pakka-Pocket), from pinned pi-pocket UI sources with license/provenance retained; do not import old user data or upgrade/duplicate the accepted Durable runtime implicitly.
- Keep the basic Conversation workbench usable without MAS. Remove pi-pocket subagent/PiP dispatch, persistence and privileged assistant paths; reuse useful board components only inside the MAS DevPack WebUI contribution.
- Add versioned optional Agent, Backend, WebUI and Client facets. Public slots must support commands, settings, custom Preact sheets/panels/pages, navigation and subscriptions, with MAS Board as a real non-privileged consumer. Adding a plugin constitutes trusting its code, not granting every application user its operations.
- Add authenticated scoped Conversation/activity read models and live updates, plus multi-user roles, invitations and explicit remote deployment. Preserve the existing headless v1 loopback entry and fail-closed authority/receipt semantics; remote support is a new explicit product path, not a widened default.
- Make slash commands human-invoked by default: no model input/inference or change of current requester unless the chosen action explicitly submits work. Allow namespaced backend RPC with checked schemas, scope, deadlines and honest retry outcomes.
- Establish GUI/extension development rules and executable acceptance through real installed server/browser paths, synthetic identities, deterministic local providers and retained source/asset identity.

## Capabilities

### New Capabilities

- `pakka-pocket`: one adopted Web product, basic committed-state workbench, source/license provenance, public UI extension surfaces and actual installed consumption.
- `webui-extensions`: optional multi-facet trusted extensions, human commands, custom interfaces, namespaced backend/client bindings and generation-bound lifecycle.
- `pocket-collaboration`: multi-user identity, scoped collaboration, invitations, remote access, authorized read models and reconnectable live updates.

### Modified Capabilities

- `authenticated-mas-apps`: retain the v1 headless loopback contract while adding an explicitly negotiated Pocket remote path, scoped readers and actor-bound authority without copied capabilities.
- `mas-devpack`: add optional Backend/WebUI/Client contributions for MAS Board and member/receipt controls through the same public slots available to another trusted extension; retain optional Agent tools and native ownership semantics.

## Impact

Planned implementation touches `apps/webui` (`@pakka/webui`), controlled observation/command ports in `@pakka/agent`, browser-safe protocol/client entry points, optional `@pakka/mas-devpack` exports, reusable server composition, tests and packaging. The product package may expose pure public SDK subpaths for extension peers; no extra SDK/forwarding package is created just to satisfy the diagram. Backend and browser graphs stay separate. No raw Pi objects leave the adapter; no old SQLite/task data, Pi CLI extension compatibility layer, PiP replacement, hostile-plugin sandbox or automatic model/credential discovery is included. The initial preparation created specifications/plans only. Implementation has now completed P0 source/native proofs and P1 controlled services (people, workspace, read/display/jobs and independent v2 protocol/client); P2 has now added the actual WebUI product/executable, multiplayer browser/Cookie/RPC/SSE workbench and TLS-proxy tests. Complete UI adoption, extension host and MAS Board remain later stages. Stage records are in `docs/PAKKA-POCKET-P0.md`, `docs/PAKKA-POCKET-P1.md` and `docs/PAKKA-POCKET-P2.md`; unchecked tasks remain unimplemented.
