import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rename, rm } from "node:fs/promises";
import { createHost, createRuntime } from "../src/index.ts";
import { deferred, text } from "./fixture.ts";
import { inferencePolicy, target } from "./strategy-fixture.ts";
import { runtimeFixture, runtimeLimits } from "./runtime-fixture.ts";

test(
	"M1: Session auxiliary quota is shared across equal strategy IDs and retained after cancellation/reopen",
	{ timeout: 15000 },
	async () => {
		const arrived = deferred(),
			release = deferred();
		const m = await runtimeFixture(
			inferencePolicy,
			{ ...runtimeLimits, maxAuxiliaryAttempts: 1 },
			async (payload) => {
				if (payload.model === "summary-model") {
					arrived.resolve();
					await release.promise;
				}
				return { text: "local" };
			},
		);
		let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
		const { runtime, config } = m;
		try {
			const a = runtime.root(),
				peerRef = await runtime.createConversation({ key: "peer" }),
				b = await runtime.conversation(peerRef);
			await a.connect("user", ["input.submit"]).submit({ key: "seed", text: "A-SOURCE" });
			await a.waitForIdle();
			await b.connect("user", ["input.submit"]).submit({ key: "seed", text: "B-SOURCE" });
			await b.waitForIdle();
			const bind = (host: typeof a) => {
				const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
				owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
				const binding = owner.bindStrategy("strategy"),
					frame = binding.readFrame();
				return binding.createJob(frame.basis, {
					planId: "shared-cap",
					targetEntryIds: [target(frame)],
					maxCalls: 2,
				});
			};
			const ja = bind(a),
				jb = bind(b);
			const pending = ja.infer({ modelKey: "summary", prompt: "A-AUX-ONLY", maxOutputTokens: 64 });
			await arrived.promise;
			const refused = await jb.infer({
				modelKey: "summary",
				prompt: "B-MUST-NOT-DISPATCH",
				maxOutputTokens: 128,
			});
			assert.notEqual(refused.status, "completed");
			assert.equal(m.f.requests.filter((request) => request.model === "summary-model").length, 1);
			assert.equal(runtime.view().budget.auxiliaryAttempts, 1);
			ja.cancel("explicit test cancellation");
			release.resolve();
			assert.equal((await pending).status, "quarantined");
			assert.equal(
				runtime.view().budget.auxiliaryAttempts,
				1,
				"cancel must not refund an ambiguous sent request",
			);
			const file = runtime.view().sessionFile;
			await runtime.close();
			reopened = await createRuntime({ ...config, reopenSessionFile: file });
			assert.equal(reopened.view().budget.auxiliaryAttempts, 1);
			assert.equal(m.f.requests.filter((request) => request.model === "summary-model").length, 1);
		} finally {
			release.resolve();
			try {
				await reopened?.close();
				await runtime.close();
			} finally {
				await m.close();
			}
		}
	},
);

test("M1: unknown shared storage seals every local member but not another Session", async () => {
	const m = await runtimeFixture(),
		independent = await runtimeFixture();
	let damaged: string | undefined;
	try {
		const a = m.runtime.root(),
			b = await m.runtime.conversation(await m.runtime.createConversation({ key: "peer" }));
		const owner = a.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "writer", hooks: ["real_context.write"] });
		damaged = a.view().sessionFile;
		await rename(damaged, damaged + ".saved");
		await mkdir(damaged);
		const decision = await owner.commit(owner.capture(), {
			type: "cut",
			summary: "MUST-SEAL-SHARED-STORAGE",
			firstKeptEntryId: null,
			tokensBefore: 0,
		});
		assert.equal(decision.status, "unknown");
		assert.equal(a.view().phase, "failed");
		assert.equal(b.view().phase, "failed");
		assert.equal(m.runtime.view().phase, "failed");
		assert.throws(() => b.connect("blocked", ["input.submit"]), /failed/i);
		assert.equal(m.f.requests.length, 0);
		const other = independent.runtime.root();
		await other.connect("user", ["input.submit"]).submit({ key: "ok", text: "OTHER-SESSION-SURVIVES" });
		await independent.runtime.waitForIdle();
		assert.equal(independent.f.requests.length, 1);
		assert.match(text(independent.f.requests[0]!), /OTHER-SESSION-SURVIVES/);
	} finally {
		if (damaged) {
			await rm(damaged, { recursive: true });
			await rename(damaged + ".saved", damaged);
		}
		try {
			await m.close();
		} finally {
			await independent.close();
		}
	}
});

test("M1: another runtime cannot open a live writer's same storage", async () => {
	const m = await runtimeFixture();
	let duplicate: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const attempt = createRuntime({ ...m.config, reopenSessionFile: m.runtime.view().sessionFile }).then(
			(opened) => {
				duplicate = opened;
				return opened;
			},
		);
		await assert.rejects(attempt, /writer|locked/i);
		assert.equal(m.f.requests.length, 0);
	} finally {
		try {
			await duplicate?.close();
		} finally {
			await m.close();
		}
	}
});

test("M1: legacy host cannot bypass a managed runtime's persistent quotas", async () => {
	const m = await runtimeFixture();
	let legacy: Awaited<ReturnType<typeof createHost>> | undefined;
	try {
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		const attempt = createHost({ ...m.config, reopenSessionFile: file }).then((opened) => {
			legacy = opened;
			return opened;
		});
		await assert.rejects(attempt, /managed|runtime/i);
		assert.equal(m.f.requests.length, 0);
	} finally {
		try {
			await legacy?.dispose();
		} finally {
			await m.close();
		}
	}
});

test(
	"M1: queued cancellation stays unknown until an exact durable withdrawal receipt",
	{ timeout: 15000 },
	async () => {
		const entered = deferred(),
			release = deferred(),
			withdrawn = deferred();
		const m = await runtimeFixture(
			{
				tools: [
					{
						name: "gate",
						description: "hold a native tool boundary",
						parameters: { type: "object", properties: {} },
						execute: async () => {
							entered.resolve();
							await release.promise;
							return "done";
						},
					},
				],
			},
			runtimeLimits,
			(_payload, count) => (count === 1 ? { tool: "gate" } : { text: "done" }),
		);
		try {
			const host = m.runtime.root(),
				user = host.connect("user", ["input.submit"]);
			await user.submit({ key: "start", text: "KEEP-NATIVE-TOOL-ACTIVE" });
			await entered.promise;
			const queued = await user.submit({ key: "cancel-me", text: "WITHDRAW-ME", mode: "followUp" });
			const stop = host.subscribe((event) => {
				if (event.type === "receipt" && event.receipt.id === queued.id && event.receipt.state === "released")
					withdrawn.resolve();
			});
			const requested = user.cancelQueued();
			assert.equal(requested.length, 1);
			assert.equal(
				requested[0]!.state,
				"unknown",
				"requesting abort is not a durable absence/withdrawal receipt",
			);
			await withdrawn.promise;
			assert.equal(user.receipt(queued.id)?.state, "released");
			stop();
			release.resolve();
			await m.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 2);
			assert.doesNotMatch(text(m.f.requests[1]!), /WITHDRAW-ME/);
			await assert.rejects(user.submit({ key: "cancel-me", text: "WITHDRAW-ME" }), /conflict/i);
			await user.submit({ key: "fresh", text: "WITHDRAW-ME" });
			await m.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 3);
			assert.match(text(m.f.requests[2]!), /WITHDRAW-ME/);
		} finally {
			release.resolve();
			await m.close();
		}
	},
);
