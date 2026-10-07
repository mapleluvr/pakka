import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { deferred, fixture, seed } from "./fixture.ts";
import { binding, inferencePolicy, target } from "./strategy-fixture.ts";

async function inferenceJournal(dataDir: string): Promise<string> {
	const root = join(dataDir, "artifacts");
	for (const directory of await readdir(root))
		for (const file of await readdir(join(root, directory))) {
			const path = join(root, directory, file);
			const firstLine = (await readFile(path, "utf8")).split("\n")[0];
			if (JSON.parse(firstLine).namespace === "strategy:inference") return path;
		}
	throw new Error("Inference journal missing from fixture");
}

for (const transition of ["reload", "newSession"] as const)
	test(`an auxiliary audit write fault during ${transition} remains isolated to its session`, async () => {
		const auxiliaryEntered = deferred(),
			auxiliaryRelease = deferred();
		const toolEntered = deferred(),
			toolRelease = deferred();
		let path: string | undefined;
		const f = await fixture(
			{
				tools: [
					{
						name: "hold",
						description: "hold",
						parameters: { type: "object", properties: {} },
						execute: async () => {
							toolEntered.resolve();
							await toolRelease.promise;
							return "DONE";
						},
					},
				],
			},
			async (payload) => {
				if (payload.model === "summary-model") {
					auxiliaryEntered.resolve();
					await auxiliaryRelease.promise;
				}
				if (
					payload.messages.some((message) => JSON.stringify(message.content).includes("HOLD-RELOAD")) &&
					!payload.messages.some((message) => message.role === "tool")
				)
					return { tool: "hold" };
				return { text: "ANSWER" };
			},
		);
		try {
			const host = await f.start(inferencePolicy(f.endpoint));
			const { client: user } = await seed(host);
			const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
			owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
			const b = binding(owner),
				frame = b.readFrame();
			const job = b.createJob(frame.basis, {
				planId: "transition-fault",
				targetEntryIds: [target(frame)],
				maxCalls: 2,
			});
			const pending = job.infer({ modelKey: "summary", prompt: "SOURCE", maxOutputTokens: 64 });
			await auxiliaryEntered.promise;
			await user.submit({ key: "hold", text: "HOLD-RELOAD" });
			await toolEntered.promise;
			path = await inferenceJournal(f.dataDir);
			await chmod(path, 0o444);
			const lifecycle = host[transition]();
			const settled = transition === "reload" ? assert.rejects(lifecycle, /journal|storage/i) : lifecycle;
			await assert.rejects(pending, /storage/i);
			assert.equal(host.view().phase, "transitioning");
			toolRelease.resolve();
			auxiliaryRelease.resolve();
			await settled;
			assert.equal(f.requests.length, 3);
			if (transition === "reload") {
				assert.equal(host.view().phase, "failed");
				await assert.rejects(user.submit({ key: "blocked", text: "DO-NOT-SEND" }), /failed/);
				await host.newSession();
			}
			assert.equal(host.view().phase, "ready");
			assert.notEqual(host.view().sessionId, frame.sessionId);
			const nextFrame = b.readFrame();
			assert.deepEqual(nextFrame.artifacts.records, []);
			await user.submit({ key: "recovered", text: "FRESH-SOURCE" });
			await host.waitForIdle();
			const fresh = b.readFrame();
			const nextJob = b.createJob(fresh.basis, {
				planId: "new-authority",
				targetEntryIds: [target(fresh)],
				maxCalls: 1,
			});
			assert.equal(
				(await nextJob.infer({ modelKey: "summary", prompt: "FRESH-SOURCE", maxOutputTokens: 64 })).status,
				"completed",
			);
			assert.equal(host.view().phase, "ready");
			assert.equal(f.requests.length, 5);
		} finally {
			toolRelease.resolve();
			auxiliaryRelease.resolve();
			if (path) await chmod(path, 0o666);
			await f.close();
		}
	});
