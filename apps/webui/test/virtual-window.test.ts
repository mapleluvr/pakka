import { test } from "node:test";
import assert from "node:assert/strict";
import { virtualRange, fitHistoryWindow } from "../web/virtual-window.js";

test("virtual history: visible variable-height rows are bounded without shortening the durable list", () => {
	const heights = Array.from({ length: 10000 }, (_, index) => (index % 5 ? 24 : 100));
	const range = virtualRange(heights, 120000, 600, 4);
	assert.ok(range.end - range.start < 40);
	assert.ok(range.start > 2000);
	assert.equal(
		range.top + heights.slice(range.start, range.end).reduce((a, b) => a + b, 0) + range.bottom,
		range.total,
	);
	assert.equal(heights.length, 10000);
});

test("history cache: a byte window preserves the requested anchor and reports unloaded ranges rather than a deleted archive", () => {
	const entries = Array.from({ length: 2000 }, (_, index) => ({
		id: String(index + 1),
		text: "x".repeat(2000),
	}));
	const result = fitHistoryWindow(entries, { maxBytes: 128 * 1024, anchorId: "1000" });
	assert.ok(result.entries.some((entry) => entry.id === "1000"));
	assert.ok(result.retainedBytes <= 128 * 1024);
	assert.equal(result.unloadedOlder, true);
	assert.equal(result.unloadedNewer, true);
	assert.equal(entries.length, 2000);
});
