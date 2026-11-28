import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rename, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fixture } from "../../../packages/agent/test/fixture.ts";
import { openStorageMaintenance } from "@pakka/agent";
import { startPocket } from "../src/bootstrap.ts";
import { createProductBackup } from "../src/maintenance-backup.ts";
import { restoreProduct, resumeRestoredProduct } from "../src/maintenance-restore.ts";

async function maintenanceFixture() {
	const f = await fixture();
	const home = join(f.root, "home");
	await mkdir(home);
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	try {
		app = await startPocket({
			owner: "Owner",
			runtime: {
				cwd: f.cwd,
				dataDir: f.dataDir,
				endpoint: f.endpoint,
				model: "local-model",
				apiKey: "local-only",
				limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 4 },
			},
		});
		const view = app.runtime.view();
		return {
			f,
			home,
			app,
			target: {
				version: 1 as const,
				dataDir: f.dataDir,
				sessionId: view.sessionId,
				sessionFile: view.sessionFile,
			},
			async close() {
				await app?.close();
				await f.close();
			},
		};
	} catch (error) {
		await app?.close();
		await f.close();
		throw error;
	}
}

// These conditions require real SQLite/files, but no new process per CLI flag.
for (const condition of ["missing database", "missing data root"]) {
	test("maintenance restores " + condition + " and preserves the original bytes or absence", async () => {
		const m = await maintenanceFixture();
		try {
			await m.app.close();
			const backup = join(m.f.root, "known-good");
			await createProductBackup(m.target, backup);
			await rename(
				condition === "missing database" ? m.target.sessionFile : m.target.dataDir,
				join(m.f.root, "preserved-unavailable-source"),
			);
			const restored = await restoreProduct(m.home, backup, m.target, m.target.sessionId);
			assert.equal(restored.status, "held");
			assert.ok(restored.preserved);
			assert.equal((await readFile(m.target.sessionFile)).subarray(0, 16).toString(), "SQLite format 3\0");
			const original = JSON.parse(await readFile(join(restored.preserved, "preservation.json"), "utf8"));
			assert.equal(original.kind, "unverified-original-bytes");
			if (condition === "missing data root") assert.deepEqual(original.missingRoots, [0]);
			const hold = JSON.parse(await readFile(join(m.target.dataDir, "pakka-restored-hold.json"), "utf8"));
			assert.equal(hold.sessionId, m.target.sessionId);
			assert.equal(hold.restoreId, restored.restoreId);
			const store = await openStorageMaintenance({
				storageDir: dirname(m.target.sessionFile),
				expectedSessionId: m.target.sessionId,
				stores: [],
			});
			try {
				assert.equal(store.identity.sessionId, m.target.sessionId);
			} finally {
				await store.close();
			}
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	});
}

test("records-only restored work rejects absent/wrong fingerprints and retains the original record after confirmation", async () => {
	const m = await maintenanceFixture();
	try {
		await m.app.runtime.records({ namespace: "review-pending" }).commit(
			{
				requestId: "planned",
				reads: [{ key: "run", version: 0 }],
				writes: [{ key: "run", data: { stage: "planned" } }],
				append: [],
				work: [{ key: "run", state: "planned" }],
			},
			() => {},
		);
		await m.app.close();
		const backup = join(m.f.root, "pending-backup");
		await createProductBackup(m.target, backup);
		const restored = await restoreProduct(m.home, backup, m.target, m.target.sessionId);
		assert.ok(restored.restoreId);
		const view = await resumeRestoredProduct(m.home, m.target, restored.restoreId);
		assert.ok("pendingRecords" in view);
		assert.equal(view.pendingTasks, 0);
		assert.equal(view.queuedInputs, 0);
		assert.equal(view.pendingRecords, 1);
		assert.match(view.reviewWork ?? "", /^[0-9a-f]{64}$/);
		await assert.rejects(
			resumeRestoredProduct(m.home, m.target, restored.restoreId, m.target.sessionId),
			/work|review/i,
		);
		await assert.rejects(
			resumeRestoredProduct(m.home, m.target, restored.restoreId, m.target.sessionId, "0".repeat(64)),
			/work|review/i,
		);
		await access(join(m.target.dataDir, "pakka-restored-hold.json"));
		const accepted = await resumeRestoredProduct(
			m.home,
			m.target,
			restored.restoreId,
			m.target.sessionId,
			view.reviewWork,
		);
		assert.ok("status" in accepted);
		assert.equal(accepted.status, "resumed");
		assert.equal(accepted.workReview?.pendingRecords, 1);
		const journal = JSON.parse(
			await readFile(join(m.home, "maintenance", "restore-" + restored.restoreId, "operation.json"), "utf8"),
		);
		assert.equal(journal.workReview.fingerprint, view.reviewWork);
		assert.equal(journal.workReview.pendingRecords, 1);
		const store = await openStorageMaintenance({
			storageDir: dirname(m.target.sessionFile),
			expectedSessionId: m.target.sessionId,
			stores: [],
		});
		try {
			const retained = await store.work();
			assert.equal(retained.pendingRecords, 1);
			assert.equal(retained.pendingTasks, 0);
			assert.equal(retained.queuedInputs, 0);
		} finally {
			await store.close();
		}
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
