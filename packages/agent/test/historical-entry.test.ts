import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

test("historical entry reads retain the original content version after edits and cold reopen, never replacing missing versions with current text", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const host = m.runtime.root(),
			owner = host.connect("source-owner", ["input.submit", "real_context.write", "context_artifacts.write"]);
		owner.activateStrategy({ id: "proof", hooks: ["real_context.write", "context_artifacts.write"] });
		await owner.submit({ key: "original", text: "Original source 🔬 evidence" });
		await m.runtime.waitForIdle();
		const binding = owner.bindStrategy("proof"),
			entry = binding
				.readFrame()
				.projection.find((row) => row.messages.some((message) => message.role === "user"))!,
			source = m.runtime.view().conversations[0]!;
		assert.equal(typeof m.runtime.readHistoricalEntry, "function", "Fixed-version entry reader missing");
		const request = { entryId: entry.sourceEntryId, contentVersion: entry.fingerprint, offset: 0, limit: 7 };
		let page = await m.runtime.readHistoricalEntry(source, request, () => {}),
			body = page.text;
		while (page.nextOffset !== null) {
			page = await m.runtime.readHistoricalEntry(source, { ...request, offset: page.nextOffset }, () => {});
			body += page.text;
		}
		assert.match(body, /Original source 🔬 evidence/);
		assert.equal(
			(
				await owner.commit(owner.capture(), {
					type: "edit",
					targetId: entry.sourceEntryId,
					text: "Changed current source",
				})
			).status,
			"committed",
		);
		const changed = binding.readFrame().projection.find((row) => row.sourceEntryId === entry.sourceEntryId)!;
		assert.notEqual(changed.fingerprint, entry.fingerprint);
		assert.match(
			(await m.runtime.readHistoricalEntry(source, { ...request, limit: 16384 }, () => {})).text,
			/Original source/,
		);
		await assert.rejects(
			m.runtime.readHistoricalEntry(source, { ...request, contentVersion: changed.fingerprint }, () => {}),
			/version.*unavailable/i,
		);
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file, observation: "lazy" });
		assert.match(
			(
				await reopened.readHistoricalEntry(
					reopened.view().conversations[0]!,
					{ ...request, limit: 16384 },
					() => {},
				)
			).text,
			/Original source/,
		);
		await assert.rejects(
			reopened.readHistoricalEntry(reopened.view().conversations[0]!, request, () => {
				throw Error("revoked");
			}),
			/revoked|authority/i,
		);
		assert.equal(m.f.requests.length, 1);
	} finally {
		await reopened?.close();
		await m.close();
	}
});
