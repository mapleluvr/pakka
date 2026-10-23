# Settings navigation and product identity

## Adopted requirements and observation

The operator specifies one-activation navigation to configuration and adopts `pakka-webui` as the product name. A real-browser regression against main `259f68d` reproduced a menu containing Appearance and People after the initial Settings activation, rather than a configuration page.

## Page structure

The sidebar directly opens Appearance. A shared Settings navigation context supplies Appearance, Conversation settings, Notifications, administrator-only People & invitations, and Extensions. Conversation-scoped entries require a selected Conversation; existing service permissions govern their content and mutations.

Appearance and capability configuration reuse SettingsPage and the existing focus/history lifecycle. Switching between extension management and built-in configuration transfers the active view while retaining the underlying workspace. Back returns to the app with its selected Conversation and draft.

The pinned reference hides its Settings navigation at mobile widths. Product-specific CSS presents those categories as a horizontal, scrollable row within the page. The reference CSS blob remains unchanged.

A held real People response demonstrated that a completed read could reopen People after a later selection of Appearance. Configuration navigation now carries an intent identity and resource binding; only the still-current response can select its page.

## Naming and compatibility

The current product name, document labels, notification title and executable command are `pakka-webui`. The package remains `@pakka/webui`. The active product change is located at `openspec/changes/pakka-webui/`; its product delta is `specs/pakka-webui/spec.md`. Archived document filenames and their local links use WEBUI.

The rename is a product identity change. Existing `/pocket/*` endpoints, Cookie names, persisted schema tags, CSS namespaces and exported Pocket-prefixed SDK identifiers retain their established meanings. This keeps existing sessions, records and extension consumers valid. Upstream `pi-pocket` source identities and licenses retain their attribution.

Fixed Git URLs, original baseline evidence paths and raw historical logs describe artifacts that actually existed. Their location and content remain intact; relabeling those paths would fabricate a different historical artifact.

## Checks

The regression exercises a native pointer activation, page-internal category switching, Back, draft retention, desktop and 360×600. Model-effect counts remain zero throughout navigation. Existing configuration, credentials, extension, keyboard/history and typography tests cover the shared dependencies. Installation checks exercise the newly named command from the produced package.
