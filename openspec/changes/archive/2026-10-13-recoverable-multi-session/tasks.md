## 1. Coordinator storage

- [x] 1.1 Run real Durable JSON CAS/reopen/authority/capacity/poison tests red and implement frozen bootstrap store ports.
- [x] 1.2 Fix public versions and preserve Session/projection/legacy behavior under the new store seam.

## 2. Broker enrollment and delivery

- [x] 2.1 Add explicit managed Session ports and durable reservation/readiness/activation, with interruption recovery and no duplicate allocation.
- [x] 2.2 Add principal/source-bound outbox delivery, lost receipt reconciliation, reply and stale identity/revocation/capacity negatives across real Sessions.

## 3. Workers

- [x] 3.1 Add actual apps/server worker/manager private validated IPC and approved template/storage ownership.
- [x] 3.2 Exercise two real processes, duplicate writer refusal, controlled exit isolation, graceful reopen and unknown/crash-claim refusal.

## 4. Acceptance

- [x] 4.1 Verify all changed production paths, full regression, active diagnostics and installed tarballs with local HTTP/storage artifacts.
- [x] 4.2 Use the operator-selected adversarial-review workflow; resolve concrete findings within bounded rounds, document residual limits, commit and archive only after acceptance.
