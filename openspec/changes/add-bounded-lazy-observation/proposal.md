# Change: Bounded lazy Conversation observation

## Why

Long durable tasks retain complete history, but cold WebUI opening, repeated full snapshots and hidden full tool DOM make archival bytes determine resident memory and observation cost. Large individual records also defeat count-only paging. The operator adopted 333 ms coalesced previews, on-demand full contents, lazy/virtual DOM and budgeted idle fill after controlled long-history and high-frequency tool-output experiments.

## What Changes

- Separate cold browser observation from execution context and complete strategy frames.
- Add byte-bounded preview and identity-bound chunked content reads without replacing full SDK reads or authoritative stored records.
- Coalesce changed observations at 333 ms; send small no-change heartbeats rather than repeated full contents.
- Lazily create tool details/media, virtualize long history/text, and bound memory cache/idle fills.
- Preserve permissions, fork/call/source identities, receipts, unknown states and source truncation.

## Impact

Agent adapter/runtime, browser-safe protocol/client, WebUI HTTP/observation and frontend. If needed, a separately versioned, reproducible Durable source patch supplies public metadata/raw-range reads. Independent worker isolation and process-wide OOM recovery are not completed by this change.
