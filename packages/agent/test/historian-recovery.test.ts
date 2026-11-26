import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { createHash } from "node:crypto";
import * as agent from "../src/index.ts";
import { createHistoricalWork } from "../src/historical-work.ts";
import { runtimeFixture } from "./runtime-fixture.ts";
import { deferred, type Answer } from "./fixture.ts";

const check = () => {};
const outputTool = {
	name: "submit_history",
	description: "Complete Book change",
	parameters: {
		type: "object",
		properties: { text: { type: "string" } },
		required: ["text"],
		additionalProperties: false,
	},
};
async function setup(reply: (n: number) => Answer | Promise<Answer>) {
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
						timeoutMs: 10000,
					},
				],
			},
		}),
		undefined,
		(_p, n) => reply(n),
	);
	let runtime = m.runtime,
		service = await agent.createHistorianSession({
			storageDir: join(m.f.dataDir, "history-native"),
			toolCallingTolerance: 2,
			unresolvedErrorTolerance: 2,
		});
	const owner = runtime.root().connect("writer", ["context_artifacts.write"]);
	owner.activateStrategy({ id: "history-source", hooks: ["context_artifacts.write"] });
	const binding = owner.bindStrategy("history-source");
	await binding.artifacts.append(binding.readFrame().basis, {
		expectedVersion: 0,
		records: [{ kind: "block", text: "Old observed event" }],
	});
	const source = runtime.view().conversations[0]!,
		artifact = (await runtime.artifactHistory(source, "history-source", check).page()).items[0]!.ref;
	const open = () =>
		runtime.historicalWork({
			namespace: "history-recovery",
			session: service,
			maxPending: 4,
			maxAttempts: 8,
		});
	const plan: agent.HistoricalPlan = {
		id: "merge",
		source,
		strategyId: "history-source",
		artifacts: [artifact],
		target: { key: "head", version: 0 },
		maxCalls: 2,
		request: { modelKey: "summary", prompt: "Merge the old event", outputTool },
	};
	return {
		m,
		plan,
		open,
		get runtime() {
			return runtime;
		},
		get service() {
			return service;
		},
		async reopen() {
			const file = runtime.view().sessionFile;
			await runtime.close();
			await service.close();
			service = await agent.createHistorianSession({
				storageDir: join(m.f.dataDir, "history-native"),
				toolCallingTolerance: 2,
				unresolvedErrorTolerance: 2,
			});
			runtime = await agent.createRuntime({ ...m.config, reopenSessionFile: file });
		},
		async close() {
			await runtime.close();
			await service.close();
			await m.close();
		},
	};
}
const publication = (text: string): agent.RuntimeRecordsCommit => ({
	requestId: "publish",
	reads: [{ key: "head", version: 0 }],
	writes: [{ key: "head", data: { text } }],
	append: [],
});

test("Historian repairs one malformed submission within the same native Conversation and preserves both attempt identities", async () => {
	const f = await setup((n) => ({
		tool: "submit_history",
		args: n === 1 ? {} : { text: "Complete repaired candidate" },
	}));
	try {
		const work = f.open();
		await work.prepare(f.plan, check);
		const result = await work.run(f.plan.id, check);
		assert.equal(result.status, "completed");
		assert.equal(result.attempts, 2);
		assert.equal(result.result?.compresser?.attemptIds.length, 2);
		assert.equal(f.m.f.requests.length, 2);
		assert.ok(
			f.m.f.requests[1]!.messages.some((m) => m.role === "tool"),
			"Repair retains native tool history",
		);
		await f.reopen();
		assert.deepEqual(await f.open().run(f.plan.id, check), result);
		assert.equal(f.m.f.requests.length, 2);
	} finally {
		await f.close();
	}
});

