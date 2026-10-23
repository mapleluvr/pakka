# Direct configuration navigation and webui identity

## Why

The operator clarified that the sidebar Settings control enters a dedicated configuration page on one activation. The existing launcher opens a menu first. The operator also adopted `pakka-webui` as the product name throughout the repository.

## What Changes

- Enter Appearance directly from the sidebar Settings control and share page-internal configuration navigation.
- Preserve the selected Conversation, unsent draft, current authorization and page lifecycle while switching configuration categories.
- Use `pakka-webui` for product labels, notifications and the executable command; update documentation, tests and current OpenSpec paths.
- Preserve installed storage and protocol identities, upstream attribution and fixed historical references.

## Impact

Affected areas are `@pakka/webui`, product-facing messages/tests, state and guides, and the active WebUI change paths. The production Durable dependency and public DTO schemas retain their existing contracts.
