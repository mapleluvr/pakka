# Change: Adopt the Devin frontend as the UI base

## Why

The operator rejected a reskinned old Pakka workbench. The frontend must use the independently inspected Devin prototype's real structure and interactions, with actual Pakka services bound to it. This change records already adopted R2 decisions; it does not claim a newly approved design or completed acceptance.

## What Changes

- Adopt devin-ui-comparison@ed20cec0aef82daa22aa50da19597b7ba1607e02/clean-room/current as the structural/style/interaction base.
- Bind real human identity, Conversation, model/cwd, native input, permissions, results and extensions without demo data.
- Design Team Graph/Activity/Agents using that language rather than the old embedded Board.
- Gate all Team controls on stylesheet readiness, with a fail-closed error state.
- Retain separate functional, visual, installed-consumer and independent GUI gates.

## Capabilities

### New Capabilities

- `devin-frontend`: adopted shell, real controlled workflows, Team and layout/readiness behavior.

### Modified Capabilities

None. Existing WebUI, MAS observation, authority and delivery contracts remain in their owning specs.

## Impact

Existing R2 frontend and browser consumers. The implementation already exists in product candidate 6d359b1; this record does not authorize runtime/permission changes or declare its failing/BLOCKED acceptance passed.
