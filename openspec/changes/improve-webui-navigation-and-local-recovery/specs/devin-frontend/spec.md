# 设置导航与交互质量 delta

## ADDED Requirements

### Requirement: Settings pages have native addressable navigation

Settings SHALL use explicit page routes and category anchors whose hrefs identify the destination, following the corresponding offline Devin production navigation. Category visibility SHALL reflect current Pakka permissions and capabilities, and the active category SHALL derive from the route. Settings pages SHALL own page focus and history independently of modal dialog lifecycle.

#### Scenario: Follow category links and browser history

- **WHEN** a user activates categories normally or uses Back and Forward
- **THEN** URL, active category, title, main content and applicable focus identify the same page, without a modal cleanup closing the destination

#### Scenario: Open a category in another tab

- **WHEN** a user follows an allowed category with Ctrl/Meta, middle-click or an open-in-new-tab action
- **THEN** ordinary anchor behavior opens that category with its public context and obtains fresh authorization

### Requirement: Deep links restore only authorized page context

The HTTP server SHALL serve the application shell for the explicit allowed settings routes. A settings deep link or full reload SHALL resolve the current session, permissions and resource incarnation before displaying controlled content. URL context SHALL identify resources without granting authority, and post-login destinations SHALL be validated internal routes.

#### Scenario: Reload a conversation settings deep link

- **WHEN** a signed-in user reloads a settings URL naming an accessible Conversation
- **THEN** the named category resolves the current authorized Conversation reference and presents its real state

#### Scenario: Visit a denied or unknown destination

- **WHEN** the route, category permission or Conversation is unavailable to the current person
- **THEN** the page presents the applicable unavailable/access state, while private data and unrelated endpoint bodies remain protected

#### Scenario: Sign in after opening settings

- **WHEN** an unauthenticated browser opens an allowed settings deep link and later signs in
- **THEN** navigation restores the validated internal destination under the resulting person's fresh permissions

### Requirement: In-app navigation preserves scoped working context

Single-document settings and workbench navigation SHALL preserve the selected Conversation, unsent message draft, applicable scroll position and return focus for the same person and authorized resource. A full reload SHALL restore addressable category and persisted authorized context. Identity/scope invalidation SHALL clear the corresponding private view and secret input state.

#### Scenario: Return from settings to the workbench

- **WHEN** a user changes categories and follows Back to app without reloading the document
- **THEN** the original authorized Conversation, message draft and applicable view position remain, and navigation causes no model dispatch

#### Scenario: Identity changes during a delayed page read

- **WHEN** authorization or the owning page instance changes before an awaited response completes
- **THEN** the late response cannot populate the new page with the prior private state or erase another page's draft

### Requirement: Authentication and operation feedback reflects confirmed outcomes

The UI SHALL distinguish invalid login input, exchange rejection, permission/security refusal, conflict, service/capacity refusal and unconfirmed results. Public login rejection SHALL give an actionable invalid/used/unavailable-link explanation without revealing token existence. Possible committed results SHALL retain their original reconciliation identity and SHALL NOT trigger automatic mutation replay.

#### Scenario: Reuse the initial login link

- **WHEN** session exchange rejects the already-rotated or inactive initial credential
- **THEN** the login page explains that a new credential is required and identifies the administrator/local-operator recovery path rather than showing a generic operation-refused message

#### Scenario: The exchange response is lost

- **WHEN** the browser cannot confirm whether credential exchange completed
- **THEN** the UI presents an unconfirmed result and permits only appropriate fresh authorization reads before an explicit next action, without replaying the exchange or claiming its exact result from an unrelated active session

### Requirement: Actual product forms expose semantic and accessible states

Login, Appearance, Conversation/credential, People/invitation, notification and extension forms SHALL associate labels and errors with inputs, give appropriate input metadata, preserve applicable edits across known refusals and place focus at the first actionable validation error. Loading, empty, denied and unknown states SHALL have stable, readable presentation consistent with real service outcomes.

#### Scenario: Submit an invalid or rejected configuration

- **WHEN** a user submits a supported form with invalid input or receives a confirmed refusal
- **THEN** field-level errors are readable and programmatically associated, focus identifies the first actionable issue, and permitted unsaved edits remain available

### Requirement: Context and long content remain readable across viewports

Product pages SHALL maintain meaningful headings, main/navigation landmarks, keyboard navigation and full-content access for truncated titles, paths, model names and tool content. Desktop and declared phone viewports, including larger text settings, SHALL keep the relevant controls reachable and preserve the owning service's scheduling and reconciliation semantics.

#### Scenario: Read long content at a narrow or enlarged viewport

- **WHEN** a page contains long titles, paths or tool output at a declared phone viewport or larger reader scale
- **THEN** the user can reach and read complete content with appropriate wrapping/disclosure/scrolling and operate its relevant controls

#### Scenario: Observe native work feedback

- **WHEN** input is admitted, queued, stopped, refused or unconfirmed
- **THEN** transcript/composer feedback represents the actual owning service state, preserving Prompt/Steer/Follow up placement, request identity and spent budgets
