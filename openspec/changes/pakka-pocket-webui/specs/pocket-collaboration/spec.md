## ADDED Requirements

### Requirement: Persistent people and scoped invitations

Pakka-Pocket SHALL retain multi-user access, people/role management and revocable finite-use invitation links/QR flows. Server-bound people SHALL map to current principals and explicit all-approved-resource or selected-resource scope. The server SHALL control role delegation, one-time redemption, expiry, revocation and session invalidation; supplied user/role/source fields SHALL NOT grant authority.

#### Scenario: Invitation races and normal restart

- **WHEN** two browsers redeem the same one-time invite concurrently, and the product later closes and reopens
- **THEN** at most one redemption grants its declared scope, persisted revocations remain effective and old runtime capabilities are never restored from stored fields

### Requirement: Extension installation requires product administration

Extension installation SHALL be restricted to the authorized product administrator, not every invited operator.

#### Scenario: Extension installation requires product administration

- **WHEN** An invited operator attempts to install executable facets
- **THEN** Installation is refused unless the current person is the authorized product administrator.

### Requirement: View send steering and administration remain distinct

The product SHALL distinguish viewing, communicating, driving/steering and managing resources. A viewer SHALL NOT cause model/tool effects or approve a call; a scoped operator SHALL NOT expand their visibility or select profiles that amplify authorized Agent grants. Native task ownership and human collaboration roles SHALL remain separate. Any actor-to-Agent profile operation SHALL establish a tested grant ceiling before being enabled.

#### Scenario: Operator selects a stronger profile

- **WHEN** a user with limited authority attempts a create/configure/fork action selecting a stronger approved profile
- **THEN** the effective grant ceiling constrains the result or the action is rejected before allocation/inference; a UI click cannot bypass the existing product guard

### Requirement: All observation is authorized at the server

Snapshots, transcript/tool views, search/exports, approvals, receipt lookups, extension discovery/RPC/assets and live events SHALL be filtered before serialization by current person, resource and role. Unauthorized resources and sensitive fields SHALL NOT be sent for the browser to hide. Revocation SHALL stop future reads/events and late controlled effects; it does not retract bytes already delivered or sandbox trusted executable code.

#### Scenario: Viewer follows a guessed resource and reconnect cursor

- **WHEN** a scoped viewer requests a peer Conversation, receipt, extension operation or event cursor outside their scope
- **THEN** no peer payload or private configuration reaches the response, event stream or export, including after reconnect and role changes

### Requirement: Human collaboration does not become model input

The shared human layer SHALL retain presence, side chat, mentions, notes, pins/reactions and driving/turn-taking workflows with explicit ownership/conflict behavior. These display/collaboration operations SHALL NOT become model input unless an action explicitly sends selected content. Presence is ephemeral; durable collaboration records SHALL have declared resource scope and consistent writes.

#### Scenario: Concurrent edits and turn change

- **WHEN** collaborators update the same note or change the driver while another command awaits admission
- **THEN** conflicts are explicit and effect-time driving permissions apply; side chat and presence do not create hidden model requests

### Requirement: Scoped committed-state streaming and reconnect

Conversation entries, tool activity, receipts and extension/collaboration events SHALL use sanitized immutable DTOs derived from the owning controlled service. The stream SHALL declare server/resource incarnation, cursor and snapshot reconciliation rules, with bounded buffering/backpressure. A stale cursor SHALL cause an authorized resnapshot, not a guessed cross-Session revision or automatic mutation replay.

#### Scenario: Slow disconnected subscriber

- **WHEN** an authorized browser disconnects or exceeds the retained event window while work continues
- **THEN** it reconnects to a fresh authorized snapshot, correlates original operation identities and neither misses authority revocation nor causes another provider dispatch

### Requirement: Explicit remote modes with real transport protection

The product SHALL retain local, LAN, tailnet and public-tunnel access workflows through an explicit Pocket entry/configuration. The existing headless listener SHALL remain loopback by default. Public remote access SHALL require HTTPS at an approved termination boundary; any plain-HTTP trusted-LAN mode SHALL be explicit and accurately disclose its lack of confidentiality.

#### Scenario: Spoofed proxy origin and genuine remote connection

- **WHEN** an untrusted request spoofs forwarding/Origin headers, or two browsers connect through the approved remote termination path
- **THEN** spoofing cannot bypass authentication/CSRF/scope, while the genuine connection can redeem an invite and share authorized live state without exposing provider credentials

### Requirement: Remote transport policy covers every product surface

Cookie/session, CSRF/Origin and trusted-proxy rules SHALL apply to HTTP, SSE and extension assets without trusting arbitrary forwarding headers.

#### Scenario: Remote transport policy covers every product surface

- **WHEN** A request for RPC, SSE or an extension asset carries untrusted forwarding headers
- **THEN** The same current session, CSRF, Origin and trusted-proxy boundary applies before any authorized content is returned.
