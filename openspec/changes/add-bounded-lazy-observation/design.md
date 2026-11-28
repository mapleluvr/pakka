# Bounded observation and content design

## Adopted behavior

Use 333 ms as a maximum refresh cadence for changed state and small tool previews. Complete native contents remain authoritative and available. Collapsed/offscreen details create no full DOM; expanded text/history use a finite virtual window. Optional full retrieval is separate from full memory residency/rendering. Idle fill is throttled, cancellable, single-flight and byte-budgeted.

## Read path

Cold management/history observation reads small state and bounded archival projections, not `Conversation.context()` or a full `Conversation.watch()` tree. Existing strategy frames keep their complete canonical semantics at their explicit execution/read boundary. Existing complete SDK snapshots remain available; add preview/content DTOs rather than silently returning truncated data from an old complete API.

A preview carries original resource/source Entry, message/part/field, native call/status/error, size, truncation and content version. Live argument/error projection is byte/node/depth-bounded too. An unreferenced inline/live value is preview-only: copying or searching it cannot claim a complete source, establish source absence, or grant an original-content capability. After a valid published reference exists, original operations use that exact version. Partial bytes require a fixed version, ordered ranges and final completeness; a source-truncated native output is not relabelled complete stdout. Authorization binds current person and exact destination/fork visibility before reads and again after awaits.

The current pinned Durable entries API decodes full record JSON. To bound pre-decode work, inspect the public storage interface and add a separately versioned reproducible metadata/range seam if required; use a bounded, rebuildable projection cache. Its failure is not permission to replace the authoritative record or clear a writer. Large records are scanned/decoded in bounded units; no eager cold backfill of the entire archive.

## Observation

Share change/version work per resource where possible, coalesce at 333 ms and publish only changed small projections; no-change heartbeat stays small. Keep response queues bounded under backpressure and recheck read authority. Long streams have separate admission accounting from short controls; the browser origin connection-pool issue remains visible and must not be claimed solved by server accounting alone.

## Browser lifecycle

Tool cards retain `(Session, destination Conversation, source Conversation, call ID)` across live/committed handoff. A collapsed card creates only summary nodes. Explicit opening loads bounded body/arguments/media; virtual rows maintain source positions and focus/scroll anchoring. Part details, arguments and image decode have distinct budgets. Unknown/denied/stale/missing reads do not discard drafts, submit model input or cancel the tool.

Cache starts at 8–16 MiB with byte LRU, scoped to server/person/resource/version and held in memory. Idle fill starts after stable content and two seconds without interaction, visits visible/expanded/nearby ranges, uses one 64 KiB chunk at a time around 128 KiB/s, and pauses for input/new output/pressure/navigation/revocation. These are initial tunables verified on actual product; the design does not promise sample percentages.

## Geometry implementation

History uses the fixed `@tanstack/virtual-core` 3.19.11 kernel as its single measurement/scroll model. Standard source build creates a browser ESM bundle with esbuild 0.28.2 and a production `NODE_ENV` definition; shipped code, input hashes and the retained MIT license are recorded in the build artifact. Installed dependencies are not edited, and normal startup does not run a bundler. Items are absolutely positioned in the kernel-sized canvas; a mounted subset cannot redefine the total DOM scroll geometry. Native scroll anchoring is disabled for this owned timeline, so it does not compete with the kernel. Original resource/row keys and one focused off-screen item remain stable. Prepend/append anchoring and late measurements are handled by the core; the integration accounts separately for the preceding history controls and banner.

The initial hand-written normal-flow spacer/measurement implementation is not delivered. Its large-cache regression exposed coupled range/scroll feedback and its bookmark lost position after sibling controls changed; those failing fixtures and probe results remain under the execution/verification record rather than weakening the scroll/focus assertions.

## Validation

Tests fail first at real storage/runtime/HTTP/browser boundaries. Check 14 MB entries, Unicode split ranges, hidden/foreign/fork identities, permissions revoked during reads, live-to-committed identity, collapsed DOM absence, virtual row/byte limits, full reconstruction, idle cancel and unchanged heartbeats. Compare exact installed candidates and the same isolated long-history fixture using ego lite, recording CPU, RSS/heap, bytes, latency and DOM. Keep old failures and tool versions attached to their original candidates.
