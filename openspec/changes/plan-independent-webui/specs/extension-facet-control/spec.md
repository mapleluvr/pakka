## ADDED Requirements

### Requirement: Independently addressed facet registrations

Extension discovery SHALL identify each approved Backend, WebUI, Client and Agent facet by its own version, generation and phase. Backend calls and WebUI/Client assets SHALL use the generation of the selected facet. A control or publication of one facet SHALL NOT invalidate another facet's unchanged registration.

#### Scenario: UI update during a backend operation

- **WHEN** a WebUI facet is disabled or replaced while a Backend operation is awaiting an authorized service
- **THEN** only the WebUI registration and its instances change, while the valid Backend generation and original operation remain usable
- **AND** UI cleanup neither cancels native work nor claims its effects were rolled back

#### Scenario: Partial unknown initialization

- **WHEN** a Backend initialization has an unconfirmed effect
- **THEN** that facet becomes unavailable until explicitly reconciled, while independently confirmed facets retain their identities
- **AND** reopen does not automatically re-enter the unconfirmed module

### Requirement: Authorized original-request facet control

Facet control SHALL bind the current Person, extension, facet, desired action, expected generation and stable original request identity. The service SHALL require installation authority and recheck it before controlled effects. Identical requests SHALL reconcile the original control receipt; changed payloads under the same identity SHALL be refused. Control receipt lookup SHALL remain distinct from a new effect.

#### Scenario: Lost control response

- **WHEN** the service records a facet change but its response is lost
- **THEN** the caller can read the original result without another module import or activation
- **AND** an absent or unknown result does not authorize automatic replay

#### Scenario: Stale or unauthorized control

- **WHEN** a caller supplies a stale facet generation, lacks installation authority, or requests an unapproved facet
- **THEN** the service refuses before beginning that control's effect
- **AND** neither a browser-provided path nor a profile name supplies installation trust

### Requirement: Native approved-profile Agent activation

Agent facets SHALL be explicitly composed from trusted definitions for selected profiles. Pakka SHALL use the public pi-durable Registry inside its adapter to publish the selected tools and instructions. Disabled contributions SHALL be absent from future model requests and unavailable to new native tool invocations; other profiles, Conversation identities and persistent jobs SHALL retain their own lifecycle.

#### Scenario: Agent toggle without a UI dependency

- **WHEN** an approved Agent contribution is enabled, disabled and enabled again in a real Runtime
- **THEN** the corresponding profile's actual requests and tool dispatch reflect its current eligibility, while unapproved profiles receive none of its tools or instructions
- **AND** a delayed old-generation invocation is not revived by re-enabling the contribution

#### Scenario: Unprovided Agent update

- **WHEN** a browser requests an Agent code revision not supplied by the trusted composition root
- **THEN** the service explicitly refuses that update rather than loading arbitrary code or reporting a fake reload

### Requirement: Facet-owned UI instance cleanup

The pure browser host SHALL own a set of UI instances for one WebUI facet generation. Deactivation or replacement SHALL dispose those instances and reject their later publications. A different facet's change SHALL NOT dispose them. Cleanup failures SHALL be visible rather than reported as complete disposal.

#### Scenario: Replacement with a late result

- **WHEN** an old UI instance finishes a read after its WebUI facet was replaced
- **THEN** it cannot render, navigate, close or notify through the replacement instance
- **AND** the old instance's cleanup runs once without deleting service history or cancelling accepted jobs

### Requirement: Explicit facet wire compatibility

The facet-aware extension wire SHALL use version 3. Services SHALL use version 3 because its former capability response admitted only extension version 2; workbench remains version 2. Capabilities SHALL report bounded protocol versions for consumers to check independently. Fixed frontend artifacts SHALL declare the service and extension versions they consume. Closed decoding and same-origin identity/CSRF checks SHALL remain in force.

#### Scenario: Old extension consumer or artifact

- **WHEN** a consumer or fixed frontend artifact requires the old extension wire
- **THEN** incompatibility is explicitly rejected rather than projected through an ambiguous whole-extension lifecycle facade
