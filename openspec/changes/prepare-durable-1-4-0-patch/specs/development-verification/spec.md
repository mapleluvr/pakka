# Development verification delta

## ADDED Requirements

### Requirement: Optional development verification

Development verification SHALL be selected by its owning task. A skipped activity SHALL be recorded once in that task or change; subsequent history SHALL refer to that decision rather than restating it or automatically inheriting a pending acceptance item.

#### Scenario: Skip verification

- **WHEN** a development task skips a verification activity
- **THEN** its owning record states that decision once and later work independently selects whether to perform it

### Requirement: Scoped actual results

An executed check SHALL identify its candidate, environment, scope and actual outcome. A method's execution conditions SHALL apply when it is selected, independently of the selection of other methods.

#### Scenario: Run a local regression only

- **WHEN** a task selects a local regression
- **THEN** its result supports that regression's scope and separate GUI, deployment or product-integration conclusions require their own corresponding evidence