test("two historical-work clients compete for one dispatch claim and a newer Book edit blocks adoption without rerunning the model", async () => {
	const entered = deferred(),
		release = deferred();
	const f = await setup(async () => {
		entered.resolve();
		await release.promise;
		return { tool: "submit_history", args: { text: "Generated result" } };
	});
	try {
		const a = f.open(),
			b = f.open();
		await a.prepare(f.plan, check);
		const running = a.run(f.plan.id, check);
		await entered.promise;
		await assert.rejects(b.run(f.plan.id, check), /unconfirmed|result|complete/i);
		await f.runtime.records({ namespace: "history-recovery" }).commit(
			{
				requestId: "ordinary-edit",
				reads: [{ key: "head", version: 0 }],
				writes: [{ key: "head", data: { text: "Confirmed Agent edit" } }],
				append: [],
			},
			check,
		);
		release.resolve();
		const result = await running;
		assert.equal(result.status, "completed");
		await assert.rejects(a.publish(f.plan.id, publication("Generated result"), check), { code: "conflict" });
		assert.equal((await a.lookup(f.plan.id, check))?.status, "completed");
		assert.equal(
			(await f.runtime.records({ namespace: "history-recovery" }).get("head", check)).data?.text,
			"Confirmed Agent edit",
		);
		assert.equal(f.m.f.requests.length, 1);
	} finally {
		release.resolve();
		await f.close();
	}
});

test("a sealed original native result repairs a missing business completion checkpoint after both stores reopen", async () => {
	const f = await setup(() => ({ tool: "submit_history", args: { text: "Original sealed candidate" } }));
	try {
		const work = f.open();
		await work.prepare(f.plan, check);
		const result = await work.run(f.plan.id, check);
		// Restore the exact persisted pre-publication state representing loss of the final business checkpoint.
		// The independent native store keeps its original sealed result and original child identity.
		const store = f.runtime.records({ namespace: "history-recovery" }),
			key = "@historian:job:" + createHash("sha256").update(JSON.stringify(f.plan.id)).digest("hex"),
			row = await store.get(key, check);
		await store.commit(
			{
				requestId: "simulate-missing-checkpoint",
				reads: [{ key, version: row.version }],
				writes: [{ key, data: { ...row.data!, status: "unknown", result: null } }],
				append: [],
				work: [{ key, state: "unknown" }],
			},
			check,
		);
		await f.reopen();
		const recovered = await f.open().recover(f.plan.id, check);
		assert.equal(recovered.status, "completed");
		assert.deepEqual(recovered.result, result.result);
		assert.equal(f.m.f.requests.length, 1);
		const receipt = await f.open().publish(f.plan.id, publication("Original sealed candidate"), check);
		await f.reopen();
		assert.deepEqual(
			await f.open().publish(f.plan.id, publication("Original sealed candidate"), check),
			receipt,
		);
		assert.equal(f.m.f.requests.length, 1);
	} finally {
		await f.close();
	}
});

test("retiring an uncertain historical job requires explicit acknowledgement, preserves spend and atomically records the operator gap", async () => {
	const entered = deferred(),
		release = deferred(),
		controller = new AbortController();
	const f = await setup(async () => {
		entered.resolve();
		await release.promise;
		return { tool: "submit_history", args: { text: "Late result" } };
	});
	try {
		const work = f.open();
		await work.prepare(f.plan, check);
		const running = work.run(f.plan.id, check, undefined, controller.signal);
		await entered.promise;
		controller.abort();
		release.resolve();
		await running;
		assert.equal((await work.lookup(f.plan.id, check))?.status, "unknown");
		assert.equal(
			(await f.service.snapshot()).conversations.length,
			1,
			"The uncertain native child is retained",
		);
		const store = f.runtime.records({ namespace: "history-recovery" });
		assert.equal(typeof work.retire, "function", "Explicit historical retirement is missing");
		const transaction = {
			requestId: "skip-original",
			reads: [{ key: "gap", version: 0 }],
			writes: [{ key: "gap", data: { reason: "Operator acknowledged unknown" } }],
			append: [],
		};
		await assert.rejects(
			work.retire(f.plan.id, { reason: "Operator review", acknowledgeUnknown: false }, transaction, check),
			/acknowledge/i,
		);
		assert.equal((await store.get("gap", check)).data, null);
		const receipt = await work.retire(
			f.plan.id,
			{ reason: "Operator review", acknowledgeUnknown: true },
			transaction,
			check,
		);
		assert.equal((await work.lookup(f.plan.id, check))?.status, "retired");
		assert.equal((await work.lookup(f.plan.id, check))?.attempts, 1);
		assert.equal((await store.get("gap", check)).data?.reason, "Operator acknowledged unknown");
		assert.equal(
			(await f.service.snapshot()).conversations.length,
			0,
			"Retired children leave the active native directory, preserving their keyed job record",
		);
		await f.reopen();
		assert.deepEqual(
			await f
				.open()
				.retire(f.plan.id, { reason: "Operator review", acknowledgeUnknown: true }, transaction, check),
			receipt,
		);
		assert.equal(f.m.f.requests.length, 1);
	} finally {
		release.resolve();
		await f.close();
	}
});

