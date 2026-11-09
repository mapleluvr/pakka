import { test } from "node:test";
import assert from "node:assert/strict";
import { scanOriginal } from "../web/original-search.js";

const utf8 = new TextEncoder();

test("original search: Unicode literal crossing two ranges reports its original UTF-8 byte offset, never concatenates the full archive", async () => {
	const text = "界".repeat(1000) + "🙂needle边界END" + "tail".repeat(2000);
	const bytes = utf8.encode(text),
		split = utf8.encode("界".repeat(1000) + "🙂needle边").length;
	let calls = 0;
	const result = await scanOriginal({
		query: "needle边界",
		byteLength: bytes.length,
		start: 0,
		read: async (offset: number) => {
			calls++;
			const nextOffset = offset === 0 ? split : bytes.length;
			return { offset, nextOffset, text: new TextDecoder().decode(bytes.slice(offset, nextOffset)) };
		},
	});
	assert.equal(result.matchOffset, utf8.encode("界".repeat(1000) + "🙂").length);
	assert.equal(calls, 2);
	assert.equal(result.nextOffset, utf8.encode("界".repeat(1000) + "🙂needle边界").length);
});

test("original search: JSON-source coordinates remain separate from decoded text positions and allow next-match continuation", async () => {
	const ranges = [
		{ offset: 0, nextOffset: 17, text: "line\\n界needle" },
		{ offset: 17, nextOffset: 32, text: "边界needleEND" },
	];
	const read = async (offset: number) => ranges.find((range) => range.offset === offset)!;
	const first = await scanOriginal({
		query: "needle边界",
		start: 0,
		byteLength: 32,
		coordinates: "archive",
		read,
	});
	assert.equal(first.rangeOffset, 0);
	assert.equal(first.nextOffset, 17);
	assert.equal(first.nextIndex, 2);
	assert.match(first.excerpt!, /needle边界/);
	const second = await scanOriginal({
		query: "needle",
		start: 17,
		startIndex: 2,
		byteLength: 32,
		coordinates: "archive",
		read,
	});
	assert.equal(second.rangeOffset, 17);
	assert.equal(second.nextOffset, 17);
	assert.equal(second.nextIndex, 8);
});

test("original search: explicit cancellation and invalid progress stop rather than claim a completed search", async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		scanOriginal({
			query: "x",
			start: 0,
			byteLength: 10,
			signal: controller.signal,
			read: async () => ({ offset: 0, nextOffset: 10, text: "contentsxx" }),
		}),
	);
	await assert.rejects(
		scanOriginal({
			query: "x",
			start: 0,
			byteLength: 10,
			read: async () => ({ offset: 0, nextOffset: 0, text: "" }),
		}),
	);
	await assert.rejects(
		scanOriginal({
			query: "x",
			start: 0,
			byteLength: 10,
			read: async () => ({ offset: 0, nextOffset: 10, text: "short" }),
		}),
	);
});

test("original search: full no-match is explicit and the next scan may start at an existing original range", async () => {
	let calls = 0;
	const result = await scanOriginal({
		query: "missing",
		start: 3,
		byteLength: 9,
		read: async (offset: number) => {
			calls++;
			return { offset, nextOffset: offset + 3, text: "abc" };
		},
	});
	assert.equal(result.matchOffset, undefined);
	assert.equal(result.complete, true);
	assert.equal(result.nextOffset, 9);
	assert.equal(calls, 2);
});
