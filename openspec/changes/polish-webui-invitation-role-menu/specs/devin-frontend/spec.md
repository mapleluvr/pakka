## ADDED Requirements

### Requirement: Invitation role uses the workbench selection menu

People & Invitations SHALL present Invite Role using the same themed popup treatment as other workbench menus, with Viewer, Sender, Driver and Admin choices, a separate current-choice mark and an accessible trigger. The label and compact right-aligned trigger SHALL share one row, matching the Appearance settings layout rather than stretching the value across the row. The content-sized popup SHALL align with the trigger's right edge and SHALL NOT be narrower than the compact trigger. The popup and 44px targets SHALL remain readable within phone viewports and at enlarged text sizes.

#### Scenario: Browse and cancel without changing an invitation

- **WHEN** an administrator opens Invite Role and browses using Up/Down or Home/End
- **THEN** focus moves among candidates without changing the selected role or creating an invitation
- **AND** Escape or an outside click closes the popup with the draft unchanged; Escape returns focus to the trigger, while Tab closes and continues normal focus navigation

#### Scenario: Confirm a draft role then create the real invitation

- **WHEN** an administrator explicitly chooses a role and activates Create Invitation
- **THEN** the original invitation command receives that role and the existing resource scope and expiry
- **AND** redeeming the one-use invitation produces the selected role under the unchanged server authorization, without model input
