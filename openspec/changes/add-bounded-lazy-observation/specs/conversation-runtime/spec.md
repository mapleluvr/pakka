# Conversation Runtime Delta

## ADDED Requirements

### Requirement: Observation is separate from complete execution history

The Runtime SHALL provide bounded cold observation and explicit complete content access without eagerly materializing the entire execution context or archival history for browsing. Authoritative records, original identities and complete strategy-frame semantics SHALL remain preserved.

#### Scenario: Cold long-history preview

- **GIVEN** an existing Conversation with large historical records and no new work
- **WHEN** the workbench opens and reads a preview
- **THEN** the Runtime reads bounded state and projections without constructing a full native history watch or enabling task progress
- **AND** no historical input is resubmitted

#### Scenario: Complete source content by bounded ranges

- **GIVEN** a visible stored part larger than one preview page
- **WHEN** authorized ranges are read for the same resource/source/part/version
- **THEN** each response is bounded and ordered ranges reconstruct the original retained content
- **AND** stale versions, invalid ranges and invisible fork sources are refused

#### Scenario: Source already truncated

- **GIVEN** native published output whose source collector retained only a partial window
- **WHEN** its available content is fully read
- **THEN** the source truncation remains explicit and the result is not described as all originally produced stdout
