import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemo } from "../src/index.ts";
import { openPatchouli, type PatchouliService, type ResearchDriver } from "../src/patchouli.ts";
import { createMasResearchDriver, createPatchouliTools } from "../src/patchouli-mas.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createMas } from "../../mas/src/index.ts";
function gate() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
const owner = { id: "owner", check() {} };
async function fixture(t: import("node:test").TestContext, finishFirst = false) {
	const dir = await mkdtemp(join(tmpdir(), "memo-cancel-review-")),
		file = join(dir, "memo.sqlite"),
		memo = openMemo({ file });
	memo.createLibrary({ id: "work", title: "Work", ownerId: "owner" });
	const held = [gate(), gate()],
		release = [gate(), gate()],
		aborted = [false, false];
	let runId = "",
		step = 0,
		service: PatchouliService | undefined;
	const tools = createPatchouliTools(() => {
		if (!service) throw Error("Not bound");
		return service;
	});
	const runtime = await runtimeFixture(
		{
			tools: [
				...tools.tools,
				{
					name: "hold",
					description: "Controlled test barrier",
					parameters: {
						type: "object",
						properties: { slot: { type: "integer" } },
						required: ["slot"],
						additionalProperties: false,
					},
					async execute(args, signal) {
						const slot = Number(args.slot) - 1;
						held[slot]!.resolve();
						await new Promise<void>((resolve, reject) => {
							const stop = () => {
								aborted[slot] = true;
								reject(Error("Native task aborted"));
							};
							if (signal?.aborted) stop();
							else {
								signal?.addEventListener("abort", stop, { once: true });
								void release[slot]!.promise.then(() => {
									signal?.removeEventListener("abort", stop);
									resolve();
								});
							}
						});
						return "released";
					},
				},
			],
		},
		undefined,
		() => {
			const n = step++;
			if (finishFirst) {
				if (n === 0) return { tool: "research_finish", args: { runId } };
				if (n === 1) return { tool: "hold", args: { slot: 1 } };
				return { text: "finished" };
			}
			if (n === 0) return { tool: "hold", args: { slot: 1 } };
			if (n === 2) return { tool: "hold", args: { slot: 2 } };
			return { text: "answered" };
		},
	);
	const mas = await createMas({ runtime: runtime.runtime, namespace: "review-cancel", maxPending: 4 });
	await mas.bootstrap([{ key: "patchouli", owner: "owner", lifetime: "persistent" }]);
	await mas.activate();
	const target = (await mas.view()).members[0]!.ref,
		sender = mas.connect({ principal: "owner", source: null, grants: ["send", "observe", "abort"] });
	const makeDriver = () => createMasResearchDriver({ runtime: runtime.runtime, mas, client: sender, target });
	const driver = await makeDriver(),
		services: PatchouliService[] = [];
	const open = (use: ResearchDriver = driver) => {
		const s = openPatchouli({
			file,
			id: "p",
			actorId: "patchouli",
			scope: [{ libraryId: "work", write: false }],
			driver: use,
			authorize(id) {
				if (id !== "owner") throw Error("denied");
			},
		});
		services.push(s);
		service = s;
		return s;
	};
	t.after(async () => {
		release.forEach((g) => g.resolve());
		tools.revoke();
		for (const s of services) s.close();
		await runtime.close();
		memo.close();
		await rm(dir, { recursive: true, force: true });
	});
	return {
		open,
		driver,
		makeDriver,
		held,
		release,
		aborted,
		runtime,
		async request(client: ReturnType<PatchouliService["connect"]>, id = "one") {
			const r = await client.request({ requestId: id, subject: id, refs: [] });
			runId = r.runId;
			return r;
		},
	};
}
test(
	"persisted cancel is resumed when original acceptance becomes visible after Memo reopen",
	{ timeout: 20000 },
	async (t) => {
		const f = await fixture(t);
		let visible = false;
		const driver: ResearchDriver = {
			...f.driver,
			async send(...args) {
				await f.driver.send(...args);
				throw Error("lost receipt");
			},
			async lookup(...args) {
				return visible ? f.driver.lookup(...args) : null;
			},
		};
		const service = f.open(driver),
			client = service.connect(owner),
			run = await f.request(client);
		await client.setEnabled(true);
		await client.advance();
		await f.held[0]!.promise;
		await client.cancel(run.runId);
		assert.equal((await client.get(run.runId)).cancelRequested, true);
		assert.equal(f.aborted[0], false);
		service.close();
		visible = true;
		const recovered = f.open(driver).connect(owner);
		await recovered.advance();
		assert.equal(
			f.aborted[0],
			true,
			"explicit recovery must execute the saved cancellation of the now-known delivery",
		);
		assert.equal((await recovered.get(run.runId)).state, "cancelled");
		assert.equal(f.runtime.f.requests.length, 1);
	},
);
test(
	"business completion retains cancellation of its still-running native generation",
	{ timeout: 20000 },
	async (t) => {
		const f = await fixture(t, true),
			client = f.open().connect(owner),
			run = await f.request(client);
		await client.setEnabled(true);
		await client.advance();
		await f.held[0]!.promise;
		assert.equal((await client.get(run.runId)).state, "completed");
		await client.cancel(run.runId);
		assert.equal(
			f.aborted[0],
			true,
			"finish must not remove the control path for the original live generation",
		);
		assert.equal((await client.get(run.runId)).cancelRequested, true);
	},
);
for (const failure of ["before-effect", "lost-response"] as const)
	test("explicit advance resumes failed cancellation: " + failure, { timeout: 20000 }, async (t) => {
		const f = await fixture(t);
		let first = true;
		const faulty: ResearchDriver = {
			...f.driver,
			async cancel(...args) {
				if (first) {
					first = false;
					if (failure === "lost-response") await f.driver.cancel(...args);
					throw Error("Controlled cancellation failure");
				}
				await f.driver.cancel(...args);
			},
		};
		const service = f.open(faulty),
			a = service.connect(owner),
			run = await f.request(a);
		await a.setEnabled(true);
		await a.advance();
		await f.held[0]!.promise;
		await a.cancel(run.runId);
		assert.equal((await a.get(run.runId)).executionHeld, true);
		service.close();
		const b = f.open(await f.makeDriver()).connect(owner);
		await b.advance();
		assert.equal(f.aborted[0], true);
		assert.equal((await b.get(run.runId)).executionHeld, false);
		assert.equal((await b.get(run.runId)).state, "cancelled");
		assert.equal(f.runtime.f.requests.length, 1);
	});
