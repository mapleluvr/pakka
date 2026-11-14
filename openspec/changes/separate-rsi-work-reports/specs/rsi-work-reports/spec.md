## ADDED Requirements

### Requirement: Trusted original-work contribution

RSI SHALL persist a trusted work relation fixing contributor, ticket, original content revision and exact Conversation reference. Ordinary reassignment SHALL NOT revoke the original relation or cancel its native run. Caller-supplied work/run IDs alone SHALL NOT confer ownership or future ticket content access.

#### Scenario: H contributes after J takes over

- **WHEN** H has registered work for revision 3 and J becomes current handler and revises the ticket
- **THEN** H can read the registered original context and save its reports without reading J's later content

#### Scenario: Explicit contribution stop

- **WHEN** a manager disables work contribution at its expected work version, or the actor is deactivated
- **THEN** new writes are refused while stored original facts and authorized historical reads remain

### Requirement: Independent immutable report revisions

Reports SHALL have their own identity, author, work relation, fixed content revision, result references, process reference and versioned body. Append and revision SHALL persist the report effect and original actor/request receipt atomically. Report edits SHALL use report-local CAS; report writes SHALL NOT mutate the current ticket state, content or head version.

#### Scenario: Duplicate and parallel contributions

- **WHEN** two services submit the same actor/request/payload
- **THEN** exactly one report and its original receipt are retained, while independent report requests can both commit

#### Scenario: Report-local edit conflict

- **WHEN** two edits target the same report version
- **THEN** only one commits and the previous fixed version remains readable

### Requirement: Explicit current state decision

RSI SHALL expose state changes separately from report saving, under current responsible-handler or manager authority and ticket version control. Existing reported history SHALL remain recognizable without invented contributor or original-work metadata.

#### Scenario: Save is not closure

- **WHEN** H saves a report while J owns an active ticket
- **THEN** J remains responsible and active until an authorized explicit state decision

### Requirement: Passive bounded historical consumption

Work/report queries SHALL use exact records and finite pages; cumulative history SHALL NOT bound workspace lifetime. Fixed-version references and original receipts SHALL survive reopening the original Session. Browsing SHALL NOT send input, execute a model or clear recovery gates.

#### Scenario: Original Session reopen

- **WHEN** the original Session/namespace is reopened and a prior report version or request is queried
- **THEN** the original identity/content/receipt is returned without new model calls

### Requirement: Save before separately confirmed handoff

Optional RSI/MAS handoff SHALL persist a report before notification, use a trusted exact destination and stable original request, and keep report and notification outcomes separate. Unknown external effects SHALL be reconciled by original identity, never blind retry or substitute dispatch.

#### Scenario: Lost notification response

- **WHEN** native delivery commits but its response is lost
- **THEN** the report remains readable and handoff reconciliation queries the original delivery without duplicate input
