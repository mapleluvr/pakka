import { test } from "node:test";
import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { fixture } from "./fixture.ts";

test("deterministic HTTP fixtures expose canonical temporary paths, including Windows short-name TEMP aliases", async () => {
	const f = await fixture();
	try {
		assert.equal(f.root, await realpath(f.root));
		assert.equal(f.cwd, await realpath(f.cwd));
		assert.equal(f.dataDir, await realpath(f.dataDir));
	} finally {
		await f.close();
	}
});
