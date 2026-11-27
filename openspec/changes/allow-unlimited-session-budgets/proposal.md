## Why

The operator wants the three Session budget fields to default to zero and for the actual configuration to do the same. The former positive-only defaults and decoders could not represent an unlimited Session budget. Changing the form alone would not change admission.

## What Changes

- A zero in a Session limit disables only that ceiling. New Sessions without explicit limits start with three zeros. Omission on reopen preserves durable policy.
- Show and save the actual values, measure usage even while unlimited, and retain versioned receipts.
- **BREAKING:** install paired workbench 3 / services 5 artifacts; an older decoder rejects zero.

## Capabilities

### Modified Capabilities
- `conversation-runtime`: startup, durable policy and aggregate admission.

## Impact

Managed Runtime, WebUI product and configuration, headless bootstrap, public Pocket/service protocol and client, independent frontend and its default static archive. No changes to storage schema, job policy, resource bounds, authority or hosted data.
