import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ConversationId } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createRuntime, createCompresserSession } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";
import { fixture, seed } from "./fixture.ts";
import { binding, target, inferencePolicy } from "./strategy-fixture.ts";

// Leaving the native backend on JSONL or reopening a replacement store loses
// direct SQLite reads, the original Session identity or committed broker data.
test("new runtime uses SQLite and reopens the exact committed native records", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const root = m.runtime.root();
		await seed(root, "SQLITE-SOURCE");
		await m.runtime
			.store({ namespace: "sqlite-contract", maxBytes: 4096 })
			.compareAndSet(0, { result: "committed", attemptId: "attempt-1" }, () => {});
		const file = m.runtime.view().sessionFile;
		assert.equal(basename(file), "main.sqlite");
		assert.equal((await readFile(file)).subarray(0, 16).toString(), "SQLite format 3\0");
		const before = m.runtime.view();
		await m.runtime.close();
		const storage = await openNodeSqliteStorage(file);
		try {
			const ref = before.conversations.find((item) => item.key === "root")!;
			const entries = await storage.scanEntries(
				{ conversationId: Number(ref.conversationId) as ConversationId },
				128,
				undefined,
				BACKGROUND_CONTEXT,
			);
			assert.ok(entries.items.some((entry) => JSON.stringify(entry).includes("SQLITE-SOURCE")));
		} finally {
			await storage.close(BACKGROUND_CONTEXT);
		}
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		assert.equal(reopened.view().sessionId, before.sessionId);
		assert.deepEqual(await reopened.store({ namespace: "sqlite-contract", maxBytes: 4096 }).snapshot(), {
			version: 1,
			data: { result: "committed", attemptId: "attempt-1" },
		});
		assert.equal(m.f.requests.length, 1, "reopen does not repeat a settled model request");
	} finally {
		await reopened?.close();
		await m.close();
	}
});

