import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAccepted, readTestCounts } from "./acceptance.mjs";

const passed = { tests: 6, pass: 6, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
const tap = (counts) =>
	Object.entries(counts)
		.map(([key, value]) => `# ${key} ${value}`)
		.join("\n");

test("gate accepts only a complete, successful behavioral matrix", () => {
	assert.deepEqual(readTestCounts(tap(passed)), passed);
	assert.doesNotThrow(() => assertAccepted(passed, 6));
});

for (const [reason, counts] of [
	["deleted test", { ...passed, tests: 5, pass: 5 }],
	["failed assertion", { ...passed, pass: 5, fail: 1 }],
	["cancelled test", { ...passed, pass: 5, cancelled: 1 }],
	["skipped test", { ...passed, pass: 5, skipped: 1 }],
	["todo test", { ...passed, pass: 5, todo: 1 }],
	["inconsistent pass total", { ...passed, pass: 7 }],
]) {
	test(`gate rejects ${reason} even if the test process returns zero`, () => {
		assert.throws(() => assertAccepted(readTestCounts(tap(counts)), 6));
	});
}

test("gate refuses missing or duplicate TAP counts", () => {
	assert.throws(() => readTestCounts("# tests 6"));
	assert.throws(() => readTestCounts(tap(passed) + "\n# pass 6"));
});
