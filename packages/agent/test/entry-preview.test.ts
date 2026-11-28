import { test } from "node:test";
import { strict as assert } from "node:assert";

async function previewModule() {
	const value = await import("../src/entry-preview.ts").catch((error) => {
		if (error.code === "ERR_MODULE_NOT_FOUND") return null;
		throw error;
	});
	assert.ok(value, "The bounded entry projection and string-range decoder must exist");
	return value;
}

function source(value: unknown, blockSize = 65536) {
	const bytes = Buffer.from(JSON.stringify(value));
	let largest = 0,
		calls = 0;
	return {
		bytes,
		read: async (offset: number, length: number) => {
			assert.ok(length > 0 && length <= 65536, "the scanner cannot request an unbounded native record");
			const piece = bytes.subarray(offset, offset + Math.min(length, blockSize));
			largest = Math.max(largest, piece.length);
			calls++;
			return piece;
		},
		metrics: () => ({ largest, calls }),
	};
}

test("Entry preview: a 14 MB string becomes a bounded head/tail projection with an exact original span", async () => {
	const { indexEntryJson } = await previewModule();
	const original = "FIRST\n" + '中🙂\\"\n'.repeat(1100000) + "\nLAST\ud800";
	const input = source({
		id: 8,
		conversationId: 1,
		kind: "pi.tool-result",
		model: [
			{
				role: "toolResult",
				toolCallId: "same-id",
				toolName: "command",
				isError: false,
				content: [{ type: "text", text: original }],
			},
		],
	});
	const index = await indexEntryJson(input.read, input.bytes.length);
	assert.ok(Buffer.byteLength(JSON.stringify(index.value)) < 16384);
	const span = index.spans.find((row) => row.path === "/model/0/content/0/text");
	assert.ok(span);
	assert.equal(span.encoding, "json-string");
	assert.equal(
		JSON.parse('"' + input.bytes.subarray(span.offset, span.offset + span.byteLength).toString("utf8") + '"'),
		original,
	);
	assert.ok(index.truncated.includes(span.path));
	assert.equal(input.metrics().largest, 65536);
	assert.ok(input.metrics().calls > 100);
});

test("Entry preview: all native scalars, escaped keys, empty containers and proto-named arguments remain ordinary data", async () => {
	const { indexEntryJson } = await previewModule();
	const original = JSON.parse(
		'{"id":3,"conversationId":1,"kind":"pi.assistant","model":[{"role":"assistant","content":[{"type":"toolCall","id":"x","name":"echo","arguments":{"__proto__":{"ok":true},"constructor":null,"a/b~c":[0,-1,1.2e20,false,{},[],"\\\\","\\u001f","\\ud800"]}}]}]}',
	);
	const input = source(original, 7);
	const index = await indexEntryJson(input.read, input.bytes.length);
	assert.deepEqual(index.value, original);
	assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, "ok"), false);
	const span = index.spans.find((row) => row.path === "/model/0/content/0/arguments");
	assert.ok(span && span.encoding === "json");
	assert.deepEqual(
		JSON.parse(input.bytes.subarray(span.offset, span.offset + span.byteLength).toString("utf8")),
		original.model[0].content[0].arguments,
	);
});

test("Entry preview: bounded independent string fragments reconstruct Unicode, escapes and lone surrogates exactly", async () => {
	const { indexEntryJson, decodeEntryStringRange } = await previewModule();
	const original = 'x\n中🙂\\"\u0000\ud800'.repeat(12000);
	const input = source({ model: [{ role: "user", content: [{ type: "text", text: original }] }] }, 23);
	const index = await indexEntryJson(input.read, input.bytes.length);
	const span = index.spans.find((row) => row.path === "/model/0/content/0/text")!;
	let offset = 0,
		output = "",
		chunks = 0;
	while (offset < span.byteLength) {
		const range = await decodeEntryStringRange(input.read, span, offset, 509);
		assert.equal(range.offset, offset);
		assert.ok(range.nextOffset > offset && range.nextOffset - offset <= 509);
		output += range.text;
		offset = range.nextOffset;
		chunks++;
	}
	assert.equal(output, original);
	assert.ok(chunks > 100);
	await assert.rejects(decodeEntryStringRange(input.read, span, -1, 509));
	await assert.rejects(decodeEntryStringRange(input.read, span, span.byteLength + 1, 509));
});

test("Entry preview: malformed input, premature EOF and oversized keys do not publish a plausible partial record", async () => {
	const { indexEntryJson } = await previewModule();
	for (const value of [
		'{"a":"bad\\q"}',
		'{"a":1} trailing',
		'{"a":1,}',
		'{"a": [true false]}',
		'{"a":"\\u00ZZ"}',
	]) {
		const bytes = Buffer.from(value);
		await assert.rejects(
			indexEntryJson(
				async (offset: number, length: number) => bytes.subarray(offset, offset + length),
				bytes.length,
			),
		);
	}
	const input = source({ text: "END" });
	await assert.rejects(
		indexEntryJson(
			async (offset: number, length: number) =>
				input.bytes.subarray(offset, Math.min(input.bytes.length - 1, offset + length)),
			input.bytes.length,
		),
	);
});
