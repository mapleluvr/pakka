import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { runtimeFixture } from "./runtime-fixture.ts";
import { createHistorianSession, type HistoricalPlan } from "../src/index.ts";
import { blockSqliteWrites } from "./native-storage.ts";

test("native Historian setup failure releases its request closure while the shared Session remains open", async () => {
	const gc = global.gc;
	assert.ok(gc, "Run through the repository test runner with --expose-gc");
	const m = await runtimeFixture(
		(endpoint) => ({
			inference: {
				models: [
					{
						key: "history",
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
						modelKeys: ["history"],
						maxCalls: 8,
						maxJobCalls: 2,
						maxOutputTokens: 256,
						timeoutMs: 10000,
					},
				],
			},
		}),
		undefined,
		() => ({ tool: "submit_history", args: { text: "Sealed" } }),
	);
	let native: Awaited<ReturnType<typeof createHistorianSession>> | undefined;
	try {
		const storageDir = join(m.f.dataDir, "cleanup-native");
		native = await createHistorianSession({
			storageDir,
			toolCallingTolerance: 2,
			unresolvedErrorTolerance: 2,
		});
		const source = m.runtime.view().conversations[0]!,
			owner = m.runtime.root().connect("writer", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "source", hooks: ["context_artifacts.write"] });
		const binding = owner.bindStrategy("source");
		await binding.artifacts.append(binding.readFrame().basis, {
			expectedVersion: 0,
			records: [{ text: "fixed" }],
		});
		const ref = (await m.runtime.artifactHistory(source, "source", () => {}).page()).items[0]!.ref;
		const work = m.runtime.historicalWork({
			namespace: "cleanup-review",
			session: native,
			maxPending: 4,
			maxAttempts: 8,
		});
		const plan = (id: string): HistoricalPlan => ({
			id,
			source,
			strategyId: "source",
			artifacts: [ref],
			target: { key: "book", version: 0 },
			maxCalls: 2,
			request: {
				modelKey: "history",
				prompt: "bounded",
				outputTool: {
					name: "submit_history",
					description: "Complete",
					parameters: {
						type: "object",
						properties: { text: { type: "string" } },
						required: ["text"],
						additionalProperties: false,
					},
				},
			},
		});
		async function execute(id: string, blocked: boolean) {
			await work.prepare(plan(id), () => {});
			// The per-job validator must become collectible without closing the shared Session.
			const marker = { id, bytes: new Uint8Array(1024 * 1024) },
				weak = new WeakRef(marker);
			const validate = () => {
				if (marker.bytes.length !== 1024 * 1024) throw Error("Marker changed");
				return undefined;
			};
			const unblock = blocked ? blockSqliteWrites(join(storageDir, "main.sqlite")) : () => {};
			try {
				if (blocked) await assert.rejects(work.run(id, () => {}, validate));
				else assert.equal((await work.run(id, () => {}, validate)).status, "completed");
			} finally {
				unblock();
			}
			return weak;
		}
		const normal = await execute("normal", false),
			failed = await execute("setup-failed", true);
		for (let i = 0; i < 6; i++) {
			await yieldTurn();
			gc();
		}
		assert.equal(
			normal.deref() !== undefined,
			false,
			"The successful control must release the request closure",
		);
		assert.equal(
			failed.deref() !== undefined,
			false,
			"Failed native setup must release its closure before Session close",
		);
		assert.equal(m.f.requests.length, 1, "Failed setup must not send a model request");
	} finally {
		await native?.close();
		await m.close();
	}
});
