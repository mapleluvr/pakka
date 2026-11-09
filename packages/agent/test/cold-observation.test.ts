import { test } from "node:test";
import { strict as assert } from "node:assert";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession, type ConversationId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

const allow = () => {};

test("Cold observation: boot and previews mark the execution frame unloaded rather than hydrating the archive", async () => {
	const m = await runtimeFixture();
	const ref = m.runtime.view().conversations[0]!;
	const file = m.runtime.root().view().sessionFile;
	let runtime = m.runtime;
	try {
		await runtime.close();
		const storage = await openNodeSqliteStorage(file);
		const session = createSession(storage);
		const entry = await session.commit(
			(tx) =>
				tx.appendEntry(Number(ref.conversationId) as ConversationId, {
					kind: "test.cold-history",
					data: { retainedArchive: "FULL-ARCHIVE\n" + "X".repeat(16 * 1024 * 1024) },
					model: [{ role: "user", content: "ARCHIVED-USER-CONTENT", timestamp: 1 }],
				}),
			BACKGROUND_CONTEXT,
		);
		await session.close(BACKGROUND_CONTEXT);
		runtime = await createRuntime({ ...m.config, observation: "lazy", reopenSessionFile: file });
		const before = runtime.root().view();
		assert.equal(
			before.historyLoaded,
			false,
			"cold metadata must not pretend that the unloaded history is empty",
		);
		assert.equal(before.leafId, null, "an unloaded active context must not claim a known execution leaf");
		const preview = await runtime.previewConversation(ref, allow);
		assert.ok(preview.entries.some((row) => row.id === String(entry.id)));
		assert.equal(runtime.root().view().historyLoaded, false);
		assert.equal(JSON.stringify(preview).includes("FULL-ARCHIVE"), false);
		await runtime.prepareExecution(ref, allow);
		assert.equal(runtime.root().view().historyLoaded, true);
		assert.ok(
			runtime
				.root()
				.view()
				.context.some((row) => row.text.includes("ARCHIVED-USER-CONTENT")),
		);
		assert.equal(m.f.requests.length, 0, "materializing a read-only frame does not schedule tasks");
	} finally {
		await runtime.close();
		await m.close();
	}
});

test("Cold observation: submitting explicitly materializes context and retains native committed receipt semantics", async () => {
	const m = await runtimeFixture({ observation: "lazy" });
	try {
		assert.equal(m.runtime.root().view().historyLoaded, false);
		const operator = m.runtime.root().connect("cold-operator", ["input.submit"]);
		const receipt = await operator.submit({ key: "cold-input", text: "SMALL-EXPLICIT-INPUT" });
		await m.runtime.waitForIdle();
		assert.equal(m.runtime.root().view().historyLoaded, true);
		assert.ok(m.f.requests.length > 0);
		const snapshot = await m.runtime.previewConversation(m.runtime.view().conversations[0]!, allow);
		assert.ok(snapshot.entries.some((entry) => entry.messages.some((message) => message.role === "user")));
		assert.equal(snapshot.live.busy, false);
		assert.ok(
			snapshot.entries.some((entry) => entry.messages.some((message) => message.role === "assistant")),
		);
		// Eager/lazy live control both confirm committed input; handled belongs to a distinct dispatcher path.
		assert.equal(operator.receipt(receipt.id)?.state, "committed");
	} finally {
		await m.close();
	}
});
