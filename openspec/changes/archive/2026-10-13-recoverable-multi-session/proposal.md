## Why

M2 limits MAS to one Durable Session. A broker needs independently owned Sessions and actual worker processes while preserving persistent enrollment, recipient admission/deduplication and honest unknown recovery across interruption; a second Harness alone is not process isolation.

## What Changes

- Add a bootstrap-only bounded JSON coordinator store to the agent runtime, persisted on its existing Durable commit line with CAS and Session poison semantics. No Pi/Tx handles escape.
- Add `@pakka/mas/broker` ports and principal-bound clients for explicit Session placement, two-phase enrollment/activation, persistent outbox and target-side receipt reconciliation.
- Add actual `apps/server` worker bootstrap/manager and private validated IPC with one writer per storage. Model/provider/config/storage choices remain trusted bootstrap presets.
- Preserve exact logical Session/Conversation/incarnation/request identities over restart. Ambiguous enrollment/delivery stays unknown; expired or removed history never silently permits fresh admission.
- Version new public boundaries and verify source plus external tarballs. Existing same-Session APIs remain available. Dynamite remains deferred.

## Capabilities

### New Capabilities

- `recoverable-multi-session`: durable coordinator state, multi-Session enrollment/delivery and controlled worker isolation/reopen.

### Modified Capabilities

None. Same-Session creation/admission, Context authority and legacy journal mapping retain their existing requirements.

## Impact

`packages/agent` controlled store/adapter; `packages/mas` broker service and ports; `apps/server` executable worker manager; workspace/build/check/test/installed consumers; migration/support documents. No new scheduler, no cross-Session transaction or exactly-once external effect claim; no private Pi imports or automatic stale writer lock theft.
