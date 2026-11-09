import test from "node:test";
import assert from "node:assert/strict";
import { join, dirname, toNamespacedPath } from "node:path";
import { readFile, access, mkdir, copyFile } from "node:fs/promises";
import { DatabaseSync, backup } from "node:sqlite";
import * as agent from "../src/index.ts";
import { fixture, deferred } from "./fixture.ts";

const limits = { maxConversations: 4, maxPrimaryAttempts: 10, maxAuxiliaryAttempts: 4 };
test("offline maintenance reads and atomically changes approved stores without running persisted work", async () => {
	const f = await fixture();
	let runtime: agent.Runtime | undefined;
	let maintenance: Awaited<ReturnType<typeof agent.openStorageMaintenance>> | undefined;
	try {
		runtime = await agent.createRuntime({
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "local-model",
			apiKey: "local-only",
			limits,
		});
		const original = runtime.view();
		await runtime
			.store({ namespace: "pocket.bootstrap", maxBytes: 65536 })
			.compareAndSet(0, { ownerId: "original-owner" }, () => {});
		await runtime
			.store({ namespace: "pocket.people", maxBytes: 262144 })
			.compareAndSet(0, { marker: "before" }, () => {});
		const storageDir = dirname(original.sessionFile);
		await runtime.close();
		runtime = undefined;
		assert.equal(
			typeof agent.openStorageMaintenance,
			"function",
			"a no-Harness maintenance command must exist",
		);
		maintenance = await agent.openStorageMaintenance({
			storageDir,
			expectedSessionId: original.sessionId,
			stores: [
				{ namespace: "pocket.bootstrap", maxBytes: 65536 },
				{ namespace: "pocket.people", maxBytes: 262144 },
			],
		});
		assert.equal(maintenance.identity.sessionId, original.sessionId);
		assert.ok(Object.isFrozen(maintenance));
		assert.deepEqual((await maintenance.snapshot("pocket.bootstrap")).data, { ownerId: "original-owner" });
		await assert.rejects(maintenance.snapshot("unapproved"), /namespace|approved/i);
		await assert.rejects(
			maintenance.commit([
				{ namespace: "pocket.people", expectedVersion: 1, data: { marker: "bad" } },
				{ namespace: "pocket.bootstrap", expectedVersion: 0, data: { ownerId: "changed" } },
			]),
			/conflict/i,
		);
		assert.deepEqual((await maintenance.snapshot("pocket.people")).data, { marker: "before" });
		await maintenance.commit([
			{ namespace: "pocket.people", expectedVersion: 1, data: { marker: "after" } },
			{
				namespace: "pocket.bootstrap",
				expectedVersion: 1,
				data: { ownerId: "original-owner", recovered: true },
			},
		]);
		const target = join(f.root, "snapshot.sqlite");
		const receipt = await maintenance.backup(target);
		assert.equal(receipt.sessionId, original.sessionId);
		await access(target);
		assert.equal(f.requests.length, 0);
		await maintenance.close();
		maintenance = undefined;
		runtime = await agent.createRuntime({
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "local-model",
			apiKey: "local-only",
			limits,
			reopenSessionFile: original.sessionFile,
		});
		assert.deepEqual(
			(await runtime.store({ namespace: "pocket.people", maxBytes: 262144 }).snapshot()).data,
			{ marker: "after" },
		);
		assert.equal(f.requests.length, 0);
	} finally {
		await maintenance?.close();
		await runtime?.close();
		await f.close();
	}
});

test("maintenance rejects live writers and foreign identity without changing storage", async () => {
	const f = await fixture();
	let runtime: agent.Runtime | undefined;
	try {
		runtime = await agent.createRuntime({
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "local-model",
			apiKey: "local-only",
			limits,
		});
		const view = runtime.view(),
			storageDir = dirname(view.sessionFile);
		const before = await readFile(join(storageDir, "pakka-writer.json"), "utf8");
		assert.equal(typeof agent.openStorageMaintenance, "function");
		await assert.rejects(
			agent.openStorageMaintenance({ storageDir, expectedSessionId: view.sessionId, stores: [] }),
			/writer|locked/i,
		);
		assert.equal(await readFile(join(storageDir, "pakka-writer.json"), "utf8"), before);
		await runtime.close();
		runtime = undefined;
		await assert.rejects(
			agent.openStorageMaintenance({
				storageDir,
				expectedSessionId: "00000000-0000-0000-0000-000000000000",
				stores: [],
			}),
			/identity|provenance/i,
		);
		assert.equal(f.requests.length, 0);
	} finally {
		await runtime?.close();
		await f.close();
	}
});

