import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";
import { deferred } from "./fixture.ts";

const options = { namespace: "pocket-jobs", maxJobs: 16, maxBytes: 262144 };
async function reached(promise: Promise<unknown>) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error("Native job did not reach the required boundary")), 3000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
async function effect(endpoint: string) {
	const url = new URL(endpoint);
	assert.equal(url.hostname, "127.0.0.1");
	assert.equal(url.protocol, "http:");
	url.pathname = url.pathname.replace(/\/$/, "") + "/chat/completions";
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			model: "local-model",
			messages: [{ role: "user", content: "NATIVE-JOB-EFFECT" }],
			stream: true,
		}),
	});
	assert.equal(response.ok, true);
	await response.text();
}

// Cancelling a UI waiter must not release a native job; native abort cannot claim rollback of prior work.
test(
	"WebUI job port: cancelled wait retains native work and explicit abort produces a terminal receipt",
	{ timeout: 10000 },
	async () => {
		const entered = deferred();
		const m = await runtimeFixture({
			jobs: [
				{
					id: "hold",
					version: 1,
					authorize: () => {},
					run: async (ctx) => {
						entered.resolve();
						await ctx.sleep(60000);
						await ctx.complete({ done: true });
					},
				},
			],
		});
		try {
			const port = m.runtime.jobs(options),
				ref = m.runtime.view().conversations[0]!;
			const admitted = await port.start(
				{ requestId: "hold", actorId: "human", target: ref, definition: "hold", payload: {} },
				() => {},
			);
			await reached(entered.promise);
			const controller = new AbortController();
			const wait = port.wait(admitted.id, () => {}, controller.signal);
			controller.abort(new Error("UI-LEFT"));
			await assert.rejects(wait, /UI-LEFT/);
			assert.equal((await port.receipt(admitted.id, () => {})).state, "running");
			await port.abort(admitted.id, () => {});
			const stopped = await port.wait(admitted.id, () => {});
			assert.equal(stopped.state, "unknown");
			assert.equal(stopped.nativeTerminal, "aborted");
			assert.equal(m.f.requests.length, 0);
			assert.equal(m.runtime.view().phase, "ready");
		} finally {
			await m.close();
		}
	},
);

// Replaying a handler after an uncheckpointed external effect would duplicate the real HTTP request.
test(
	"WebUI job port: uncheckpointed interrupted execution reopens as unknown without replay",
	{ timeout: 10000 },
	async () => {
		const effected = deferred();
		let executions = 0;
		const m = await runtimeFixture((endpoint) => ({
			jobs: [
				{
					id: "effect",
					version: 1,
					authorize: () => {},
					run: async (ctx) => {
						executions++;
						await effect(endpoint);
						effected.resolve();
						await ctx.sleep(60000);
						await ctx.complete({ done: true });
					},
				},
			],
		}));
		let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
		try {
			const spec = {
				requestId: "stable-effect",
				actorId: "human",
				target: m.runtime.view().conversations[0]!,
				definition: "effect",
				payload: {},
			};
			const admitted = await m.runtime.jobs(options).start(spec, () => {});
			await reached(effected.promise);
			const file = m.runtime.view().sessionFile;
			await m.runtime.close();
			reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
			const port = reopened.jobs(options);
			assert.equal(executions, 1);
			const settled = await port.wait(admitted.id, () => {});
			assert.equal(settled.state, "unknown");
			assert.equal(m.f.requests.length, 1);
			assert.equal(executions, 1);
			assert.equal((await port.start(spec, () => {})).id, admitted.id);
			assert.equal(m.f.requests.length, 1);
			await assert.rejects(
				port.start({ ...spec, payload: { changed: true } }, () => {}),
				/conflict/i,
			);
		} finally {
			await reopened?.close();
			await m.close();
		}
	},
);

// A checkpoint must persist together with the native phase so recovery resumes only the approved next step.
test(
	"WebUI job port: committed checkpoint continues once and retained completed receipt survives another reopen",
	{ timeout: 10000 },
	async () => {
		const checkpointed = deferred();
		let preparations = 0;
		const m = await runtimeFixture((endpoint) => ({
			jobs: [
				{
					id: "checkpoint",
					version: 1,
					authorize: () => {},
					run: async (ctx) => {
						if (ctx.checkpoint.stage !== "complete") {
							preparations++;
							await effect(endpoint);
							await ctx.advance({ stage: "complete" });
							checkpointed.resolve();
							await ctx.sleep(60000);
							return;
						}
						await ctx.complete({ observed: preparations });
					},
				},
			],
		}));
		let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
		try {
			const spec = {
				requestId: "checkpoint",
				actorId: "human",
				target: m.runtime.view().conversations[0]!,
				definition: "checkpoint",
				payload: {},
			};
			const admitted = await m.runtime.jobs(options).start(spec, () => {});
			await reached(checkpointed.promise);
			const prepared = await m.runtime.jobs(options).receipt(admitted.id, () => {});
			assert.equal(prepared.state, "queued");
			assert.deepEqual(prepared.checkpoint, { stage: "complete" });
			const file = m.runtime.view().sessionFile;
			await m.runtime.close();
			reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
			let port = reopened.jobs(options);
			const restored = await port.receipt(admitted.id, () => {});
			assert.equal(restored.state, "queued");
			assert.deepEqual(restored.checkpoint, { stage: "complete" });
			const done = await port.wait(admitted.id, () => {});
			assert.equal(done.state, "done", JSON.stringify(done));
			assert.deepEqual(done.result, { observed: 1 });
			assert.equal(Object.isFrozen(done), true);
			await reopened.close();
			reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
			port = reopened.jobs(options);
			assert.deepEqual(await port.receipt(admitted.id, () => {}), done);
			assert.equal(m.f.requests.length, 1);
			assert.equal(preparations, 1);
			await assert.rejects(
				reopened.jobs({ ...options, namespace: "foreign" }).receipt(admitted.id, () => {}),
				/unknown|missing/i,
			);
		} finally {
			await reopened?.close();
			await m.close();
		}
	},
);

// Admission and execution are separate authority boundaries; an admitted job must recheck before effects.
test(
	"WebUI job port: late authority revocation stops the approved checkpoint/effect path",
	{ timeout: 10000 },
	async () => {
		const entered = deferred(),
			release = deferred();
		let allowed = true;
		const m = await runtimeFixture((endpoint) => ({
			jobs: [
				{
					id: "revocation",
					version: 1,
					authorize: () => {
						if (!allowed) throw new Error("HUMAN-REVOKED");
					},
					run: async (ctx) => {
						entered.resolve();
						await release.promise;
						ctx.check();
						await effect(endpoint);
						await ctx.complete({ done: true });
					},
				},
			],
		}));
		try {
			const port = m.runtime.jobs(options),
				ref = m.runtime.view().conversations[0]!;
			const admitted = await port.start(
				{ requestId: "late", actorId: "human", target: ref, definition: "revocation", payload: {} },
				() => {},
			);
			await reached(entered.promise);
			allowed = false;
			release.resolve();
			const settled = await port.wait(admitted.id, () => {});
			assert.equal(settled.state, "unknown");
			assert.equal(m.f.requests.length, 0);
			assert.equal(m.runtime.view().phase, "ready");
		} finally {
			release.resolve();
			await m.close();
		}
	},
);
