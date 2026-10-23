## ADDED Requirements

### Requirement: Settings directly enters configuration

Activating the sidebar Settings control SHALL enter the dedicated configuration page in one activation. Configuration categories SHALL be selectable within that page. Appearance SHALL be the initial category. Conversation-scoped categories SHALL require a selected Conversation, and People management SHALL follow the current administrator permission.

#### Scenario: Open configuration and return

- **WHEN** a user activates sidebar Settings once, visits available configuration categories and returns to the app
- **THEN** the configuration page opens directly, category navigation remains usable on desktop and mobile, and the selected Conversation and unsent draft are retained

### Requirement: Consistent webui product identity

The product UI, notifications, executable command and current repository documentation SHALL identify the product as `pakka-webui`. The product package SHALL remain `@pakka/webui`. Existing protocol, stored identities, upstream licenses and fixed historical artifact references SHALL preserve their established identities.

#### Scenario: Launch the named product

- **WHEN** a user installs the product archive and launches `pakka-webui` with explicit valid local configuration
- **THEN** the product serves its branded workbench and existing authorization and persistence contracts apply
