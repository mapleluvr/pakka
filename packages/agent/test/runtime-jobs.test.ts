import { test } from "node:test";
import assert from "node:assert/strict";
import { deferred } from "./fixture.ts";
import { inferencePolicy, target } from "./strategy-fixture.ts";
import { runtimeFixture, runtimeLimits } from "./runtime-fixture.ts";

for (const transition of ["reload", "deactivate", "edit", "fork"] as const) {
	test(
		`M1: ${transition} quarantines one Conversation's late job without invalidating a peer`,
		{ timeout: 15000 },
		async () => {
			const arrived = deferred(),
				release = deferred();
			const m = await runtimeFixture(inferencePolicy, runtimeLimits, async (payload) => {
				if (payload.model === "summary-model" && JSON.stringify(payload).includes("HOLD-A-AUX")) {
					arrived.resolve();
					await release.promise;
				}
				return { text: "SCOPED-AUX-RESULT" };
			});
			try {
				const a = m.runtime.root(),
					b = await m.runtime.conversation(await m.runtime.createConversation({ key: "peer" }));
				await a.connect("input", ["input.submit"]).submit({ key: "seed", text: "A-JOB-SOURCE" });
				await a.waitForIdle();
				await b.connect("input", ["input.submit"]).submit({ key: "seed", text: "B-JOB-SOURCE" });
				await b.waitForIdle();
				const ca = a.connect("owner", [
					"real_context.write",
					"context_artifacts.write",
					"model.infer",
					"branch.control",
				]);
				const cb = b.connect("owner", ["real_context.write", "context_artifacts.write", "model.infer"]);
				for (const client of [ca, cb])
					client.activateStrategy({
						id: "strategy",
						hooks: ["real_context.write", "context_artifacts.write"],
					});
				const ba = ca.bindStrategy("strategy"),
					bb = cb.bindStrategy("strategy"),
					fa = ba.readFrame(),
					fb = bb.readFrame();
				const spec = { planId: "same-plan", targetEntryIds: [target(fa)], maxCalls: 2 };
				assert.throws(() => bb.createJob(fa.basis, spec), /scope|basis/i);
				const ja = ba.createJob(fa.basis, spec),
					jb = bb.createJob(fb.basis, { ...spec, targetEntryIds: [target(fb)] });
				assert.throws(
					() => bb.artifacts.append(ja.scope, { expectedVersion: 0, records: ["FOREIGN"] }),
					/scope|basis/i,
				);
				const pending = ja.infer({ modelKey: "summary", prompt: "HOLD-A-AUX", maxOutputTokens: 64 });
				await arrived.promise;
				if (transition === "reload") await a.reload();
				else if (transition === "deactivate") ca.deactivateStrategy("strategy");
				else if (transition === "edit")
					assert.equal(
						(await ca.commit(ca.capture(), { type: "edit", targetId: target(fa), text: "CHANGED-A-SOURCE" }))
							.status,
						"committed",
					);
				else {
					ca.branch(ca.capture(), target(fa));
					await a.waitForIdle();
				}
				release.resolve();
				assert.equal((await pending).status, "quarantined");
				assert.throws(() => ja.check(), /inactive|scope|source|cancelled/i);
				jb.check();
				const peerResult = await jb.infer({
					modelKey: "summary",
					prompt: "B-AUX-STILL-AUTHORIZED",
					maxOutputTokens: 128,
				});
				assert.equal(peerResult.status, "completed");
				assert.equal(
					bb.artifacts.append(jb.scope, { expectedVersion: 0, records: ["B-VALID-RESULT"] }).status,
					"committed",
				);
				assert.deepEqual(bb.readFrame().artifacts.records, ["B-VALID-RESULT"]);
				assert.equal(b.view().phase, "ready");
				assert.equal(m.f.requests.length, 4);
				assert.equal(m.f.requests[2]?.max_tokens, 64);
				assert.equal(m.f.requests[3]?.max_tokens, 128);
				assert.equal(m.runtime.view().budget.auxiliaryAttempts, 2);
				await assert.rejects(
					ja.infer({ modelKey: "summary", prompt: "UNAUTHORIZED-LATE-A" }),
					/inactive|scope|source|cancelled/i,
				);
				assert.equal(m.f.requests.length, 4);
			} finally {
				release.resolve();
				await m.close();
			}
		},
	);
}
