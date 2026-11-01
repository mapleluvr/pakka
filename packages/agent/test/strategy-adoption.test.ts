import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { readStorageText, readNativeDocument, rewriteNativeDocument } from "./native-storage.ts";
import { deferred, fixture, seed } from "./fixture.ts";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";
import type { Host, StrategyBinding } from "../src/index.ts";

function activate(host: Host): StrategyBinding {
	const owner = host.connect("owner", ["real_context.write", "context_artifacts.write", "model.infer"]);
	owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
	return binding(owner);
}
function job(b: StrategyBinding, planId: string) {
	const frame = b.readFrame();
	return b.createJob(frame.basis, {
		planId,
		targetEntryIds: [target(frame)],
		maxCalls: 2,
		requireArtifactReceipt: true,
	});
}

for (const invalid of ["nonexistent", "foreign-job", "duplicate", "incomplete", "already-adopted"] as const)
	test(`invalid ${invalid} adoption changes neither artifact bytes nor intent`, async () => {
		const entered = deferred(),
			release = deferred();
		const f = await fixture({}, async (payload) => {
			if (invalid === "incomplete" && payload.model === "summary-model") {
				entered.resolve();
				await release.promise;
			}
			return { text: "SUMMARY" };
		});
		let pending: Promise<unknown> | undefined;
		try {
			const host = await f.start(inferencePolicy(f.endpoint));
			await seed(host);
			const b = activate(host),
				frame = b.readFrame();
			const initial = (await b.artifacts.append(frame.basis, { expectedVersion: 0, records: [{ initial: true }] }));
			assert.equal(initial.status, "committed");
			const source = job(b, "source"),
				destination = invalid === "foreign-job" ? job(b, "destination") : source;
			let attemptIds = ["nonexistent-attempt"],
				version = initial.version;
			if (invalid === "incomplete") {
				pending = source.infer({ modelKey: "summary", prompt: "ONCE" });
				await entered.promise;
				attemptIds = [b.audit()[0].attemptId];
			} else if (invalid !== "nonexistent") {
				const result = await source.infer({ modelKey: "summary", prompt: "ONCE" });
				assert.equal(result.status, "completed");
				attemptIds = [result.attemptId];
				if (invalid === "duplicate") attemptIds.push(result.attemptId);
				if (invalid === "already-adopted") {
					const adopted = (await b.artifacts.append(source.scope, {
						expectedVersion: version,
						records: [{ candidate: true }],
						attemptIds,
					}));
					assert.equal(adopted.status, "committed");
					version = adopted.version;
				}
			}
			const before = await readStorageText(host.view().sessionFile);
			let rejected = false;
			try {
				const receipt = (await b.artifacts.append(destination.scope, {
					expectedVersion: version,
					records: [{ mustNotLand: true }],
					attemptIds,
				}));
				rejected = receipt.status !== "committed";
			} catch {
				rejected = true;
			}
			assert.equal(
				await readStorageText(host.view().sessionFile),
				before,
				"invalid association must be checked before physical append",
			);
			await assert.rejects(access(join(f.dataDir, "artifacts")), { code: "ENOENT" });
			assert.equal(rejected, true);
			assert.equal(host.view().phase, "ready", "invalid caller input must not poison storage");
			assert.equal(f.requests.length, invalid === "nonexistent" ? 1 : 2);
		} finally {
			release.resolve();
			await pending;
			await f.close();
		}
	});

for (const fault of ["rollback", "transaction-id"] as const)
	test(`settled adoption detects physical ${fault} on reopen before another HTTP`, async () => {
		const f = await fixture();
		try {
			const first = await f.start(inferencePolicy(f.endpoint));
			await seed(first);
			const b = activate(first),
				frame = b.readFrame();
			const initial = (await b.artifacts.append(frame.basis, { expectedVersion: 0, records: [{ initial: true }] }));
			assert.equal(initial.status, "committed");
			const prefix = await readNativeDocument(first.view().sessionFile, "pakka.strategy-journals"),
				source = job(b, "paid-once");
			const result = await source.infer({ modelKey: "summary", prompt: "EXACT-TARGET" });
			assert.equal(result.status, "completed");
			assert.equal(
				(await b.artifacts.append(source.scope, {
					expectedVersion: initial.version,
					records: [{ candidate: true }],
					attemptIds: [result.attemptId],
				})).status,
				"committed",
			);
			const file = first.view().sessionFile;
			await first.dispose();
			const key = initial.journalPath.split("#journal/")[1]!;
			if (fault === "rollback") {
				await rewriteNativeDocument(file, "pakka.strategy-journals", undefined, value => {
					const heads = value.heads as Record<string, typeof value>;
					heads[key] = (prefix.value.heads as Record<string, typeof value>)[key]!;
					return value;
				});
			} else {
				let checksum = "";
				await rewriteNativeDocument(file, "pakka.strategy-batch", key + ".2", value => {
					const { checksum: _checksum, ...payload } = value;
					payload.transactionId = "different-valid-physical-transaction";
					checksum = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
					return { ...payload, checksum };
				});
				await rewriteNativeDocument(file, "pakka.strategy-journals", undefined, value => {
					const heads = value.heads as Record<string, typeof value>;
					heads[key]!.checksum = checksum;
					return value;
				});
			}
			const reopened = await f.start({ ...inferencePolicy(f.endpoint), reopenSessionFile: file });
			const fresh = activate(reopened);
			assert.throws(() => fresh.readFrame(), /adopt|transaction|storage|receipt/i);
			assert.equal(
				f.requests.length,
				2,
				"a missing adopted transaction must never authorize inference replay",
			);
			await reopened.newSession();
			assert.equal(
				fresh.readFrame().artifacts.version,
				0,
				"explicit new session retains its recovery boundary",
			);
		} finally {
			await f.close();
		}
	});

test("all settled adoptions survive later ordinary appends and trusted reopen", async () => {
	const f = await fixture();
	try {
		const first = await f.start(inferencePolicy(f.endpoint));
		await seed(first);
		const b = activate(first);
		for (let i = 0; i < 2; i++) {
			const source = job(b, "adopt-" + i),
				result = await source.infer({ modelKey: "summary", prompt: "TARGET-" + i });
			const frame = b.readFrame();
			assert.equal(
				(await b.artifacts.append(source.scope, {
					expectedVersion: frame.artifacts.version,
					records: [{ candidate: i }],
					attemptIds: [result.attemptId],
				})).status,
				"committed",
			);
			source.cancel();
			const next = b.readFrame();
			assert.equal(
				(await b.artifacts.append(next.basis, {
					expectedVersion: next.artifacts.version,
					records: [{ progress: i }],
				})).status,
				"committed",
			);
		}
		const file = first.view().sessionFile;
		await first.dispose();
		const second = await f.start({ ...inferencePolicy(f.endpoint), reopenSessionFile: file });
		assert.equal(activate(second).readFrame().artifacts.version, 4);
		assert.equal(f.requests.length, 3);
	} finally {
		await f.close();
	}
});
