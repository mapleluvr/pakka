# Design

## Sources and authority

The 2026-10-23 operator request adopts two development guides and makes the offline Devin frontend the absolute reference for native UI behavior. This changes the prior prototype-first behavioral authority; the prototype remains a useful visual and CSS input.

The local reference clone is devin-ui-comparison@ed20cec0aef82daa22aa50da19597b7ba1607e02. Direct inspection of the production webapp footer found sidebar-settings rendering a router Link to /settings or /settings/local. The production settings registration has category hrefs, visibility predicates and permission filtering. The original input submission function awaits success before clearing editor state. These are static control-flow findings, not a new run of the Devin service.

The whole-tree REA analysis ended with an MCP connection failure and produced no usable Evidence record. Focused direct inspection continued against the original bundles and locally formatted views. No real API proxy, captured login material or paid model was used.

## Guide preservation

The Vercel AGENTS document is preserved verbatim at revision 4ecfb9fb8d1d3b7009674869b3aaee2f904042e1 with its MIT license. LF attributes and formatting exclusions preserve its source hash. Atlassian's article is read directly and retained as a Chinese adoption summary, source URL and capture hash; original HTML and inspection output are local temporary material. The article's typography roles are adopted without importing Atlassian branded fonts or components.

The development guide states how to resolve sources: production behavior, actual DOM and runtime evidence establish the corresponding UI relationship; manual readable files help locate original code; inferred prototype behavior is provisional. Generic guide clauses are applied in that context, rather than silently replacing confirmed native shortcuts or backend semantics.

## First implementation batch

Four real-browser oracles failed before product changes: a controlled root-font increase left body/title/labels fixed at 14/18/13px, mobile category targets were 40px high, the message field remained 14px, and keyboard focus had no visible editor/group outline.

The change expresses saved nominal text-size presets in rem. Configuration text roles map the existing default sizes into relative UI/body, page title, section title and caption tokens. Browser root-size changes therefore scale the roles together. A normal 16px browser root retains the compact desktop hierarchy. The appearance selects now inherit the UI font role instead of the browser’s unscaled default font. Additional red probes covered select/group-label scaling and a reduced 12px browser root before the corresponding fixes.

Mobile text-entry fields use at least 16px and 1rem, preserving larger user presets; configuration fields and categories use 44px touch targets. A composer surface containing a focus-visible editor provides a 2px theme-colored outline without changing layout geometry. These rules live in product-added CSS; reference.css is unchanged.

Seven scoped browser checks pass after this batch, including draft retention, no model requests, appearance persistence, 360×600 and settings handoff. Further checks and concrete remaining differences are maintained in tasks, not asserted by this design.

## Further comparison

The original settings uses real routes; the current Sheet-backed settings keeps local category state. Addressable categories, browser Back/Forward and native link affordances are therefore the next functional comparison item. Form validation/focus, heading structure, transcript text roles, long-content disclosure and viewport-specific details require their own source-backed increments.
