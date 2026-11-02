import { test } from "node:test";
import assert from "node:assert/strict";
import { deferred, fixture, seed } from "./fixture.ts";
import { binding, inferencePolicy, target } from "./strategy-fixture.ts";
import { blockSqliteWrites } from "./native-storage.ts";
import type { SourceJob } from "../src/index.ts";

for (const transition of ["reload", "newSession"] as const)
	test(`an auxiliary audit write fault during ${transition} seals the old Session and permits explicit fresh recovery`, async () => {
		const entered = deferred(),
			release = deferred();
		const f = await fixture({}, async (payload) => {
			if (payload.model === "summary-model") {
				entered.resolve();
				await release.promise;
			}
			return { text: "ANSWER" };
		});
		let unblock: (() => void) | undefined;
		let pending: ReturnType<SourceJob["infer"]> | undefined;
		let lifecycle: Promise<void> | undefined;
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
			pending = job.infer({ modelKey: "summary", prompt: "SOURCE", maxOutputTokens: 64 });
			await entered.promise;
			unblock = blockSqliteWrites(host.view().sessionFile);
			lifecycle = host[transition]();
			const settled =
				transition === "reload" ? assert.rejects(lifecycle, /journal|storage|database/i) : lifecycle;
			await assert.rejects(pending, /storage|journal/i);
			unblock();
			unblock = undefined;
			release.resolve();
			await settled;
			assert.equal(f.requests.length, 2, "the failed audit cannot refund or resend the original request");
			if (transition === "reload") {
				assert.equal(host.view().phase, "failed");
				await assert.rejects(user.submit({ key: "blocked", text: "DO-NOT-SEND" }), /failed/);
				await host.newSession();
			}
			assert.equal(host.view().phase, "ready");
			assert.notEqual(host.view().sessionId, frame.sessionId);
			assert.deepEqual(b.readFrame().artifacts.records, []);
			await user.submit({ key: "recovered", text: "FRESH-SOURCE" });
			await host.waitForIdle();
			const fresh = b.readFrame();
			const next = b.createJob(fresh.basis, {
				planId: "new-authority",
				targetEntryIds: [target(fresh)],
				maxCalls: 1,
			});
			assert.equal(
				(await next.infer({ modelKey: "summary", prompt: "FRESH-SOURCE", maxOutputTokens: 64 })).status,
				"completed",
			);
			assert.equal(host.view().phase, "ready");
			assert.equal(f.requests.length, 4);
		} finally {
			unblock?.();
			release.resolve();
			if (pending) await Promise.allSettled([pending]);
			if (lifecycle) await Promise.allSettled([lifecycle]);
			await f.close();
		}
	});
