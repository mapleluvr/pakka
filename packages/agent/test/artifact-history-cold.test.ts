import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntime } from "../src/index.ts";
import { hash } from "../src/artifact-journal.ts";
import { runtimeFixture } from "./runtime-fixture.ts";
import { rewriteNativeDocument } from "./native-storage.ts";

test("cold artifact reads inspect only requested immutable batches and fail closed when an affected batch is read", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const owner = m.runtime.root().connect("writer", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const binding = owner.bindStrategy("strategy");
		for (let i = 0; i < 5; i++)
			await binding.artifacts.append(binding.readFrame().basis, {
				expectedVersion: i,
				records: [{ kind: "block", text: "event-" + i }],
			});
		const source = m.runtime.view().conversations[0]!,
			file = m.runtime.view().sessionFile;
		const original = (await m.runtime.artifactHistory(source, "strategy", () => {}).page({ limit: 1 }))
			.items[0]!.ref;
		await m.runtime.close();
		const key = hash(
			JSON.stringify([
				source.sessionId,
				JSON.stringify(["pakka.conversation-journal.v2", source.conversationId, "strategy", "records"]),
			]),
		);
		await rewriteNativeDocument(file, "pakka.strategy-batch", key + ".4", (value) => ({
			...value,
			records: [{ kind: "block", text: "damaged without valid checksum" }],
		}));
		reopened = await createRuntime({ ...m.config, observation: "lazy", reopenSessionFile: file });
		assert.equal(reopened.view().phase, "ready", "Cold start must not preload every artifact batch");
		const history = reopened.artifactHistory(reopened.view().conversations[0]!, "strategy", () => {});
		assert.deepEqual(await history.read(original), { kind: "block", text: "event-0" });
		await assert.rejects(history.page({ afterVersion: 3, through: 4 }), /digest|batch/i);
		assert.equal(reopened.view().phase, "failed");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});
