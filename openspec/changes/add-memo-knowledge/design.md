# Memo knowledge-service design

The issue proposes a dedicated SQLite domain. Adopt it for Wiki, revisions, grants, source registrations, changes and actor/request receipts. This database is distinct from Pi/Runtime storage, so its implementation uses Node's public SQLite API directly. Runtime mutable objects remain within the existing agent adapter.

Every mutation uses one immediate transaction with current authorization and version checks. The receipt shares that transaction. Publication failure after commit yields unknown; querying a prior receipt does not grant new effect authority. History is appended per record and exposed in pages. Markdown import retains page identity and the original base revision.

The host provisions libraries and binds actor checks. Source providers separately authorize sharing into a named library and reading each reference. Registry updates preserve fixed-version addresses. Async reads compare exact returned reference/range, current library/source authorization and registry generation before publishing content.

Discovery scans a materialized, bounded authorized metadata window before Wiki body matching. Source-local search is called through the same authenticated cursor; non-searchable sources are skipped in bounded batches. Provider entries are capped conservatively to fit the encoded response budget. AES-GCM cursors bind actor/query/database and conceal private continuation state. Search quality and actual Dynamite/History Book representation require separate evidence.

The core service does not depend on MAS. Native tools bind a trusted current invocation through a separate subentry. Persistent Patchouli consumes the same contracts through native invocation-bound scoped clients. Its independent run rows preserve original route and dispatch identity, with SQLite claim-before-send; response loss only performs pure MAS lookup. A business finish can be empty and is separate from a generation terminal state; advancing also verifies the member is idle. Timers require explicit process-local start. The host policy authorizes the complete fixed research scope, including private context accumulated across turns. Knowledge plus persistent librarian does not close the whole issue.

Tests exercise real Memo SQLite and deterministic native Runtime calls. New Memo files are heavy until reviewed. Select Memo scope plus daily core; no need to rerun unrelated maintenance suites unless shared implementation changes.
