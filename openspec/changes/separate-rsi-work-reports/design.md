# Original work, report versions and explicit current decisions

## Durable objects

A work relation fixes ticketId, ticketAuthorId, contributor actorId, contentRevision, ConversationRef and optional runId. Manager registration binds an approved current handler to an existing exact Conversation and content revision. New dispatch registers the relation with its original run plan atomically; the run ID identifies that work. Work version/allowed only govern future contributions; assignment cannot rewrite the relation or cancel the native run.

Reports record their original author, the actual author of each fixed body revision, work, original content revision and process reference. Append returns a unique report ID. ReviseReport is report-local CAS and preserves the old fixed versions. Report head, immutable version, index signal and original actor/request receipt commit atomically. Neither append nor revision writes ticket head/version/state. Different report additions do not compete on unrelated ticket versions.

Ticket setState is an explicit current manager/handler decision using ticket expectedVersion. It records a state-changed event; saving or reading a report never adopts it as a conclusion. Historical reported events and their old ticket receipts are preserved as old facts, not recast as new work/report objects.

## Authority and consumption

A contributor with current valid handler identity can contribute to registered allowed original work after ordinary reassignment. Original work and its immutable revision are readable to that contributor, the ticket author and manager; current assigned handlers can consume reports for the current ticket. This is not a future-ticket-content grant. Reader identity can read its own existing work/report but cannot add/revise. Null role or failed actor.check refuses new operations. Explicit manager setWorkContribution uses work-local CAS and only disables future write effects; old reports/receipts remain.

Each operation snapshots its input before decoding and uses that one snapshot for checks and writes. Authorization is tied to object/operation boundaries, not repeated merely because a helper adds await. Commit CAS includes the work version to prevent a concurrent durable contribution stop from being missed. Existing ticket mutation publication protections are preserved, not redesigned by this slice.

## Data placement and limits

All objects use the owning Runtime/namespace records and public finite transactions. Current heads, fixed report versions and request keys are separately addressed. Report lists return bounded metadata/reference pages, not all bodies; readReport loads one exact body. Lists bind cursors to Session/namespace/actor/query and stream boundary; new report additions do not enter an existing continuation. Summaries show each report’s current version when read; immutable content is requested by that report ID/version, not inferred as a frozen whole-list snapshot. Maximum report body is 12,000 UTF-16 units, 8 links and 8 result references; full JSON size must remain below 180 KiB so one fixed report is independently readable. Cumulative report/work count is not an execution-lifetime limit.

## Handoff

Report is saved first. A separately authorized optional RSI/MAS pipeline sends a fixed report-version reference and original Conversation reference to an explicitly approved destination. Handler ID is not an address or MAS authority. Notification intent/checkpoint and delivery receipt have independent outcomes from report publication; cross-domain work is reconciled by stable identity, not a presumed multi-database transaction. Unknown send performs lookup only, never automatic resend or substitute member creation. GUI does not own this workflow.

## Validation

Real SQLite/Runtime tests begin with H revision 3 → J revision 4, two H reports, no ticket mutation and no access to J future content. Additional boundaries cover spoofing, report CAS, original-request concurrency, explicit stop, fixed versions/pagination, reopen, real storage failure and legacy history. Deterministic native tools/MAS and external install consumers confirm actual effects and passive reopen. The short real-SQLite original-work/report fault file is core and heavy; native/MAS, history and notification cases are heavy affected-rsi files; old tests are adapted or removed only when their independent fault remains covered. Paid model/GUI checks are not selected.
