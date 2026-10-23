// Feasibility evidence for the pinned PUBLIC Durable API, not product/extension acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { Harness, createRegistry, defineExtension, defineTask } from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";

function deferred() {
	let resolve;
	const promise = new Promise((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
async function harnessAt(path, task) {
	const registry = createRegistry();
	registry.install(defineExtension({ name: "pocket-job-proof", tasks: [task] }));
	await mkdir(path, { recursive: true });
	return Harness.open(
		await openNodeJsonlStorage(path, BACKGROUND_CONTEXT, { fsync: true }),
		{ models: createModels(), registry },
		BACKGROUND_CONTEXT,
	);
}

test("P0 native job: cancelling the waiter retains live work; explicit task abort has a terminal receipt", async () => {
	const entered = deferred();
	const task = defineTask({
		name: "pakka.pocket-probe-cancel",
		version: 1,
		initial: () => ({ phase: "hold" }),
		phases: {
			hold: async (_task, rt, ctx) => {
				entered.resolve();
				await rt.sleep(rt.now() + 60000, ctx);
				await rt.commit(
					() => ({ status: "terminal", outcome: { status: "completed", result: { done: true } } }),
					ctx,
				);
			},
		},
		abort: async (_task, rt, ctx) => {
			await rt.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
		},
	});
	const root = await mkdtemp(join(tmpdir(), "pakka-webui-native-job-"));
	const h = await harnessAt(root, task);
	try {
		const c = await h.root(BACKGROUND_CONTEXT);
		const id = await c.commit(
			(tx) => tx.createTask(task, {}, { ownership: { kind: "conversation", conversationId: c.id } }),
			BACKGROUND_CONTEXT,
		);
		h.resume();
		await entered.promise;
		const controller = new AbortController();
		const waitContext = withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
		assert.equal(waitContext.abortSignal?.aborted, false);
		const reason = new Error("POCKET-WAITER-CANCELLED");
		const wait = h.waitForTask(id, waitContext);
		controller.abort(reason);
		await assert.rejects(wait, (error) => error === reason);
		assert.ok(
			(await h.inspect(BACKGROUND_CONTEXT)).tasks.some((item) => item.record.id === id),
			"wait cancellation is not task cancellation",
		);
		assert.equal(await h.abortTask(id, BACKGROUND_CONTEXT), "marked");
		const settled = await h.waitForTask(id, BACKGROUND_CONTEXT);
		assert.equal(settled.state.outcome.status, "aborted");
		assert.equal((await h.inspect(BACKGROUND_CONTEXT)).tasks.length, 0);
	} finally {
		await h.close(BACKGROUND_CONTEXT);
	}
});

test("P0 native job: a committed checkpoint survives writer close/reopen and continues without replaying prepare", async () => {
	const checkpointed = deferred();
	let prepares = 0,
		recoveries = 0;
	const task = defineTask({
		name: "pakka.pocket-probe-checkpoint",
		version: 1,
		initial: () => ({ phase: "prepare", count: 0 }),
		phases: {
			prepare: async (_task, rt, ctx) => {
				prepares++;
				await rt.commit(() => ({ status: "running", checkpoint: { phase: "recover", count: 1 } }), ctx);
				checkpointed.resolve();
				await rt.sleep(rt.now() + 60000, ctx);
			},
			recover: async (task, rt, ctx) => {
				recoveries++;
				await rt.commit(
					() => ({
						status: "terminal",
						outcome: { status: "completed", result: { count: task.state.checkpoint.count } },
					}),
					ctx,
				);
			},
		},
	});
	const root = await mkdtemp(join(tmpdir(), "pakka-webui-native-reopen-"));
	let h = await harnessAt(root, task);
	try {
		const c = await h.root(BACKGROUND_CONTEXT);
		const id = await c.commit(
			(tx) => tx.createTask(task, {}, { ownership: { kind: "conversation", conversationId: c.id } }),
			BACKGROUND_CONTEXT,
		);
		h.resume();
		await checkpointed.promise;
		await h.close(BACKGROUND_CONTEXT);
		h = await harnessAt(root, task);
		const pending = await h.inspect(BACKGROUND_CONTEXT);
		assert.equal(pending.tasks[0]?.record.state.checkpoint.phase, "recover");
		assert.equal(recoveries, 0, "read-only reopen does not resume scheduling");
		const settled = await h.waitForTask(id, BACKGROUND_CONTEXT);
		assert.equal(settled.state.outcome.status, "completed");
		assert.deepEqual(settled.state.outcome.result, { count: 1 });
		assert.equal(prepares, 1);
		assert.equal(recoveries, 1);
	} finally {
		await h.close(BACKGROUND_CONTEXT);
	}
});
