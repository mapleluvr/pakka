# RSI original work and independent reports

## Why

Reassignment changes current responsibility, not the existence of H's original work. The old report operation combines historical contribution, current state and ticket-head CAS, preventing H from saving original results after J takes over. The operator authorized this headless slice after saving the History reference branches.

## What Changes

- Persist trusted work relations with contributor, original content revision, actual Conversation and optional run identity.
- Save reports independently, with report-local versions, original request receipts and bounded lists. Split current state decisions into setState.
- Keep future ticket content access distinct from original-work access. Explicit contribution withdrawal and identity deactivation remain separate from assignment.
- Compose optional MAS report handoff after saving, preserving fixed addresses, messages, requests and original-delivery reconciliation.
- Update ordinary Agent/Backend/client consumers and provide a headless workflow/example. Legacy reported events retain their historical meaning; incomplete old attribution is not invented.

## Impact

RSI service/storage and its downstream consumers. MAS and Runtime are consumed through public APIs, with no upstream feature request or Board change. The new report signature is a deliberate development-candidate contract change: legacy payloads do not silently become state decisions. Existing stored ticket receipts and events remain readable. Independent WebUI/GUI and cross-Session host implementation are outside this slice. Base is reference candidate 170aa153e7dad0cda8f6172665d709407dfa703a, not a released migration baseline.
