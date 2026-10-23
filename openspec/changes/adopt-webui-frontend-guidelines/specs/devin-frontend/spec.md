## ADDED Requirements

### Requirement: Native behavior and frontend guide authority

The product SHALL use the offline Devin production frontend as the decisive reference for corresponding native UI behavior. The maintained frontend development guide SHALL identify the selected typography and interface guidelines, their source versions and their use alongside real Pakka capabilities.

#### Scenario: Resolve a reference difference

- **WHEN** a visual prototype or generic guide differs from an existing Devin interaction
- **THEN** development traces the production behavior and its conditions before applying the corresponding product interaction, preserving Pakka authorization and native request semantics

### Requirement: Scalable configuration typography and accessible text entry

Configuration text roles SHALL follow the reader's selected scale and browser root font size. Mobile text-entry controls SHALL render at least 16px, with larger reader settings preserved. Mobile configuration controls SHALL have at least 44px touch targets, and keyboard focus in the composer SHALL have a visible indicator.

#### Scenario: Read configuration at a larger root size

- **WHEN** the browser root font increases from 16px to 20px with the default text preference
- **THEN** configuration body, title and label roles scale proportionally and remain usable

#### Scenario: Navigate and type on mobile

- **WHEN** a user opens configuration at 360×600 and returns to the conversation
- **THEN** configuration fields and categories remain readable and operable, the message field has readable type, and the unsent draft remains intact

#### Scenario: Focus the composer with the keyboard

- **WHEN** keyboard navigation reaches the message field
- **THEN** the field or its input group has an unobscured visible focus indicator without submitting the draft
