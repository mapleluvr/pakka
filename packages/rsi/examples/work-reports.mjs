import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRuntime } from "@pakka/agent";
import { createTicketService } from "@pakka/rsi";

/** Passive headless collaboration. No MAS, WebUI, Memo or provider requests are needed. */
export async function runWorkReports({ directory }) {
	const identityFile = join(directory, "session.json");
	await mkdir(join(directory, "workspace"), { recursive: true });
	let reopenSessionFile;
	try {
		const saved = JSON.parse(await readFile(identityFile, "utf8"));
		if (saved.schema !== 1 || typeof saved.sessionFile !== "string")
			throw Error("Invalid original Session identity");
		reopenSessionFile = saved.sessionFile;
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	const runtime = await createRuntime({
		cwd: join(directory, "workspace"),
		dataDir: join(directory, "data"),
		endpoint: "http://127.0.0.1:9/v1",
		model: "passive-example",
		apiKey: "local-only",
		limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 1 },
		...(reopenSessionFile ? { reopenSessionFile } : {}),
	});
	try {
		// Save only the original identity before business work; retries reopen the same SQLite.
		if (!reopenSessionFile)
			await writeFile(
				identityFile,
				JSON.stringify({ schema: 1, sessionFile: runtime.view().sessionFile }) + "\n",
			);
		const handlers = [
			{ id: "H", label: "Original H", actorId: "H" },
			{ id: "J", label: "Current J", actorId: "J" },
		];
		const service = await createTicketService({ runtime, namespace: "work-reports-example", handlers });
		const manager = service.connect({ id: "operator", role: () => "manager", check() {} });
		const H = service.connect({ id: "H", role: () => "handler", check() {} });
		const ticket = await manager.submit({
			requestId: "example-submit",
			title: "Parser findings",
			body: "Original content for H",
			sources: [],
		});
		const assigned = await manager.assign({
			requestId: "example-assign-H",
			id: ticket.id,
			expectedVersion: 1,
			handlerId: "H",
		});
		const conversation =
			runtime.view().conversations.find((ref) => ref.key === "work-reports-H") ??
			(await runtime.createConversation({ key: "work-reports-H" }));
		const work = await manager.registerWork({
			requestId: "example-work-H",
			id: ticket.id,
			expectedVersion: assigned.version,
			handlerId: "H",
			contentRevision: 1,
			conversation,
		});
		const transferred = await manager.assign({
			requestId: "example-transfer-J",
			id: ticket.id,
			expectedVersion: assigned.version,
			handlerId: "J",
		});
		const edited = await manager.edit({
			requestId: "example-new-content",
			id: ticket.id,
			expectedVersion: transferred.version,
			title: "Parser findings",
			body: "Future content for J",
			sources: [],
		});
		await manager.setState({
			requestId: "example-waiting",
			id: ticket.id,
			expectedVersion: edited.version,
			state: "waiting",
			text: "J owns the current decision",
			links: [],
		});
		const before = (await manager.get(ticket.id)).ticket;
		const first = await H.report({
			requestId: "example-report-1",
			id: ticket.id,
			workId: work.workId,
			text: "H's original findings",
			links: [],
		});
		const corrected = await H.reviseReport({
			requestId: "example-correction-1",
			id: ticket.id,
			reportId: first.reportId,
			expectedVersion: 1,
			text: "H's corrected original findings",
			links: [],
		});
		const second = await H.report({
			requestId: "example-report-2",
			id: ticket.id,
			workId: work.workId,
			text: "H's additional evidence",
			links: [],
		});
		assert.equal(
			(await H.getWork({ id: ticket.id, workId: work.workId })).content.body,
			"Original content for H",
		);
		await assert.rejects(H.get(ticket.id), { code: "denied" });
		assert.equal(
			(await H.readReport({ id: ticket.id, reportId: first.reportId, version: 1 })).text,
			"H's original findings",
		);
		const after = (await manager.get(ticket.id)).ticket;
		assert.equal(after.version, before.version);
		assert.equal(after.state, "waiting");
		assert.equal(after.handler.id, "J");
		const summaries = await manager.reports({ id: ticket.id, limit: 2 });
		assert.equal(summaries.items.length, 2);
		assert.ok(summaries.items.every((item) => !("text" in item)));
		return {
			sessionId: runtime.view().sessionId,
			sessionFile: runtime.view().sessionFile,
			ticketId: ticket.id,
			workId: work.workId,
			reports: [corrected, second],
			state: after.state,
			handlerId: after.handler.id,
			reopened: !!reopenSessionFile,
		};
	} finally {
		await runtime.close();
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const directory = resolve(process.env.PAKKA_RSI_REPORTS_DIR ?? "artifacts/rsi-work-reports-example");
	console.log(JSON.stringify(await runWorkReports({ directory }), null, 2));
}
