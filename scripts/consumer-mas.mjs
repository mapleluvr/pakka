import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { createMas } from "@pakka/mas";

const consumer = dirname(fileURLToPath(import.meta.url)),
	requests = [];
const server = createServer((req, res) => {
	void (async () => {
		let data = "";
		for await (const part of req) data += part;
		let body;
		try {
			body = JSON.parse(data);
		} catch (error) {
			res.destroy(error);
			return;
		}
		requests.push(body);
		const chunk = { id: "mas-local", object: "chat.completion.chunk", created: 1, model: "local" };
		res.writeHead(200, { "content-type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant", content: "MAS-ANSWER" }, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: "stop" },
		])
			res.write("data: " + JSON.stringify({ ...chunk, choices: [choice] }) + "\n\n");
		res.end("data: [DONE]\n\n");
	})().catch((error) => res.destroy(error));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const cwd = join(consumer, "mas-workspace"),
	dataDir = join(consumer, "mas-data");
await mkdir(cwd);
await mkdir(dataDir);
const options = {
	cwd,
	dataDir,
	endpoint: "http://127.0.0.1:" + server.address().port + "/v1",
	apiKey: "local-only",
	model: "local",
	limits: { maxConversations: 4, maxPrimaryAttempts: 3, maxAuxiliaryAttempts: 1 },
};
const config = { namespace: "crew", maxDeliveries: 8, maxPending: 2 };
let runtime, reopened;
try {
	runtime = await createRuntime(options);
	const mas = await createMas({ ...config, runtime });
	const members = [
		{ key: "a", owner: "operator" },
		{ key: "b", owner: "operator" },
	];
	await mas.bootstrap(members);
	const ready = await mas.view();
	const [a, b] = ready.members;
	const sender = mas.connect({ principal: "a", source: a.ref, grants: ["send", "reply", "discover"] });
	const receiver = mas.connect({ principal: "b", source: b.ref, grants: ["reply"] });
	await assert.rejects(sender.send(b.ref, { requestId: "blocked", text: "BEFORE-READY" }), /active/);
	assert.equal(requests.length, 0);
	const active = await mas.activate();
	assert.equal(active.version, ready.version + 1);
	const input = { requestId: "first", text: "A-TO-B" };
	const first = await sender.send(b.ref, input);
	await sender.wait(first.id);
	assert.equal((await sender.send(b.ref, input)).id, first.id);
	await assert.rejects(sender.send(b.ref, { ...input, text: "CONFLICT" }), /conflict/);
	await assert.rejects(sender.retire(b.ref), /grant/);
	await assert.rejects(receiver.send(a.ref, { requestId: "forbidden", text: "NO-SEND-GRANT" }), /grant/);
	const reply = await receiver.reply(first.id, { requestId: "reply", text: "B-TO-A" });
	await receiver.wait(reply.id);
	assert.equal(requests.length, 2);
	assert.ok(JSON.stringify(requests[0]).includes("A-TO-B"));
	assert.ok(JSON.stringify(requests[1]).includes("B-TO-A"));
	assert.ok(!JSON.stringify(requests[1]).includes("A-TO-B"));
	assert.equal(Object.isFrozen(active.members[0].ref), true);
	mas.revoke("a");
	await assert.rejects(sender.send(b.ref, { requestId: "revoked", text: "REVOKED" }), /revoked/);
	const admin = mas.connect({
		principal: "operator",
		source: null,
		grants: ["spawn", "retire", "send", "observe"],
	});
	const child = await admin.spawn({ key: "child" });
	const third = await admin.send(child.ref, { requestId: "third", text: "CHILD-WORK" });
	await admin.wait(third.id);
	await admin.retire(child.ref);
	assert.equal((await admin.inspect(child.ref)).phase, "retired");
	await assert.rejects(admin.send(child.ref, { requestId: "retired", text: "RETIRED" }), /retired|inactive/);
	const file = runtime.view().sessionFile;
	assert.ok((await readFile(file, "utf8")).includes("pakka.catalog"));
	await runtime.close();
	reopened = await createRuntime({ ...options, reopenSessionFile: file });
	const restored = await createMas({ ...config, runtime: reopened });
	const fresh = restored.connect({ principal: "a", source: a.ref, grants: ["send"] });
	assert.equal((await fresh.send(b.ref, input)).id, first.id);
	assert.equal(requests.length, 3, "reopen and identical retry must not dispatch");
	await assert.rejects(sender.send(b.ref, { requestId: "old", text: "OLD-CLOSURE" }), /revoked|Runtime/);
	await writeFile(join(consumer, "mas-requests.json"), JSON.stringify(requests, null, 2));
	await writeFile(join(consumer, "mas-view.json"), JSON.stringify(await restored.view(), null, 2));
	console.log(
		JSON.stringify({
			status: "passed",
			consumer,
			httpRequests: requests.length,
			activation: "single-commit",
			delivery: "native-persistent",
			contexts: "independent",
			owner: "checked",
			reopen: "zero-dispatch",
		}),
	);
} finally {
	await reopened?.close();
	await runtime?.close();
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
}
