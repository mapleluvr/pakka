# Pakka-Pocket third-party notices

Pakka-Pocket adapts the pi-pocket Web workbench, interaction patterns, theme/CSS and fonts from Tanner Middleton's pi-pocket. The adopted UI baseline is `TannerMidd/pi-pocket@de612d5622cdc66b6b8b4900c650c6f2efdf4c63`; command/interface design also references `mapleluvr/pi-pocket@58a4fdcc88ed755023aea9fac897735fca7396fe` (issue #35 Phase 2).

The original MIT copyright and permission notice is retained in `LICENSE.pi-pocket`. The included JetBrains Mono font and its SIL Open Font License are retained together in `web/fonts/`. Dependency code (Preact, htm, marked, DOMPurify and QRCode) is consumed from the exact declared npm packages and retains their respective package licenses.

The Devin-like shell is Pakka-authored against the static reference `mapleluvr/devin-ui-comparison@ed20cec` (`clean-room/current`). The included Inter variable font is redistributed under the SIL Open Font License in `web/fonts/Inter-OFL.txt`. No Devin production bundle, production stylesheet, authenticated dump, organization data or screenshot is shipped. The reference has been compared against its dump; this is not a claim of a strictly isolated clean-room audit. See `docs/plans/DEVIN-LIKE-FRONTEND.md` in the repository for scope and measured reference checks.

The workbench application and transport are adapted to Pakka's public clients, controlled services, human identity and native Conversation records. The original pi-pocket runtime, SQLite writer, subagent scheduler/documents and PiP authority are not imported. Source ancestry, per-file provenance and the independently recorded upstream failure baseline are maintained in the Pakka repository under `integrations/pocket/`.
