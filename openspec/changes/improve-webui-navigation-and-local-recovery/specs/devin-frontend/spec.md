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

### Requirement: Compound labels and forms retain typographic separation

Product-owned model choices, settings, dialogs and contribution interfaces SHALL visually separate primary labels, secondary identity/status text, form fields and action groups. Full identities SHALL remain available with wrapping or an explicit reading path at the declared phone viewports and larger text settings. Iconography, including direction and keyboard-hint arrows, SHALL use SVG paths with accessible control names; user content and semantic backend values SHALL retain their original text.

#### Scenario: Read an approved model and its profile

- **WHEN** a model picker contains short or long model identifiers and their profile metadata
- **THEN** primary and secondary text occupy distinct readable roles with space between them and a separate selected indicator, without merging identities or changing the selected configuration

#### Scenario: Operate settings and collaboration forms

- **WHEN** a user reads credential, Conversation/Fork or Team controls at desktop, declared phone viewports or an enlarged text setting
- **THEN** labels, inputs, adjacent fields, metadata and actions have visible separation and remain operable; credential inspection does not expose saved keys or change password-input semantics

#### Scenario: Read graphical direction or keyboard hints

- **WHEN** a product or bundled contribution presents arrow, disclosure or shortcut iconography
- **THEN** its graphical marks are SVG paths rather than text glyph substitutes and their control retains an accessible name

#### Scenario: Read product-owned titles

- **WHEN** a fixed product page, section or navigation/menu item is presented
- **THEN** its owned name uses Title Case, including Conversation Settings, People & Invitations, Commands & Extensions and New Session, without rewriting user identities, model IDs or third-party custom titles

#### Scenario: Operate public content primitives

- **WHEN** a contribution uses public Button, Field, Notice or Stack primitives without private host layout classes
- **THEN** labels, fields, informational copy and actions have readable spacing and theme-consistent controls, including on the declared phone viewports and larger text settings

#### Scenario: Focus an actual composer editor

- **WHEN** a user focuses the home or Conversation text editor with a pointer or Tab
- **THEN** its focus indicator follows the complete rounded outer composer card, remains within the viewport, and is not duplicated as an internal rectangular surface or textarea outline

#### Scenario: Identify browser dictation

- **WHEN** supported browser dictation is available or listening
- **THEN** its control displays the appropriate SVG microphone or stop icon rather than a visible Dictate text placeholder, retains its accessible action/state and at least 44x44px hit area, and still edits only the draft until explicit Send

### Requirement: Transcript preserves visible native work evidence

The Conversation transcript SHALL distinguish an authorized in-flight message from committed history while that message is busy, and SHALL give every protocol-valid content part a visible rendering or an explicit neutral unpreviewable representation. The UI SHALL NOT silently discard a valid part merely because its MIME type is outside the inline-preview allowlist.

#### Scenario: Follow an in-flight message into history

- **WHEN** the authorized snapshot contains a busy live message and later contains its committed entries
- **THEN** the live message has a distinct live identity and a compact Streaming indication, which is absent after the live message clears, without changing native input scheduling; the live projection omits the non-terminal native pending stop reason while committed history retains its actual terminal reason

#### Scenario: Receive a valid image without an inline preview

- **WHEN** an authorized message contains a protocol-valid image whose MIME type is not supported for inline preview
- **THEN** the transcript shows a readable neutral placeholder with the MIME type instead of dropping the part

### Requirement: Tool evidence retains one identity across observation carriers

The transcript SHALL correlate a tool call part's `id`, a live tool's `callId` and a tool result message's `toolCallId` for the same Conversation. It SHALL use one shared card structure for those authorized observations, showing only DTO-provided live status and retaining available arguments and result content. A result whose call declaration is outside the current history window SHALL remain visible as an explicitly marked orphan rather than disappear.

#### Scenario: Observe a call during its live-to-history transition

- **WHEN** the same call is present in both the live tool list and committed assistant content
- **THEN** only one card represents that Conversation/call identity; its live status is the DTO value, and the subsequent tool result is available from the same card without a separate tool-result message block

#### Scenario: Reuse a provider call id after a fork

- **WHEN** inherited history and a new live call contain the same provider call id under different source Conversations
- **THEN** each card retains its source identity and its own status and result; neither is suppressed or associated with the other's output

#### Scenario: Keep an expanded streamed tool call through its first commit

- **WHEN** a user expands a tool call in an authorized live message and that message is committed before native tool execution
- **THEN** the same call card keeps its DOM identity and expanded state through the commit and the later result, without creating another card

#### Scenario: Identify a failed tool result without opening it

- **WHEN** a native tool result has isError true
- **THEN** its collapsed summary identifies the error with visible text rather than relying on color alone

#### Scenario: Read a result whose call declaration is truncated

- **WHEN** the current authorized history window contains a tool result but not its corresponding tool call part
- **THEN** an orphan card exposes the call identifier, tool name, available result content and the fact that its declaration is outside the current view

### Requirement: Composer feedback identifies the next safe action

Composer feedback SHALL explain an actually unavailable send using the applicable reason, and SHALL keep Stop in the primary sending group for native work. Requested stopping SHALL NOT be presented as completed merely because an abort request returned; only the authoritative live state ends that indication. A bounded retry remains available if busy persists.

#### Scenario: Explain a disabled native input

- **WHEN** the existing view, working, role or Prompt/busy condition disables Send
- **THEN** an accessible reason associated with both input and Send explains the applicable next action without changing that condition's admission semantics or moving the composer card

#### Scenario: Stop native generation

- **WHEN** a user activates Stop for a busy native turn
- **THEN** the primary Stop control suppresses duplicate activation and indicates stopping until authorized busy becomes false, with a bounded Stop again action if it does not

#### Scenario: Reconcile an input receipt

- **WHEN** an input receipt is unanswered or unknown
- **THEN** an unanswered receipt with reason blocked presents blocked with guidance to edit the refused input, a withdrawn input is not mislabeled as policy refusal, and unknown presents needs review with guidance to reconcile before another send; neither is relabeled as a permission denial or treated as confirmation of delivery
