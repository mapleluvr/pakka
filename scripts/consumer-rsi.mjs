import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startTicketWorkbench } from "./rsi-workbench.mjs";
import { readTicketResult } from "@pakka/rsi/client";
import "@pakka/memo";
import { loginHttp } from "./consumer-webui-http.mjs";

const directory = join(dirname(fileURLToPath(import.meta.url)), "rsi-consumer-" + crypto.randomUUID());
await mkdir(directory, { recursive: true });
const requests = [],
	errors = [];
const provider = createServer((request, response) => {
	void (async () => {
		let raw = "";
		for await (const part of request) raw += part;
		let payload;
		try {
			payload = JSON.parse(raw);
		} catch (error) {
			response.destroy(error);
			return;
		}
		requests.push(payload);
		const isWorker = JSON.stringify(payload.messages).includes("Handle the assigned ticket");
		const results = payload.messages.filter((row) => row.role === "tool");
		let call;
		if (!isWorker && results.length === 0)
			call = {
				name: "ticket_submit",
				args: {
					requestId: "im-message-1",
					title: "Shared agent filesystem",
					body: "Measure independent workspace cost.",
					sources: ["https://example.org/idea"],
				},
			};
		if (isWorker && results.length === 0) {
			const match = /"ticketId":"([a-zA-Z0-9-]+)"/.exec(
				payload.messages
					.map((row) => (typeof row.content === "string" ? row.content : JSON.stringify(row.content)))
					.join("\n"),
			);
			assert.ok(match, "worker received the actual ticket reference");
			call = { name: "ticket_get", args: { id: match[1] } };
		}
		if (isWorker && results.length === 1) {
			let view;
			try {
				view = JSON.parse(results[0].content).value;
			} catch (error) {
				throw new Error("Invalid native ticket tool response", { cause: error });
			}
			call = {
				name: "ticket_report",
				args: {
					requestId: "worker-result",
					id: view.ticket.id,
					workId: view.ticket.runs[0].workId,
					text: "Installed worker recorded the result.",
					links: ["https://example.org/result"],
				},
			};
		}
		const chunk = { id: "rsi-local", object: "chat.completion.chunk", created: 1, model: "local-ticket" };
		response.writeHead(200, { "content-type": "text/event-stream" });
		const delta = call
			? {
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: "call-" + requests.length,
							type: "function",
							function: { name: call.name, arguments: JSON.stringify(call.args) },
						},
					],
				}
			: { role: "assistant", content: "Recorded." };
		for (const choice of [
			{ index: 0, delta, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" },
		])
			response.write("data: " + JSON.stringify({ ...chunk, choices: [choice] }) + "\n\n");
		response.end("data: [DONE]\n\n");
	})().catch((error) => {
		errors.push(String(error));
		response.destroy(error);
	});
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const options = {
	directory,
	endpoint: "http://127.0.0.1:" + provider.address().port + "/v1",
	model: "local-ticket",
	apiKey: "local-only",
};
let workbench;
try {
	workbench = await startTicketWorkbench(options);
	const { app, tickets, botRef } = workbench;
	const bot = await app.runtime.conversation(botRef);
	await bot
		.connect("operator", ["input.submit"])
		.submit({ key: "collect", text: "Save the shared-filesystem idea and continue." });
	await app.runtime.waitForIdle();
	const manager = tickets.connect({ id: "consumer-manager", role: () => "manager", check() {} });
	const created = (await manager.list()).items[0];
	assert.ok(created);
	assert.equal(created.authorId, "agent:inbox");
	assert.equal((await manager.get(created.id)).ticket.runs.length, 0);
	assert.equal(requests.length, 2);
	// Actual authenticated HTTP extension boundary; no handler-only success claim.
	const origin = app.http.origin;
	const owner = await loginHttp(origin, app.initialOwner.token);
	const call = async (action, requestId, input) => {
		const operation = await owner.call("rsi", action, input, undefined, requestId);
		assert.equal(operation.state, "done", JSON.stringify(operation));
		return readTicketResult(action, operation.value);
	};
	const visible = await call("get", "view-bot-ticket", { id: created.id });
	assert.equal(visible.ticket.body, "Measure independent workspace cost.");
	const assigned = await call("assign", "assign", {
		id: created.id,
		expectedVersion: created.version,
		handlerId: "default",
	});
	const dispatched = await call("dispatch", "dispatch", {
		id: created.id,
		expectedVersion: assigned.version,
	});
	await app.runtime.waitForIdle();
	await call("refresh", "refresh", { id: created.id, runId: dispatched.runId });
	const afterReport = await call("get", "after-report", { id: created.id });
	assert.equal(afterReport.ticket.state, "active");
	assert.equal(afterReport.ticket.runs[0].state, "done");
	const reports = await call("reports", "list-reports", { id: created.id });
	assert.equal(reports.items.length, 1);
	const reportRef = { id: created.id, reportId: reports.items[0].id, version: 1 };
	const report = await call("read-report", "read-result", reportRef);
	assert.equal(report.actorId, "agent:worker");
	assert.equal(report.runId, dispatched.runId);
	assert.equal(report.text, "Installed worker recorded the result.");
	await call("set-state", "manager-close", {
		id: created.id,
		expectedVersion: afterReport.ticket.version,
		state: "closed",
		text: "Accepted",
		links: [],
	});
	const finished = await call("get", "after-close", { id: created.id });
	assert.equal(finished.ticket.state, "closed");
	assert.equal(requests.length, 5);
	assert.deepEqual(errors, []);
	const sessionFile = app.runtime.view().sessionFile;
	await workbench.close();
	workbench = await startTicketWorkbench({ ...options, reopenSessionFile: sessionFile });
	const reopened = workbench.tickets.connect({ id: "consumer-manager", role: () => "manager", check() {} });
	const restored = await reopened.get(created.id);
	assert.deepEqual(await reopened.readReport(reportRef), report);
	assert.deepEqual(restored.ticket, finished.ticket);
	assert.equal(requests.length, 5, "reopen never resubmits work");
	await writeFile(
		join(directory, "evidence.json"),
		JSON.stringify({ providerRequests: requests.length, ticket: restored.ticket, sessionFile }, null, 2) +
			"\n",
	);
	console.log(
		"Installed RSI: real Bot submission -> authenticated ticket UI API -> MAS worker native report -> normal reopen; 5 local provider requests, no replay.",
	);
} finally {
	await workbench?.close();
	await new Promise((resolve) => provider.close(resolve));
}
