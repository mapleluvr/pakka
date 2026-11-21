# Distinguish MAS A2A Communication Intent

## Why

The A2A API has one native delivery operation, while collaboration needs three explicit meanings: `inform` contributes information without asking for a reply; `request` asks for a concrete deliverable or decision; `response` is an answer tied to one real request receipt. Treating all three as generic messages obscures wakeup behavior, reply provenance and completion claims.

The existing public `RuntimeContextSource` can provide bounded text and a synchronous dispatch check, but it exposes neither an identity for the exact host `GenerationTask` nor a lifecycle callback proving that task completed. Passive contributions must therefore remain pending/at-least-once; projection or generation success cannot be reported as model understanding or consumption.

## What Changes

- Add compatible `MasClient.inform()` and `lookupInform()` operations, an additive `inform` grant, and explicit optional host `RuntimeContextSource` registration.
- Persist passive contributions under bounded identity, target/profile, permission, idempotency and capacity checks. They do not create native input, a GenerationTask, a wakeup or an acknowledgement.
- Project source-labelled, untrusted contributions only into that target's later natural request; keep the durable status pending because the public context-source lifecycle cannot confirm consumption.
- Keep `send()` as the native request operation. Restrict each root request to one explicit, receipt-linked response; retries reuse the same response identity and a new request ID cannot extend the exchange.
- Add optional `mas_inform` DevPack tooling and distinguish its instructions from request/response; preserve existing send, `mas_ask`, prompt/steer/followUp signatures and native placement.

## Impact

`@pakka/mas`, `@pakka/mas-devpack`, their focused deterministic tests, and the MAS state/API/DevPack/OpenSpec documentation. No Durable API or private adapter changes.
