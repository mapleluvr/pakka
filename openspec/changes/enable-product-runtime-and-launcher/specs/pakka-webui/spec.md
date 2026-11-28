# WebUI product delta

## Default shell entry

Running pakka with no client-protocol arguments starts the WebUI. Model/provider configuration uses native Pi configuration and is available outside first-run onboarding. An unselected model does not prevent opening the workbench or its settings. Normal launch and reopen do not generate model requests.

Automatic HTTP port selection must publish an address usable by Fetch and browsers. If the operating system allocates a blocked port, close that listener before bounded reselection. An explicitly blocked port is refused rather than changed silently; no browser or system protection is disabled.

## Session identity and failure

A saved control Session is reopened, not replaced. An unavailable registered child Session does not prevent healthy children from opening. Unknown creation/ownership is not automatically retried, replaced or unlocked. Shutdown closes owned resources before releasing ownership.

A current global Session creator may explicitly reopen a confirmed registration that has no retained Runtime. Missing, corrupt or foreign storage stays unavailable without creating replacement data, clearing a writer lock, changing the registered identity or replaying input. An already-ready instance is returned without reopening it. Sealed retained Runtimes and unconfirmed cleanup require their existing recovery procedure, not another open. Authority is rechecked before publication; an acquired Runtime remains owned until its cleanup is confirmed. Public diagnostics are finite states, never upstream error bodies.

- A broken child and a healthy child can coexist while the workbench serves the healthy child.
- Restoring the original child database permits an explicit same-identity open with history and consumption preserved.
- An unknown registration cannot be promoted by reopening, even if a database happens to exist.
- A viewer or scoped administrator cannot start a Session-wide recovery operation.
- Workspace settings show unavailable registrations alongside healthy Sessions. Leaving settings preserves an unconfirmed opening request; reading the current directory does not resubmit it or establish who completed it.
- A confirmed opening response followed by a failed directory refresh remains confirmed. The UI requires a new status read before another opening attempt based on stale availability.
- Closed native ownership retires its passive notification timer; repeated opening attempts retain at most one monitor reference per registered Session.

## Literal slash input and registered commands

The composer sends unregistered slash text verbatim through the ordinary input path. Exact registered commands retain their dispatcher: invalid JSON/schema, disabled registrations and execution failures never fall through to model input. An unavailable command directory is not treated as an authoritative empty directory; possible command arguments remain in the draft until discovery recovers. Paths and other syntactically non-command slash text do not require command discovery.

## Standard local agent

The product composes an explicit local execution preset for its approved directory. The default preset registers native read/write/edit and PowerShell on Windows or Bash on POSIX; the read-only preset registers only read. File edits and commands have actual observable effects through ExecutionEnv. Command children receive a positive environment list, not ambient model credentials or process startup hooks. This preset is not an OS sandbox. SDK callers that omit execution still obtain no implicit tools.

Each generation discovers local instructions and skill/template indexes through the public Pi loader at the current approved Conversation cwd. A read-only native settings view excludes package resolution, extension execution and MCP configuration. User settings retain their original bytes; skill/template bodies are not automatically injected merely because they appear in the index. A directory change invalidates the old binding and subsequent context follows the new directory.

The protocol client and advanced trusted-host configuration remain available. Explicit local recovery requires an original recorded identity or an explicit original reopenSessionFile; it never creates a Session without that identity, clears a live writer, replaces missing storage, reissues the original owner credential or replays model input.
