# Change: MAS Board relationship workbench

## Why

MAS members already have native Conversations and admission receipts. The workbench needs persistent creation and communication provenance, authorized navigation, and direct live activity projections to make their relationships usable.

## What Changes

- Persist creation source, fork provenance, message body, time, actual initiator and explicit reply association alongside existing native catalog transactions.
- Expose permission-filtered, bounded Board, activity and paginated history projections.
- Add a generic host Conversation source registry for ordinary authorized navigation, read, configuration and native input.
- Deliver a square-card relationship canvas, member list, personal layout controls, exchange log and recoverable member controls.
- Keep user-facing lifetimes internal to MAS and preserve original admission and unknown-effect semantics.

## Impact

Affects `mas-devpack`, the MAS catalog/control DTOs, the WebUI generic resource registry and installed-package consumers. Legacy records keep missing provenance unknown. Public Pi 1.0.3 APIs and the existing runtime are retained.
