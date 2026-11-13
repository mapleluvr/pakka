import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import * as agent from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

const check = () => {};
const outputTool = {
	name: "submit_history",
	description: "Submit the complete History Book change",
	parameters: {
		type: "object",
		properties: { text: { type: "string" } },
		required: ["text"],
		additionalProperties: false,
	},
};

test("Historian executes an exact historical plan once and atomically adopts the original sealed result with Book records", async () => {
	assert.equal(typeof agent.createHistorianSession, "function", "Native Historian Session is missing");
	const m = await runtimeFixture(
		(endpoint) => ({
			inference: {
				models: [
					{
						key: "summary",
						model: "local-model",
						endpoint,
						apiKey: "local-only",
						maxTokens: 512,
						contextWindow: 16000,
					},
				],
				policies: [
					{
						strategyId: "history-source",
						modelKeys: ["summary"],
						maxCalls: 8,
						maxJobCalls: 2,
						maxOutputTokens: 256,
						timeoutMs: 5000,
					},
				],
			},
		}),
		undefined,
		() => ({ tool: "submit_history", args: { text: "Combined fixed event" } }),
	);
	let service: agent.HistorianSession | undefined;
	try {
		service = await agent.createHistorianSession({
			storageDir: join(m.f.dataDir, "historian"),
			toolCallingTolerance: 2,
			unresolvedErrorTolerance: 2,
		});
		// The auxiliary catalog and policy are explicit; no ambient model credentials.
		const owner = m.runtime.root().connect("writer", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "history-source", hooks: ["context_artifacts.write"] });
		const binding = owner.bindStrategy("history-source");
		await binding.artifacts.append(binding.readFrame().basis, {
			expectedVersion: 0,
			records: [{ kind: "block", text: "Fixed old event" }],
		});
		const source = m.runtime.view().conversations[0]!,
			feed = m.runtime.artifactHistory(source, "history-source", check),
			first = (await feed.page()).items[0]!.ref;
		const work = m.runtime.historicalWork({
			namespace: "history-test",
			session: service,
			maxPending: 4,
			maxAttempts: 8,
		});
		const plan = {
			id: "merge-one",
			source,
			strategyId: "history-source",
			artifacts: [first],
			target: { key: "book-head", version: 0 },
			maxCalls: 2,
			request: { modelKey: "summary", prompt: "Merge the fixed event", outputTool },
		};
		await work.prepare(plan, check);
		assert.equal(m.f.requests.length, 0);
		const result = await work.run(plan.id, check);
		assert.equal(result.status, "completed");
		assert.ok(result.result?.toolCall);
		const again = await work.run(plan.id, check);
		assert.deepEqual(again, result);
		assert.equal(m.f.requests.length, 1);
		const receipt = await work.publish(
			plan.id,
			{
				requestId: "publish-one",
				reads: [{ key: "book-head", version: 0 }],
				writes: [{ key: "book-head", data: { revision: 1, text: result.result!.toolCall!.arguments.text } }],
				append: [],
			},
			check,
		);
		assert.ok(receipt.sequence > 0);
		assert.equal((await work.lookup(plan.id, check))?.status, "published");
		assert.equal(
			(await m.runtime.records({ namespace: "history-test" }).get("book-head", check)).data?.revision,
			1,
		);
		assert.equal(
			(await service.snapshot()).conversations.length,
			0,
			"Completed children leave the active registry",
		);
	} finally {
		await m.close();
		await service?.close();
	}
});
