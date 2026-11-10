import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startTicketWorkbench } from "./rsi-workbench.mjs";
import { readTicketResult } from "@pakka/rsi/client";
import "@pakka/memo";

const directory = join(dirname(fileURLToPath(import.meta.url)), "rsi-consumer-data");
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
					expectedVersion: view.ticket.version,
					state: "closed",
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
	const login = await fetch(origin + "/pocket/exchange", {
		method: "POST",
		headers: { "content-type": "application/json", origin },
		body: JSON.stringify({ kind: "session", token: app.initialOwner.token }),
	});
	assert.equal(login.status, 200);
	const cookies = login.headers.getSetCookie().map((value) => value.split(";")[0]);
	const cookie = cookies.join("; "),
		csrf = cookies.find((value) => value.startsWith("pakka_csrf="))?.slice("pakka_csrf=".length);
	assert.ok(csrf);
	const rpc = async (command) => {
		const requestId = crypto.randomUUID();
		const response = await fetch(origin + "/pocket/extensions/rpc", {
			method: "POST",
			headers: { "content-type": "application/json", cookie, origin, "x-pakka-csrf": csrf },
			body: JSON.stringify({ version: 2, requestId, command }),
		});
		const result = await response.json();
		assert.equal(response.status, 200, JSON.stringify(result));
		assert.equal(result.requestId, requestId);
		assert.ok(!result.error, JSON.stringify(result));
		return result.result;
	};
	const registration = (await rpc({ op: "list" })).registrations.find((row) => row.manifest.id === "rsi");
	assert.ok(registration);
	const call = async (action, requestId, input) => {
		const { operation } = await rpc({
			op: "call",
			call: { extension: "rsi", generation: registration.generation, action, requestId, input },
		});
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
	const finished = await call("get", "read-result", { id: created.id });
	assert.equal(finished.ticket.state, "closed");
	assert.ok(
		finished.ticket.events.some(
			(row) => row.actorId === "agent:worker" && row.text === "Installed worker recorded the result.",
		),
	);
	assert.equal(finished.ticket.runs[0].state, "done");
	assert.equal(requests.length, 5);
	assert.deepEqual(errors, []);
	const sessionFile = app.runtime.view().sessionFile;
	await workbench.close();
	workbench = await startTicketWorkbench({ ...options, reopenSessionFile: sessionFile });
	const restored = await workbench.tickets
		.connect({ id: "consumer-manager", role: () => "manager", check() {} })
		.get(created.id);
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
