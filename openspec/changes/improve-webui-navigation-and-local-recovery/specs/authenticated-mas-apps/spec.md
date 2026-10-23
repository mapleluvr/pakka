# 本机管理员认证恢复 delta

## ADDED Requirements

### Requirement: Trusted local owner recovery

The product SHALL provide an explicit local CLI operation to recover sign-in for the persisted bootstrap owner while preserving the original product identity and data. Issuance SHALL require exclusive storage ownership, validated physical provenance and confirmation of the target Session. The target SHALL be an active admin with all-resource scope.

#### Scenario: Recover the signed-out owner

- **WHEN** the local operator stops the product and confirms recovery for its original active owner
- **THEN** recovery issues a new credential for that same person and preserves existing people, Conversation identities, records, receipts and consumed budgets

#### Scenario: The original owner is disabled or scoped down

- **WHEN** the persisted owner is inactive or no longer an all-resource admin
- **THEN** issuance is refused before an authentication write and the existing person and scope remain effective

#### Scenario: A browser attempts issuance

- **WHEN** an authenticated or unauthenticated browser requests the local recovery operation through HTTP, RPC or an extension command
- **THEN** the network interface refuses the operation and issues no recovery credential

### Requirement: Recovery maintenance has a bounded execution surface

Recovery SHALL open an existing owned Session through a restricted maintenance port using public Pi APIs. Mutable native storage objects SHALL remain in the durable adapter. Maintenance SHALL perform only authorized metadata reads and bounded authentication writes, with provider, tool, Job, extension and HTTP startup effects excluded.

#### Scenario: A writer is already running

- **WHEN** the product or another maintenance process owns the Session writer
- **THEN** recovery fails closed without issuing credentials, stealing the claim or changing the live product's storage

#### Scenario: Maintenance is exercised against stored work

- **WHEN** the isolated recovery path opens storage containing Conversation and pending-work records
- **THEN** it preserves the records and dispatches zero provider, tool, Job or extension effects

### Requirement: Recovery credentials have finite single-use authority

A recovery credential SHALL expire after ten minutes by default and SHALL be exchanged through the existing session exchange protocol. Its successful exchange SHALL replace it with a normal product session. Issuance SHALL revoke the target owner's previous login sessions and earlier recovery credentials in the same authentication commit, preserving other people's grants and sessions.

#### Scenario: Two clients redeem the same recovery credential

- **WHEN** concurrent clients attempt to exchange one issued recovery credential
- **THEN** at most one obtains a replacement session and subsequent exchanges of the issued credential are refused

#### Scenario: A credential expires or is superseded

- **WHEN** its expiry passes or a new confirmed recovery issuance supersedes it
- **THEN** exchange refuses it while the original product data and other people's authority remain unchanged

### Requirement: Credential delivery and issuance are reconcilable

Issuance SHALL use a recovery identity and an authentication commit containing the affected session changes and a bounded non-secret issuance record. Credential plaintext SHALL be delivered only through an exclusively prepared, access-protected local file. File privacy SHALL be established for the host platform before authentication changes.

#### Scenario: Output privacy cannot be established

- **WHEN** a new issuance targets an existing file, a path redirects through an unapproved link, or the required POSIX/Windows protection cannot be confirmed
- **THEN** issuance fails before changing authentication state and leaves the existing output content untouched

#### Scenario: Commit or delivery is unconfirmed

- **WHEN** interruption or an unknown storage/publication result occurs after issuance may have committed
- **THEN** the operation reports a non-success state with its recovery identity and retained reconciliation material; retry checks the original issuance instead of silently minting another credential

#### Scenario: Resume confirmed private-file delivery

- **WHEN** a protected prepared file and a confirmed issuance record match the same product, recovery identity and credential
- **THEN** the operator can complete that issuance's file delivery without creating another authentication session

### Requirement: Recovery preserves established storage and transport boundaries

Recovery SHALL read existing valid authentication state and migrate its format transactionally when required, preserving person, role, scope, invitation and session semantics. Unknown or corrupt state SHALL remain fail closed. Existing browser authentication, Origin, CSRF, trusted-proxy and authorization rules SHALL govern all subsequent credential exchanges and observations.

#### Scenario: Upgrade a valid existing product

- **WHEN** recovery first opens an owned product with the existing authentication schema
- **THEN** its migration retains the original identities and grants, and a credential subsequently works only through the product's approved exchange boundary

#### Scenario: Recovery secrets cross an output boundary

- **WHEN** a recovery operation is logged, inspected or exposed through ordinary browser/service state
- **THEN** only non-secret identity, status and expiry metadata are returned; token plaintext is confined to the protected recovery file and explicit exchange input
