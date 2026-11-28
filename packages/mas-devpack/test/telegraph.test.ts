import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMasDevPack } from "../src/index.ts";
import { createMasProfilePacks } from "../src/profiles.ts";

const resolve = () => {
	throw new Error("Prompt composition must not resolve a client");
};
const skill = readFileSync(
	new URL(import.meta.resolve("@pakka/mas-devpack/skills/mas-telegraph/SKILL.md")),
	"utf8",
).replace(/\r\n/g, "\n");

function section(heading: string) {
	return (
		"## " +
		skill
			.split(/^## /m)
			.find((value) => value.startsWith(heading + "\n"))!
			.trim()
	);
}

test("Telegraph: omitted/disabled options preserve defaults; independent switches reuse the packaged Skill", () => {
	const baseline = createMasDevPack({ resolve });
	assert.doesNotMatch(baseline.instructions, /MAS Telegraph/);
	const schema = (pack: ReturnType<typeof createMasDevPack>) =>
		pack.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
	for (const telegraph of [undefined, {}, { reasoning: false, communication: false }]) {
		const pack = createMasDevPack({ resolve, telegraph });
		assert.equal(pack.instructions, baseline.instructions);
		assert.deepEqual(schema(pack), schema(baseline));
	}
	for (const telegraph of [
		{ reasoning: true },
		{ communication: true },
		{ reasoning: true, communication: true },
	]) {
		const pack = createMasDevPack({ resolve, telegraph });
		assert.ok(pack.instructions.startsWith(baseline.instructions + "\n\n"));
		assert.equal(pack.instructions.includes(section("Reason compactly")), !!telegraph.reasoning);
		assert.equal(pack.instructions.includes(section("Communicate compactly")), !!telegraph.communication);
		for (const heading of ["Preserve semantic anchors", "Choose the final audience"])
			assert.ok(pack.instructions.includes(section(heading)));
		assert.deepEqual(schema(pack), schema(baseline));
	}
	assert.match(skill, /^name: mas-telegraph$/m);
	assert.match(skill, /^disable-model-invocation: true$/m);
	assert.match(skill, /^  version: "1\.0\.0"$/m);
});

test("Telegraph: host profile selection is explicit and rejects unapproved targets", () => {
	const packs = createMasProfilePacks(
		{
			profiles: { compact: ["send"], ordinary: ["send"] },
			telegraphByProfile: { compact: { communication: true } },
		},
		() => undefined,
	);
	assert.ok(packs.get("compact")!.instructions.includes(section("Communicate compactly")));
	assert.doesNotMatch(packs.get("ordinary")!.instructions, /MAS Telegraph/);
	assert.throws(
		() =>
			createMasProfilePacks(
				{ profiles: { ordinary: [] }, telegraphByProfile: { missing: { reasoning: true } } },
				() => undefined,
			),
		/Unapproved MAS Telegraph profile/,
	);
});