test("historical retirement stays terminal when sealed-result recovery resumes after the retirement commit", async () => {
	const f = await setup(() => ({ tool: "submit_history", args: { text: "Original sealed result" } })),
		entered = deferred(),
		release = deferred();
	try {
		const real = f.open(),
			store = f.runtime.records({ namespace: "history-recovery" });
		await real.prepare(f.plan, check);
		await real.run(f.plan.id, check);
		const key = "@historian:job:" + createHash("sha256").update(JSON.stringify(f.plan.id)).digest("hex"),
			row = await store.get(key, check);
		await store.commit(
			{
				requestId: "missing-final-checkpoint",
				reads: [{ key, version: row.version }],
				writes: [{ key, data: { ...row.data!, status: "unknown", result: null } }],
				append: [],
				work: [{ key, state: "unknown" }],
			},
			check,
		);
		// The actual original native result is recovered before this boundary is paused.
		// Only scheduling is controlled; SQLite, the native seal and retirement remain real.
		const raced = createHistoricalWork(
			store,
			{
				identity: async () => (await f.service.snapshot()).sessionId,
				active: () => false,
				retired: async () => {
					await real.recover(f.plan.id, check);
				},
				validate: async () => {
					await real.prepare(f.plan, check);
				},
				run: async () => {
					throw new Error("Recovery must not request a new native run");
				},
				recover: async () => {
					const result = (await real.recover(f.plan.id, check)).result;
					assert.ok(result);
					entered.resolve();
					await release.promise;
					return result;
				},
			},
			{ maxPending: 4, maxAttempts: 8 },
		);
		const pending = raced.recover(f.plan.id, check);
		await entered.promise;
		await real.retire(
			f.plan.id,
			{ reason: "Explicit disposition", acknowledgeUnknown: true },
			{ requestId: "retire-original", reads: [], writes: [], append: [] },
			check,
		);
		release.resolve();
		assert.equal((await pending).status, "retired");
		await assert.rejects(
			raced.publish(f.plan.id, publication("Rejected old result"), check),
			/retired|publishable/i,
		);
		assert.equal((await store.get("head", check)).data, null);
		assert.equal(f.m.f.requests.length, 1);
		await f.reopen();
		assert.equal((await f.open().lookup(f.plan.id, check))?.status, "retired");
	} finally {
		release.resolve();
		await f.close();
	}
});

test("historical admission reserves encoded record capacity for the sealed result before creating work", async () => {
	const f = await setup(() => ({ tool: "submit_history", args: { text: "Unused" } }));
	try {
		const work = f.open(),
			plan = { ...f.plan, request: { ...f.plan.request, prompt: "\u0001".repeat(20000) } };
		await assert.rejects(work.prepare(plan, check), /bounded historical plan/i);
		assert.equal(await work.lookup(plan.id, check), null);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.close();
	}
});
