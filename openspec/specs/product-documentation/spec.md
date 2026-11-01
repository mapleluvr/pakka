# product-documentation Specification

## Purpose

Keep product declarations, guides, references and maintained rules understandable from their current objects, operations and contracts, with accurate specification mappings and separate formation records.

## Requirements

### Requirement: Standalone product documents

Product declarations, usage guides, API references and maintained development rules SHALL describe adopted objects, operations, interfaces and conditions independently of development stages or acceptance history. Historical results and planned work SHALL be maintained in their formation or execution records. Technical versions, provenance identities and runtime states SHALL retain their operational meaning.

#### Scenario: Read a public interface

- **WHEN** a reader opens a guide or API reference
- **THEN** the supported inputs, behavior and limits are understandable without reconstructing a development milestone or review result

### Requirement: Current operating instructions

Product instructions SHALL use adopted storage paths, navigation and public API contracts. Specification mappings SHALL make the adopted requirements reachable. Completed changes SHALL synchronize main specs and references through the OpenSpec archive lifecycle.

#### Scenario: Reopen persisted work

- **WHEN** a reader follows the reopen instructions
- **THEN** the guide identifies the SQLite storage and its current identity, authority and unknown-effect conditions
