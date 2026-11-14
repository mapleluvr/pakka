import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runtimeFixture } from "./runtime-fixture.ts";
import { createHistorianSession } from "../src/index.ts";

test("HistoricalWork lookup checks current read authority after its records helper returns", async () => {
	const m = await runtimeFixture((endpoint) => ({
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
					strategyId: "source",
					modelKeys: ["summary"],
					maxCalls: 8,
					maxJobCalls: 2,
					maxOutputTokens: 256,
					timeoutMs: 5000,
				},
			],
		},
	}));
	let session: Awaited<ReturnType<typeof createHistorianSession>> | undefined;
	let revoked = false,
		armed = false,
		count = 0;
	const check = () => {
		if (revoked) throw Error("Read authority revoked");
		if (armed && ++count === 2)
			queueMicrotask(() => {
				revoked = true;
			});
	};
	try {
		session = await createHistorianSession({
			storageDir: join(m.f.dataDir, "historian"),
			toolCallingTolerance: 2,
			unresolvedErrorTolerance: 2,
		});
		const writer = m.runtime.root().connect("writer", ["context_artifacts.write"]);
		writer.activateStrategy({ id: "source", hooks: ["context_artifacts.write"] });
		const binding = writer.bindStrategy("source");
		await binding.artifacts.append(binding.readFrame().basis, {
			expectedVersion: 0,
			records: [{ kind: "block", text: "Fixed evidence" }],
		});
		const source = m.runtime.view().conversations[0]!;
		const ref = (await m.runtime.artifactHistory(source, "source", () => {}).page()).items[0]!.ref;
		const work = m.runtime.historicalWork({
			namespace: "publication-history",
			session,
			maxPending: 4,
			maxAttempts: 8,
		});
		await work.prepare(
			{
				id: "planned",
				source,
				strategyId: "source",
				artifacts: [ref],
				target: { key: "book-head", version: 0 },
				maxCalls: 2,
				request: {
					modelKey: "summary",
					prompt: "Unused model prompt",
					outputTool: {
						name: "submit_history",
						description: "History",
						parameters: {
							type: "object",
							properties: { text: { type: "string" } },
							required: ["text"],
							additionalProperties: false,
						},
					},
				},
			},
			() => {},
		);
		assert.equal((await work.lookup("planned", check))?.status, "planned");
		revoked = true;
		await assert.rejects(work.lookup("planned", check));
		revoked = false;
		armed = true;
		const late = await work.lookup("planned", check).then(
			(value) => ({ status: "ok", value }),
			() => ({ status: "denied" }),
		);
		assert.equal(revoked, true);
		assert.equal(late.status, "denied");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
		await session?.close();
	}
});