test("offline SQLite snapshots support deeply nested release backup destinations", async () => {
	const f = await fixture();
	let runtime: agent.Runtime | undefined, maintenance: agent.StorageMaintenance | undefined;
	try {
		runtime = await agent.createRuntime({
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "local-model",
			apiKey: "local-only",
			limits,
		});
		const original = runtime.view();
		await runtime.close();
		runtime = undefined;
		maintenance = await agent.openStorageMaintenance({
			storageDir: dirname(original.sessionFile),
			expectedSessionId: original.sessionId,
			stores: [],
		});
		const folder = join(f.root, "a".repeat(80), "b".repeat(80), "c".repeat(80));
		await mkdir(folder, { recursive: true });
		const target = join(folder, "snapshot.sqlite");
		assert.ok(target.length > 260);
		const result = await maintenance.backup(target);
		assert.equal(result.sessionId, original.sessionId);
		assert.equal((await readFile(target)).subarray(0, 16).toString(), "SQLite format 3\u0000");
		assert.equal(f.requests.length, 0);
	} finally {
		await maintenance?.close();
		await runtime?.close();
		await f.close();
	}
});

test("maintenance sees a real persisted unfinished native job without replaying its handler", async () => {
	const f = await fixture(),
		entered = deferred();
	let calls = 0,
		runtime: agent.Runtime | undefined,
		maintenance: agent.StorageMaintenance | undefined;
	try {
		runtime = await agent.createRuntime({
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "local-model",
			apiKey: "local-only",
			limits,
			jobs: [
				{
					id: "pending-maintenance-proof",
					version: 1,
					authorize() {},
					async run(context) {
						calls++;
						entered.resolve();
						await context.sleep(60000);
						await context.complete({ done: true });
					},
				},
			],
		});
		const original = runtime.view();
		await runtime
			.jobs({ namespace: "maintenance-proof", maxJobs: 4, maxBytes: 65536 })
			.start(
				{
					requestId: "pending",
					actorId: "operator",
					target: original.conversations[0]!,
					definition: "pending-maintenance-proof",
					payload: {},
				},
				() => {},
			);
		await entered.promise;
		const frozen = join(f.root, "unfinished-snapshot");
		await mkdir(frozen);
		const reader = new DatabaseSync(toNamespacedPath(original.sessionFile), { readOnly: true });
		try {
			await backup(reader, toNamespacedPath(join(frozen, "main.sqlite")));
		} finally {
			reader.close();
		}
		for (const file of ["storage.json", "provenance.json"])
			await copyFile(join(dirname(original.sessionFile), file), join(frozen, file));
		await runtime.close();
		runtime = undefined;
		assert.equal(calls, 1);
		maintenance = await agent.openStorageMaintenance({
			storageDir: frozen,
			expectedSessionId: original.sessionId,
			stores: [{ namespace: "maintenance-proof", maxBytes: 4096 }],
		});
		const work = await maintenance.work();
		assert.ok(work.pendingTasks >= 1, "the frozen native job is still unfinished");
		await maintenance.commit([
			{ namespace: "maintenance-proof", expectedVersion: 0, data: { checked: true } },
		]);
		await maintenance.backup(join(f.root, "preserved-unfinished.sqlite"));
		assert.equal(calls, 1);
		assert.equal(f.requests.length, 0);
		assert.deepEqual(
			await maintenance.work(),
			work,
			"inspection/backup must not advance persisted execution",
		);
	} finally {
		await maintenance?.close();
		await runtime?.close();
		await f.close();
	}
});
