# Frontend Delta

## ADDED Requirements

### Requirement: Tool details and long history use lazy bounded DOM

The frontend SHALL create only previews for collapsed/offscreen contents, render visible long text/history through bounded virtual windows, and preserve source/call identity, focus and scroll across live/committed updates.

#### Scenario: Collapsed large tool

- **GIVEN** a tool with large arguments, text and image results
- **WHEN** its card remains collapsed
- **THEN** full body and media nodes do not exist in the DOM
- **AND** status/error/size/source information and an operable complete-reading path remain visible

#### Scenario: Open and close details

- **WHEN** an authorized user opens a card and scrolls its contents
- **THEN** details are obtained in bounded ranges and only a finite window is rendered
- **WHEN** the user closes or leaves it
- **THEN** full DOM and pending reads are released without aborting native work

### Requirement: Preview operations never claim complete-original authority

The frontend SHALL distinguish unreferenced preview content from versioned original content. Copy and literal search over a preview SHALL be labelled and reported as preview-only; a missing preview match SHALL NOT establish absence from the complete source or grant original-reading capability.

#### Scenario: A native-source match is outside the preview

- **GIVEN** live native arguments contain a literal that their bounded head/tail preview omits
- **WHEN** the user searches that unreferenced preview
- **THEN** the result states only that the preview did not match and the complete original was not searched
- **AND** copy remains preview-only and original download is unavailable until a valid original reference exists

### Requirement: Full retrieval is independent of residency

The frontend SHALL provide explicit full retrieval and budgeted idle fill without unbounded whole-history DOM or default persistent body caching.

#### Scenario: Idle fill interrupted

- **GIVEN** stable visible/expanded content and available byte cache
- **WHEN** idle fill runs
- **THEN** only one throttled range is in flight
- **WHEN** the user interacts, new output arrives, navigation changes or authority is lost
- **THEN** fill pauses/cancels before additional ranges and does not submit or stop model work

#### Scenario: Complete retrieval larger than hot cache

- **WHEN** a user requests retained content larger than the memory cache
- **THEN** all original content remains readable or stream-deliverable while offscreen DOM/cache is evicted by bytes
- **AND** successful chunk reads alone do not conceal an incomplete or source-truncated result
