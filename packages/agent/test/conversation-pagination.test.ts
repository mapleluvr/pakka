import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { runtimeFixture } from "./runtime-fixture.ts";

// Ignoring the page boundary would repeat recent entries and hide older committed human records.
test("WebUI observation: finite earlier pages keep exact order across a new committed append", async () => {
	const m = await runtimeFixture();
	try {
		const ref = m.runtime.view().conversations[0]!;
		const written = [];
		for (let n = 0; n < 7; n++)
			written.push(
				await m.runtime.writeDisplay(
					ref,
					{ namespace: "paging", actorId: "human", requestId: "entry-" + n, kind: "chat", text: "PAGE-" + n },
					() => {},
				),
			);
		const newest = await m.runtime.readConversation(ref, () => {}, { limit: 3 });
		assert.deepEqual(
			newest.entries.map((entry) => entry.display?.text),
			["PAGE-4", "PAGE-5", "PAGE-6"],
		);
		assert.equal(newest.olderBeforeId, written[4]!.entryId);
		await m.runtime.writeDisplay(
			ref,
			{ namespace: "paging", actorId: "human", requestId: "entry-7", kind: "chat", text: "PAGE-7" },
			() => {},
		);
		const before = await readFile(m.runtime.view().sessionFile, "utf8");
		const older = await m.runtime.readConversation(ref, () => {}, {
			limit: 3,
			beforeEntryId: newest.olderBeforeId,
		});
		assert.deepEqual(
			older.entries.map((entry) => entry.display?.text),
			["PAGE-1", "PAGE-2", "PAGE-3"],
		);
		const first = await m.runtime.readConversation(ref, () => {}, {
			limit: 3,
			beforeEntryId: older.olderBeforeId,
		});
		assert.deepEqual(
			first.entries.map((entry) => entry.display?.text),
			["PAGE-0"],
		);
		assert.equal(first.olderBeforeId, undefined);
		assert.equal(first.entriesTruncated, false);
		assert.equal(older.entriesTruncated, true);
		assert.equal(await readFile(m.runtime.view().sessionFile, "utf8"), before);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

// A foreign, missing or forged boundary must fail rather than read some other resource's history.
test("WebUI observation: foreign boundaries and unbounded options are refused without effects", async () => {
	const m = await runtimeFixture();
	try {
		const ref = m.runtime.view().conversations[0]!;
		const peer = await m.runtime.createConversation({ key: "peer" });
		const foreign = await m.runtime.writeDisplay(
			peer,
			{
				namespace: "paging",
				actorId: "human",
				requestId: "secret",
				kind: "card",
				text: "PEER-PRIVATE-CANARY",
			},
			() => {},
		);
		for (const limit of [0, -1, 257, NaN, Infinity])
			await assert.rejects(
				m.runtime.readConversation(ref, () => {}, { limit }),
				/page|limit|bounded/i,
			);
		await assert.rejects(
			m.runtime.readConversation(ref, () => {}, { beforeEntryId: foreign.entryId }),
			/page|boundary|scope/i,
		);
		await assert.rejects(
			m.runtime.readConversation(ref, () => {}, { beforeEntryId: "missing-entry" }),
			/page|boundary|scope/i,
		);
		assert.equal((await m.runtime.readConversation(ref, () => {})).entries.length, 0);
		assert.equal(m.runtime.view().phase, "ready");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
