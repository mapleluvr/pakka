## ADDED Requirements

### Requirement: Explicit execution environment binding

The host SHALL accept a version-identified, bootstrap-approved execution environment binding, route selected native tools through the public Durable environment interface, and preserve the selected binding in reopen configuration checks. Environment acquisition failure MUST prevent dependent model dispatch and MUST NOT select ambient host execution.

#### Scenario: Native tools use the selected environment

- **WHEN** a local deterministic provider calls selected write/edit/read or command tools
- **THEN** their observable files, working directory and output belong to the bound environment and the Conversation records the real tool results

#### Scenario: Required environment is unavailable

- **WHEN** the configured environment cannot be acquired
- **THEN** generation is explicitly blocked before HTTP, input settlement is retained and no fallback file or command effect occurs

### Requirement: Invocation-bound execution capabilities

Cooperating tools SHALL obtain only frozen data and command capabilities bound to the current invocation. Native Pi handles MUST remain inside the adapter. Canceling one invocation MUST NOT close an independent environment; resource-owner cleanup MUST await the actual cleanup contract before releasing ownership.

#### Scenario: A retained capability is used after the tool ends

- **WHEN** a tool retains or copies its invocation access and tries another file or command effect after its invocation has ended
- **THEN** the effect is refused and the original file or process state remains unchanged

#### Scenario: Two Conversations execute concurrently

- **WHEN** two Conversations use different approved working directories
- **THEN** identical relative paths resolve independently and an operation cannot overwrite the peer environment binding

#### Scenario: Configuration changes or is reopened

- **WHEN** an approved cwd/profile changes, or storage is reopened with a different execution configuration identity or native tool selection
- **THEN** new work uses a fresh binding for the current target, old invocations cannot act, and mismatched reopen is rejected before model dispatch

#### Scenario: A tool returns while an operation is already running

- **WHEN** a tool starts an execution operation but returns before awaiting it
- **THEN** new operations are refused, already-started operations settle before the tool is released, and invocation handles are closed

#### Scenario: Native edit is revoked while reading

- **WHEN** reload revokes an invocation while native edit awaits a read
- **THEN** the old invocation cannot write the replacement, and known scope revocation alone is not classified as unknown execution effects

### Requirement: Known execution ownership and effects

An acquired driver SHALL remain owned until actual cleanup succeeds, including an acquired driver rejected for target mismatch. Unknown execution effects MUST fail closed without automatic replay, even when the tool catches the immediate error.

#### Scenario: An acknowledgment is lost after a file effect

- **WHEN** a driver performs a real write and reports an unknown result
- **THEN** the effect remains observable, the Host fails closed, and no subsequent model request or automatic repeated write occurs

#### Scenario: Reader reports an unknown or unrecognized error

- **WHEN** an opened reader returns an unknown result or unrecognized error envelope
- **THEN** the Host fails closed under the same rules as an ordinary execution method, even if the tool catches the error

#### Scenario: Cleanup or cancellation is not completion

- **WHEN** cleanup fails or an admitted operation has not yet settled after cancellation
- **THEN** ownership is not released merely because cleanup/abort was requested, and the writer remains protected until the actual completion contract permits closure
