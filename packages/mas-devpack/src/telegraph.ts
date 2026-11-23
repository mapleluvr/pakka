import { readFileSync } from "node:fs";

/** Host-selected prompt guidance; neither switch changes tools, authority or runtime limits. */
export interface MasTelegraphOptions {
	readonly reasoning?: boolean;
	readonly communication?: boolean;
}

export function validateMasTelegraph(value: unknown): asserts value is MasTelegraphOptions | undefined {
	if (value === undefined) return;
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.entries(value).some(
			([key, selected]) => !["reasoning", "communication"].includes(key) || typeof selected !== "boolean",
		)
	)
		throw new Error("Invalid MAS Telegraph options");
}

export function telegraphInstructions(options: MasTelegraphOptions | undefined): string {
	validateMasTelegraph(options);
	if (!options?.reasoning && !options?.communication) return "";
	// Source and compiled modules are both one directory below the shipped canonical Skill.
	const skill = readFileSync(new URL("../skills/mas-telegraph/SKILL.md", import.meta.url), "utf8").replace(
		/\r\n/g,
		"\n",
	);
	const sections = skill.split(/^## /m).slice(1);
	const selected = [
		...(options.reasoning ? ["Reason compactly"] : []),
		...(options.communication ? ["Communicate compactly"] : []),
		"Preserve semantic anchors",
		"Choose the final audience",
	];
	return [
		"MAS Telegraph: apply only the selected sections below as host-approved prompt guidance.",
		...selected.map((heading) => {
			const section = sections.find((value) => value.startsWith(heading + "\n"));
			if (!section) throw new Error("Missing MAS Telegraph Skill section: " + heading);
			return "## " + section.trim();
		}),
	].join("\n\n");
}
