import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createRuntime } from "../../agent/src/index.ts";
import { createTicketService } from "../src/index.ts";
import { blockSqliteWrites } from "../../agent/test/native-storage.ts";

const errorCode = (code: string) => (value: unknown) =>
	!!value && typeof value === "object" && "code" in value && value.code === code;
const actor = { id: "manager", role: () => "manager" as const, check() {} };
async function registered(runtime: Parameters<typeof createTicketService>[0]["runtime"]) {
	const service = await createTicketService({
		runtime,
		namespace: "report-history",
		handlers: [{ id: "H", label: "H", actorId: "H" }],
	});
	const manager = service.connect(actor);
	const conversation = await runtime.createConversation({ key: "history-original" });
	const ticket = await manager.submit({
		requestId: "ticket",
		title: "History",
		body: "Original material",
		sources: [],
	});
	const assigned = await manager.assign({
		requestId: "assign",
		id: ticket.id,
		expectedVersion: 1,
		handlerId: "H",
	});
	const work = await manager.registerWork({
		requestId: "work",
		id: ticket.id,
		expectedVersion: assigned.version,
		handlerId: "H",
		contentRevision: 1,
		conversation,
	});
	return { manager, work, id: ticket.id, conversation };
}

// Break caught: listing reports materializes every selected body instead of
// bounded metadata, and continuation accidentally includes later appends.
test("work report history: metadata-only pages stay bounded and stable through later additions and original Session reopen", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	let listing = false,
		bytesRead = 0;
	try {
		const runtime = {
			...m.runtime,
			records: (options: Parameters<typeof m.runtime.records>[0]) => {
				const records = m.runtime.records(options);
				return {
					...records,
					get: async (...args: Parameters<typeof records.get>) => {
						const result = await records.get(...args);
						if (listing) bytesRead += Buffer.byteLength(JSON.stringify(result.data));
						return result;
					},
				};
			},
		};
		const f = await registered(runtime);
		const originals = [];
		for (let i = 0; i < 7; i++)
			originals.push(
				await f.manager.report({
					requestId: "result-" + i,
					id: f.id,
					workId: f.work.workId,
					text: "史".repeat(12000),
					links: [],
				}),
			);
		listing = true;
		const first = await f.manager.reports({ id: f.id, limit: 2 });
		listing = false;
		assert.ok(
			bytesRead < 20 * 1024,
			"two report summaries must not materialize 72 KiB of unrequested bodies; actual=" + bytesRead,
		);
		assert.equal(first.items.length, 2);
		assert.ok(first.cursor);
		assert.equal(
			first.items.some((item) => "text" in item),
			false,
		);
		const late = await f.manager.report({
			requestId: "late-result",
			id: f.id,
			workId: f.work.workId,
			text: "New later report",
			links: [],
		});
		const seen = first.items.map((item) => item.id);
		let cursor: string | null = first.cursor;
		while (cursor) {
			const page = await f.manager.reports({ id: f.id, limit: 2, cursor });
			seen.push(...page.items.map((item) => item.id));
			cursor = page.cursor;
		}
		assert.equal(seen.length, 7);
		assert.equal(new Set(seen).size, 7);
		assert.equal(seen.includes(late.reportId), false);
		const saved = originals[0]!;
		await f.manager.reviseReport({
			requestId: "correct-old-report",
			id: f.id,
			reportId: saved.reportId,
			expectedVersion: 1,
			text: "Corrected short body",
			links: [],
		});
		assert.equal(
			(await f.manager.readReport({ id: f.id, reportId: saved.reportId, version: 1 })).text,
			"史".repeat(12000),
		);
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		const restored = (
			await createTicketService({
				runtime: reopened,
				namespace: "report-history",
				handlers: [{ id: "H", label: "H", actorId: "H" }],
			})
		).connect(actor);
		assert.deepEqual(await restored.lookup("result-0"), saved);
		assert.equal(
			(await restored.readReport({ id: f.id, reportId: saved.reportId, version: 1 })).text.length,
			12000,
		);
		assert.equal(
			(await restored.readReport({ id: f.id, reportId: saved.reportId })).text,
			"Corrected short body",
		);
		assert.deepEqual(
			(await restored.getWork({ id: f.id, workId: f.work.workId })).work.conversation,
			f.conversation,
		);
		assert.equal((await restored.reports({ id: f.id })).items.length, 8);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

// Break caught: write uncertainty is reported as saved, a report is half
// committed, or valid maximum-size content cannot be read independently.
test("work report history: maximum encoded content is readable; invalid input and SQLite failure retain unambiguous earlier reports", async () => {
	const m = await runtimeFixture();
	let unlock: (() => void) | undefined;
	try {
		const f = await registered(m.runtime);
		const saved = await f.manager.report({
			requestId: "before-failure",
			id: f.id,
			workId: f.work.workId,
			text: "Preserved report",
			links: [],
		});
		const maximum = {
			requestId: "maximum-valid",
			id: f.id,
			workId: f.work.workId,
			text: "中".repeat(12000),
			links: Array.from({ length: 8 }, () => "中".repeat(2048)),
			results: Array.from({ length: 8 }, () => ({
				uri: "中".repeat(2048),
				description: "中".repeat(1024),
				version: "中".repeat(160),
				sha256: "a".repeat(64),
			})),
		};
		const largest = await f.manager.report(maximum);
		const full = await f.manager.readReport({ id: f.id, reportId: largest.reportId });
		assert.equal(full.text.length, 12000);
		assert.deepEqual(full.results, maximum.results);
		assert.ok(Buffer.byteLength(JSON.stringify(full)) < 180 * 1024);
		await assert.rejects(
			f.manager.report({ ...maximum, requestId: "over-input", text: "中".repeat(12001) }),
			errorCode("invalid"),
		);
		assert.equal(await f.manager.lookup("over-input"), null);
		assert.equal((await f.manager.reports({ id: f.id })).items.length, 2);
		unlock = blockSqliteWrites(m.runtime.view().sessionFile);
		await assert.rejects(
			f.manager.report({
				requestId: "uncertain",
				id: f.id,
				workId: f.work.workId,
				text: "Must not be accepted",
				links: [],
			}),
			errorCode("unknown"),
		);
		unlock();
		unlock = undefined;
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		const reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		try {
			const reader = (await createTicketService({ runtime: reopened, namespace: "report-history" })).connect(
				actor,
			);
			assert.equal(
				(await reader.readReport({ id: f.id, reportId: saved.reportId })).text,
				"Preserved report",
			);
			assert.equal(await reader.lookup("uncertain"), null);
			assert.equal((await reader.reports({ id: f.id })).items.length, 2);
		} finally {
			await reopened.close();
		}
	} finally {
		unlock?.();
		await m.close();
	}
});
