import assert from "node:assert/strict";

export function readTestCounts(output) {
	const counts = {};
	for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
		const matches = [...output.matchAll(new RegExp("^# " + key + " (\\d+)$", "gm"))];
		assert.equal(matches.length, 1, "Missing or duplicate TAP count: " + key);
		counts[key] = Number(matches[0][1]);
		assert.ok(Number.isSafeInteger(counts[key]), "Invalid TAP count: " + key);
	}
	return counts;
}

export function assertAccepted(counts, expectedTests) {
	assert.equal(counts.tests, expectedTests, "Incomplete behavioral matrix");
	assert.equal(counts.pass, expectedTests, "Not all behavioral checks passed");
	for (const key of ["fail", "cancelled", "skipped", "todo"])
		assert.equal(counts[key], 0, "Nonzero behavioral " + key);
}