// Leaving the shared Compresser backend on JSONL prevents its saved policy and
// Conversation results from being inspected and reopened through SQLite.
test("Compresser saves independent completed Conversation state in SQLite", async () => {
	const f = await fixture({}, (payload) =>
		payload.model === "summary-model"
			? { tool: "submit_candidate", args: { text: "COMPLETE" } }
			: { text: "MAIN" },
	);
	const storageDir = join(f.root, "compresser");
	let compresser = await createCompresserSession({
		storageDir,
		toolCallingTolerance: 2,
		unresolvedErrorTolerance: 2,
	});
	try {
		const base = inferencePolicy(f.endpoint).inference!;
		const host = await f.start({ inference: { ...base, compresserSession: compresser } });
		await seed(host);
		const owner = host.connect("owner", ["context_artifacts.write", "model.infer"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const b = binding(owner),
			frame = b.readFrame();
		const job = b.createJob(frame.basis, {
			planId: "sqlite-conversation",
			targetEntryIds: [target(frame)],
			maxCalls: 2,
			requireArtifactReceipt: true,
		});
		const result = await job.converse({
			modelKey: "summary",
			prompt: "SQLITE-WORK",
			outputTool: {
				name: "submit_candidate",
				description: "Submit result",
				parameters: {
					type: "object",
					properties: { text: { type: "string" } },
					required: ["text"],
					additionalProperties: false,
				},
			},
		});
		assert.equal(result.status, "completed");
		const state = await compresser.snapshot();
		assert.equal(state.conversations.length, 1);
		assert.equal(state.conversations[0].status, "completed");
		assert.ok(
			existsSync(join(storageDir, "main.sqlite")),
			"native Conversation state has a SQLite storage file",
		);
		await compresser.close();
		compresser = await createCompresserSession({
			storageDir,
			toolCallingTolerance: 2,
			unresolvedErrorTolerance: 2,
		});
		assert.deepEqual(await compresser.snapshot(), state);
		assert.equal(f.requests.filter((p) => p.model === "summary-model").length, 1);
	} finally {
		await f.close();
		await compresser.close();
	}
});

// Ignoring the declared backend lets an incompatible storage identity be opened
// and can initialize replacement records before the caller discovers the error.
test("backend description mismatch rejects reopen without changing committed bytes", async () => {
	const m = await runtimeFixture();
	try {
		await m.runtime
			.store({ namespace: "preserve", maxBytes: 1024 })
			.compareAndSet(0, { known: true }, () => {});
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		const bytes = await readFile(file);
		await writeFile(
			join(dirname(file), "storage.json"),
			JSON.stringify({
				schema: "pakka.storage.v1",
				backend: "unsupported",
				file: basename(file),
				durability: "full",
			}) + "\n",
		);
		await assert.rejects(async () => {
			const opened = await createRuntime({ ...m.config, reopenSessionFile: file });
			await opened.close();
		}, /storage.*(?:identity|description|backend)|backend.*mismatch/i);
		assert.deepEqual(await readFile(file), bytes);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

// Trusting only the filename/JSON provenance permits a JSON file presented as
// the database to be accepted while the native backend opens different files.
test("a non-SQLite file cannot become the reopened Session storage", async () => {
	const m = await runtimeFixture();
	try {
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		const invalid = join(dirname(file), "foreign.sqlite");
		const body = Buffer.from('{"looks":"valid-json"}\n');
		await writeFile(invalid, body);
		await assert.rejects(async () => {
			const opened = await createRuntime({ ...m.config, reopenSessionFile: invalid });
			await opened.close();
		}, /SQLite|storage.*(?:file|format|identity)|database/i);
		assert.deepEqual(await readFile(invalid), body);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("a retired migration option is rejected before storage creation", async () => {
	const m = await runtimeFixture();
	try {
		const retired = {
			migrateLegacy: { expectedSessionId: m.runtime.view().sessionId, expectedConversationId: "1" },
		};
		await assert.rejects(
			createRuntime({ ...m.config, ...retired }),
			/Unsupported runtime option: migrateLegacy/,
		);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("a single-Conversation store retains its identity when managed open is refused", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		await seed(host, "SINGLE-CONVERSATION-SOURCE");
		const view = host.view();
		await host.dispose();
		const before = await readFile(view.sessionFile);
		await assert.rejects(
			createRuntime({
				cwd: f.cwd,
				dataDir: f.dataDir,
				endpoint: f.endpoint,
				model: "local-model",
				apiKey: "local-only",
				reopenSessionFile: view.sessionFile,
				limits: { maxConversations: 8, maxPrimaryAttempts: 100, maxAuxiliaryAttempts: 20 },
			}),
			/Managed runtime profile.*limits mismatch/,
		);
		assert.deepEqual(await readFile(view.sessionFile), before);
		assert.equal(f.requests.length, 1);
	} finally {
		await f.close();
	}
});

test("a foreign SQLite application is rejected before changing its journal mode or bytes", async () => {
	const m = await runtimeFixture();
	try {
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		const foreign = new DatabaseSync(file);
		foreign.exec("PRAGMA journal_mode = DELETE; PRAGMA application_id = 7");
		foreign.close();
		const before = await readFile(file);
		await assert.rejects(
			createRuntime({ ...m.config, reopenSessionFile: file }),
			/application identity mismatch/,
		);
		assert.deepEqual(await readFile(file), before);
		const reader = new DatabaseSync(file, { readOnly: true });
		try {
			assert.equal(reader.prepare("PRAGMA journal_mode").get()!.journal_mode, "delete");
		} finally {
			reader.close();
		}
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("corrupt database initialization closes the known connection without replacing committed data", async () => {
	const m = await runtimeFixture();
	let recovered: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		const original = await readFile(file),
			invalid = Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.alloc(80)]);
		await writeFile(file, invalid);
		await assert.rejects(
			createRuntime({ ...m.config, reopenSessionFile: file }),
			/database|malformed|SQLite/i,
		);
		assert.deepEqual(await readFile(file), invalid);
		assert.equal(existsSync(join(dirname(file), "pakka-writer.json")), false);
		await writeFile(file, original);
		recovered = await createRuntime({ ...m.config, reopenSessionFile: file });
		assert.equal(recovered.view().sessionId, m.runtime.view().sessionId);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await recovered?.close();
		await m.close();
	}
});
