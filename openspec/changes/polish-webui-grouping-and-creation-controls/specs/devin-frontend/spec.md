## ADDED Requirements

### Requirement: Sidebar grouping choices use the workspace menu language

The Conversation grouping control SHALL present Default and Sort Per Session in a theme-aware workspace popup with a visible current-selection indicator. Pointer and touch activation, keyboard browsing, explicit confirmation, Escape dismissal and focus return SHALL operate on the same choices. Opening, browsing and dismissing SHALL preserve the saved grouping preference and SHALL not submit model input. Explicit selection SHALL use the existing personal-navigation update and original-request/unknown checks.

#### Scenario: Browse and cancel

- **WHEN** a person opens Conversation Grouping and browses choices with arrow keys
- **THEN** the popup stays inside the actual viewport and distinguishes focused choice from saved choice
- **AND** Escape closes it and returns focus to the grouping trigger without saving a preference
- **AND** Tab closes the nonmodal popup and continues keyboard navigation outside it

#### Scenario: Confirm and reopen

- **WHEN** the person confirms the other grouping choice with Enter or a pointer
- **THEN** the existing authorized resources are regrouped and the confirmed preference survives refresh
- **AND** opening the popup identifies the saved choice, while ownership, model inputs and budgets are unchanged

### Requirement: Home creation actions have equal transparent presentation

New Conversation and New Session on Workspace Home SHALL be equally styled transparent actions, each with an aligned SVG icon and readable label, separated by one short gray vertical rule. Their pair SHALL remain understandable at narrow widths and enlarged text, with complete keyboard focus and at least 44px touch targets. Each action SHALL open its corresponding dedicated creation dialog.

#### Scenario: Read and activate the creation pair

- **WHEN** Workspace Home is rendered in light or dark theme at desktop or phone widths and 14px or 20px text
- **THEN** both creation actions have transparent backgrounds and equal typographic weight, with vertically centered icons and a visible short separator between them
- **AND** no separator is stranded away from the two actions or exposed as an extra interactive control
- **AND** activating either action opens the correct configuration dialog; cancelling leaves native resources and model requests unchanged
