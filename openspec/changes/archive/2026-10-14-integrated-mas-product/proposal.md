## Why

M1–M5 have accepted library/worker and authenticated application paths, but the executable JSON server cannot yet install an optional DevPack. M6 must demonstrate one real product path from trusted startup and operator input to native agent tool calls, while fixing the supported combination matrix rather than inferring a product from separate green suites.

## What Changes

- Add optional, closed trusted-bootstrap configuration for approved instruction-only profiles and bounded per-profile DevPack grants, with no arbitrary tool/extension code or remote configuration.
- Reuse private-worker principal/invocation/ancestor grant checks in the executable server; do not build a second permission kernel or scheduler.
- Preserve the existing M5 no-DevPack mode. In DevPack mode, explicitly reject RPC spawn/configure/fork grants before storage startup until remote-owner-to-agent capability ceilings are supported; model descendants remain constrained by full owner ancestry.
- Verify actual compiled server/CLI and installed artifacts with optional tools, non-amplification, lifetimes, native receipts, budgets and normal reopen. Cover existing fixed multi-Session/worker consumers as distinct supported paths, not public RPC template allocation.
- Publish a product support matrix and GUI decision: no empty GUI app or fork is required for this headless slice. Dynamite remains deferred and not enabled.

## Capabilities

### New Capabilities

- `integrated-mas-product`: executable composition, fixed artifact pairing and explicit support/recovery limits.

### Modified Capabilities

- `authenticated-mas-apps`: trusted bootstrap may install approved optional DevPack profiles, with unsupported authority-amplifying combinations refused before startup; finite RPC and ordinary M5 mode unchanged.

## Impact

Private `apps/server` bootstrap/worker wiring and tests, isolated packaging consumers, executable defaults/support docs, and their OpenSpec boundaries. No new workspace package/app, native SDK import outside adapter, source patch, GUI, public broker transport, arbitrary templates, persistent account/token database or forwarding gate package.
