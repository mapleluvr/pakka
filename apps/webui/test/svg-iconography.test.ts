import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Icon } from "../src/components.ts";

test("shared directional and keyboard icons are decorative SVG paths, not font glyphs", () => {
	for (const name of ["up", "down", "right", "enter", "shift", "microphone", "stop"] as const) {
		const svg = Icon({ name });
		const props = svg.props;
		assert.equal(svg.type, "svg", name);
		assert.equal(props.viewBox, "0 0 24 24", name);
		assert.equal(props["aria-hidden"], "true", name);
		assert.match(JSON.stringify(props.children), /"type":"path"/u, name);
		assert.doesNotMatch(JSON.stringify(props.children), /[←-⇿✓✔]/u, name);
	}
});

test("shipped core, bundled contribution and MAS direction/shortcut marks contain no Unicode icon substitutes", async () => {
	const web = new URL("../web/", import.meta.url);
	const contributions = new URL("../contributions/", import.meta.url);
	const files = (await readdir(web)).filter((name) => name.endsWith(".js")).map((name) => new URL(name, web));
	for (const entry of await readdir(contributions, { withFileTypes: true })) {
		if (entry.isDirectory()) files.push(new URL(`${entry.name}/web/index.js`, contributions));
	}
	files.push(new URL("../../../packages/mas-devpack/src/browser/graph-board.ts", import.meta.url));
	for (const file of files) {
		const source = await readFile(file, "utf8");
		// These ranges are specific to graphical directions/checkmarks, not multilingual
		// prose, punctuation, user data or the semantic reaction value used by the API.
		assert.deepEqual([...new Set(source.match(/[←-⇿✓✔]/gu) ?? [])], [], file.pathname);
		for (const summary of source.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gu)) {
			assert.match(
				summary[1] ?? "",
				/<\$\{Icon\} name="chevron"\s*\/>/u,
				`disclosure in ${file.pathname} owns an SVG arrow`,
			);
		}
	}
});
