# Design: generic host, business-owned plugins

## Adopted boundary

pakka-webui is an independent product/release. It owns shared UI containers/components, resource navigation, controlled connections/commands/operation observation and plugin lifecycle. Business plugins own their pages, adapters, domain workflows and pipelines. Domain services retain their objects, authorization and persistent effects.

Default assumption: public plugin capabilities are sufficient for RSI, MAS and Memo without core coupling. A failed domain case is not proof of a host capability gap. First inspect public consumption; propose a minimal generic capability only if it is demonstrably insufficient.

## Handoff separation

- docs/requirements/WEBUI-PLUGIN-CAPABILITIES.md: generic capabilities, public install/graph/lifecycle and non-domain consumer acceptance.
- docs/requirements/RSI-WORK-REPORTS.md: approved contribution/report/state intent and unselected downstream API details.
- docs/changes/history-reference-branches.md: existing candidate scope, exact source baselines, verification meaning and reference-only branches.

Persistent Session/Conversation references support generic navigation. RSI links its work, MAS owns communication, Memo owns library/research, and Dynamite owns Book. References do not confer authority. Browser viewing is separate from work execution; retaining a process/session/writer is not dictated by repository count.

## Evolution and verification

The current apps/webui remains old implementation/compatibility input, not a forced layout for the independent product. Public SDK/transport versions and independent install consumers establish supported combinations. No private workspace imports, hidden router/store branches or another UI runtime may replace public plugin capability.

Normal persistent handoff, limited reads and independent effects are the initial consumer scenarios. Stronger in-flight authorization guarantees remain subject to their separately adopted object contracts; adding a Promise wrapper does not automatically justify another business ACL layer.

No new runtime or UI code is implemented in this planning slice. Future GUI and report/service validation must use their actual fixed candidates; mocks and branch pushes are not acceptance evidence.
