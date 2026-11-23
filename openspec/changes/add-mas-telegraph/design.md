# MAS Telegraph Design

## Composition and source of truth

`packages/mas-devpack/skills/mas-telegraph/SKILL.md` is the portable, versioned source. Its frontmatter declares `name: mas-telegraph`, a purpose/opt-in description, `metadata.version: 1.0.0` and `disable-model-invocation: true`. The package's `files` and explicit `./skills/mas-telegraph/SKILL.md` export deliver the same bytes to archive consumers. Pi can load the resolved path with `--skill`; an operator explicitly invokes the Skill. No user/global configuration is changed and the DevPack acquires no Coding Agent dependency.

The internal `telegraph.ts` validates boolean options and reads this bundled file only when at least one switch is enabled. It selects named Markdown sections: reasoning, communication, plus shared semantic anchors and final-audience rules. Missing sections fail composition instead of silently dropping selected guidance. Source and compiled modules use the same relative asset location; CRLF is normalized before section selection so Windows checkouts remain loadable. Heading names are the small extraction contract; prompt prose remains in one file, without a generated duplicate or a second model call.

`MasDevPackOptions.telegraph` selects one contribution. `MasProfilePacksOptions.telegraphByProfile` maps approved profile IDs to the same options, leaving the existing grant-array API intact. `validateMasProfileTelegraph()` is shared by profile composition, Server JSON decoding and worker IPC validation. It rejects unknown profile selection, unsupported option keys and non-boolean values. Worker configuration reuses the public profile-options type; the existing manager JSON serialization and worker/profile assembly carry the map unchanged.

## Behavior and compatibility

Both switches default off. Disabled composition returns the exact prior default instructions and identical tools/schema. Enabled composition appends only selected Skill text. Profile switches and removal use existing Runtime behavior: the latest system update selects the new instructions; historical positional updates remain immutable context, and removed tools cannot execute. Existing invocation ownership, ancestral grant ceilings, request payloads, admission, persistence, quotas and unknown outcomes remain intact.

Reasoning may use compact clauses, stable anchors, familiar multilingual fragments and clear symbols while retaining necessary alternatives, constraint checks and verification. It does not ask to reveal private reasoning traces. Communication uses useful information deltas, concrete requests and one substantive response per true root receipt. Passive informs request no acknowledgement and remain pending/at-least-once. Novelty concerns the information, including new findings at the same URL. Genuinely blocking facts may motivate a new concrete clarification request; a new ID cannot extend a ceremonial reply loop.

Shared rules preserve identifiers, quoted diagnostics, code/schema, units, evidence, uncertainty, approvals, obligations and exact formats. The final reader determines presentation: a draft sent through another agent for a human remains human-readable. No fixed token, message-length or round limits are imposed. These are instructions, not enforcement or measured savings.

## Draft adaptation

The parent draft is preserved with version metadata and a `Communicate compactly` section grouping its message-decision and MAS-intent guidance. That section explicitly requests telegraphic communication. Its subordinate headings allow independent extraction; the common audience section makes compact internal coordination conditional on the communication switch. The full Skill retains the illustrative checkout example and research limitation; partial injected guidance omits the whole-Skill invocation preamble so a reasoning-only selection cannot implicitly enable communication.

## Validation boundary

Use focused factory/profile tests for default identity and independent/combined selection, existing real Runtime/provider tests for tools and removal, existing Server and worker tests for actual profile routing, and a shared serialized-preset rejection matrix. Archive installation checks the public Skill export, installed types and real selected prompts/tool effects. Pi's public Skill loader verifies valid frontmatter and exclusion from automatic model selection. No GUI feature or paid/external-model benchmark is needed. The authorized Worker writing trial is qualitative practice, not a controlled evaluation.