for (const stage of ["before-native", "after-native"] as const)
	test("old cancellation cannot reach the next run: " + stage, { timeout: 20000 }, async (t) => {
		const f = await fixture(t),
			entered = gate(),
			proceed = gate();
		t.after(() => proceed.resolve());
		const delayed: ResearchDriver = {
			...f.driver,
			async cancel(...args) {
				if (stage === "after-native") await f.driver.cancel(...args);
				entered.resolve();
				await proceed.promise;
				if (stage === "before-native") await f.driver.cancel(...args);
			},
		};
		const a = f.open(delayed).connect(owner),
			b = f.open(await f.makeDriver()).connect(owner),
			first = await f.request(a);
		await a.setEnabled(true);
		await a.advance();
		await f.held[0]!.promise;
		const second = await f.request(b, "two"),
			cancelling = a.cancel(first.runId);
		await entered.promise;
		f.release[0]!.resolve();
		await f.runtime.runtime.waitForIdle();
		// The next run may stay queued or start after another handle confirms the same cancel.
		await b.advance();
		proceed.resolve();
		await cancelling;
		await b.advance();
		const next = await b.get(second.runId);
		assert.equal(next.state, "waiting");
		// If old abort reached the new input before its tool, the original delivery is unanswered.
		assert.notEqual(next.deliveryState, "unanswered", "a previous run must not abort a later delivery");
		assert.equal(f.aborted[1], false, "old cancellation must not stop the second native tool");
		f.release[1]!.resolve();
		await f.runtime.runtime.waitForIdle();
		await b.advance();
		assert.equal((await b.get(second.runId)).deliveryState, "done");
		await a.cancel(first.runId);
		assert.equal(
			(await b.get(second.runId)).state,
			"waiting",
			"cancel of history must not affect current research",
		);
	});
