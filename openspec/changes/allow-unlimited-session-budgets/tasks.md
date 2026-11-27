## 1. Session policy

- [x] Reproduce the prior positive-only protocol, runtime and HTTP failures; check required/omittable public bootstrap types.
- [x] Accept zero while retaining aggregate accounting, independent positive caps, authorization, CAS, complete request receipts, and finite policy on reopen.
- [x] Cover bootstrap decoders, direct and batch creation, navigation forks, primary/auxiliary dispatch and recovery using synthetic local fixtures.

## 2. Public consumers

- [x] Pair services 5 / workbench 3 and fixed public archives. Keep storage, headless v1 and extension wire versions unchanged.
- [x] Give the independent frontend the actual policy values; display and save zero normally. Verify the old frontend fails early and old writes have no effects.
- [x] Build in a clean frontend consumer; install all eight Pakka packages outside both repositories; use the normal launcher and browser to verify stored policy and a lost receipt before/after restart.

## 3. Delivery scope

The operator authorized paired PR preparation and one independent reviewer using zzz-codex/gpt-6-astra:xhigh. Local 8854 deployment uses the verified pair; existing Session budgets were explicitly set to zero with counts retained. Key results and the local evidence-bundle identity are in [verification](../../../docs/verification/SESSION-BUDGET-UNLIMITED.md). The single reviewer completed the full paired review with PASS at WebUI 38b9306 and Pakka 7ab5025. Only review/verification records were added afterward; product sources and paired artifacts remain unchanged. Both PRs can proceed to normal review. Merge, registry publication and OpenSpec archival are separate.
