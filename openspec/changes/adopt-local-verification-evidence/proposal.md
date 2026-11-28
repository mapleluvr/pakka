# Adopt local verification evidence

## Why

The PR #6 audit found 244,626 of 263,283 added lines in verification evidence, including repeated verbose pack inventories and intermediate outputs. The operator adopted a narrower submission rule: verification tracks key information and the complete local evidence-bundle hash only. Raw evidence stays local; the operator handles cloud storage.

## What Changes

- Track candidate/environment/scope/results/necessary limitations and the whole local evidence-bundle SHA-256, with its filename and byte size.
- Keep full logs, TAP, screenshots, inventories and intermediate evidence bundled locally; do not commit or upload evidence bundles to GitHub.
- Require complete artifact review before every commit and PR creation/update, including staged files, large-file contents and the full actual PR-base diff.
- Align workspace GitRules/AGENTS, repository entry points, delivery state, verification methods, OpenSpec context and the PR checklist.

## Impact

This is a documentation and ignore-policy change. It preserves runtime behavior, test definitions, mandatory product vendor/source-patch/build-lock contracts and published evidence identities. Cleaning existing PRs or rewriting history is outside this adopted future-submission update.
