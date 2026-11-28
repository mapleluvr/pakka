# Independent WebUI and public plugin consumption

## Why

The operator has selected a WebUI product published independently from the Pakka monorepo. RSI, MAS and Memo must implement their visualization, business controls and pipelines through public plugin contracts rather than domain-specific WebUI core code.

The History worktrees contain useful implemented capabilities but are reference candidates, not a released product or a mandatory restructuring baseline. Earlier handoff material mixed generic host requirements with RSI report/state semantics; these need separate ownership.

## What Changes

- Adopt independent WebUI delivery and business-owned plugins in state/development rules.
- Describe generic public plugin capabilities and independent consumer acceptance.
- Keep RSI original-work contributions and report/state separation in a downstream design document; do not freeze its unimplemented API.
- Save existing History/EI candidates on their corresponding branches by operator authorization, without PR, merge or publication.

## Impact

Documentation, planning and candidate branch handoff only. Existing product/test bytes are preserved. This change does not relocate apps/webui, implement the new report model, rebuild Board, start GUI verification or authorize all remote implementation. Future SDK/service changes require actual public capability analysis and independently fixed consumers.
