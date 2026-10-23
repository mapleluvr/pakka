## Purpose

Provide governed auxiliary inference with a declarative Tool Calling output contract so strategies can submit structured candidates through the existing model budget, lifecycle, source and persistence controls.

## ADDED Requirements

### Requirement: Declarative output tool

The host SHALL accept an optional output tool declaration on a source-bound auxiliary inference request and SHALL return one immutable tool-call DTO for exactly one complete invocation matching that declaration and its parameter schema. The host SHALL perform only the bounded inference request; execution and adoption remain caller-controlled.

#### Scenario: Complete submission

- **WHEN** an authorized request declares an output tool and the provider returns one complete matching invocation with valid parameters
- **THEN** the result is completed with its exact attempt ID, call identity and detached arguments, while the actual provider request carries the declaration and the effective output cap

#### Scenario: Invalid or incomplete submission

- **WHEN** the response is prose-only, names another tool, contains multiple calls, has invalid parameters, exposes incomplete or repaired JSON argument deltas, or is truncated
- **THEN** the result is failed with observed usage preserved and no tool execution or main transcript mutation

### Requirement: Shared authority and persistence rules

Tool output SHALL use the same job/source validation, cancellation, durable budget reservation, completion audit and exact artifact receipt requirements as text inference. Changed authority or source after an await SHALL quarantine the response; unknown persistence SHALL prevent replay or adoption.

#### Scenario: Revocation during a call

- **WHEN** authority is revoked while the auxiliary call is in flight
- **THEN** its late output cannot authorize active artifacts, and no future call uses that job

#### Scenario: Text inference

- **WHEN** outputTool is absent
- **THEN** the text inference contract and existing completion rules apply
