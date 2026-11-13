## ADDED Requirements

### Requirement: Independent WebUI delivery and business-owned plugins

The WebUI SHALL be independently publishable from the Pakka monorepo. Optional business components SHALL implement visualization, business controls and pipelines through public plugin contracts; the core SHALL NOT require domain-specific routing, private stores or business state machines for those components.

#### Scenario: A domain plugin consumes the independently installed host

- **WHEN** an approved RSI, MAS, Memo or unrelated plugin is installed with compatible public SDK/service versions
- **THEN** it can contribute its own views, controlled commands and workflow presentation through public capabilities without modifying core business branches
- **AND** the domain service retains its object, authorization and persistent-effect responsibilities

### Requirement: Generic plugin capability sufficiency and public consumption

The host SHALL provide minimal and sufficient generic capabilities for plugin views, scoped service consumption, resource navigation, operation observation and lifecycle. A proposed host change SHALL distinguish a genuine generic capability gap from downstream adaptation defects.

#### Scenario: An unrelated GUI-only plugin verifies the same mechanisms

- **WHEN** an independently installed GUI-only plugin registers a view, consumes its approved Backend and opens an authorized stable resource reference
- **THEN** it uses the same public containers, navigation, commands and lifecycle as domain plugins
- **AND** opening/closing the view does not implicitly enable Agent execution or cancel previously accepted business work

#### Scenario: A plugin links an original persistent Conversation

- **WHEN** a plugin navigates to a known Session/Conversation reference that the host can resolve and authorize
- **THEN** the original conversation history is browsed through controlled public services
- **AND** an unavailable, mismatched or denied reference does not trigger a substitute Session, lock removal or work replay
