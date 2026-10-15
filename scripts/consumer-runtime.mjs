import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";

const consumer = dirname(fileURLToPath(import.meta.url));
const requests = [];
const server = createServer((req, res) => {
	void (async () => {
		let text = "";
		for await (const part of req) text += part;
		let body;
		try {
			body = JSON.parse(text);
		} catch (error) {
			res.destroy(error);
			return;
		}
		requests.push(body);
		const chunk = { id: "runtime-local", object: "chat.completion.chunk", created: 1, model: "local" };
		res.writeHead(200, { "content-type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant", content: "RUNTIME-ANSWER" }, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: "stop" },
		])
			res.write("data: " + JSON.stringify({ ...chunk, choices: [choice] }) + "\n\n");
		res.end("data: [DONE]\n\n");
	})().catch((error) => res.destroy(error));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const cwd = join(consumer, "runtime-workspace"),
	dataDir = join(consumer, "runtime-data");
await mkdir(cwd);
await mkdir(dataDir);
const options = {
	cwd,
	dataDir,
	model: "local",
	endpoint: "http://127.0.0.1:" + server.address().port + "/v1",
	apiKey: "local-only",
	systemPrompt: "MANAGED-DEFAULT",
	limits: { maxConversations: 2, maxPrimaryAttempts: 3, maxAuxiliaryAttempts: 1 },
	profiles: [{ id: "worker", systemPrompt: "MANAGED-WORKER" }],
};
let runtime, reopened;
try {
	runtime = await createRuntime(options);
	const a = runtime.root(),
		ref = await runtime.createConversation({ key: "peer", profile: "worker" }),
		b = await runtime.conversation(ref);
	assert.equal(Object.isFrozen(ref), true);
	assert.equal(a.view().sessionFile, b.view().sessionFile);
	assert.notEqual(a.view().conversationId, b.view().conversationId);
	const ua = a.connect("user", ["input.submit"]),
		ub = b.connect("user", ["input.submit"]);
	await Promise.all([
		ua.submit({ key: "same", text: "UNIQUE-ROOT-A" }),
		ub.submit({ key: "same", text: "UNIQUE-PEER-B" }),
	]);
	await runtime.waitForIdle();
	assert.equal(requests.length, 2);
	assert.ok(
		requests.every(
			(body) => !(/UNIQUE-ROOT-A/.test(JSON.stringify(body)) && /UNIQUE-PEER-B/.test(JSON.stringify(body))),
		),
	);
	assert.ok(requests.some((body) => /MANAGED-WORKER/.test(JSON.stringify(body))));
	assert.notEqual(a.view().providerSessionId, b.view().providerSessionId);
	const storedBeforeRead = await readFile(runtime.view().sessionFile, "utf8");
	const observed = await runtime.readConversation(ref, () => {});
	assert.ok(Object.isFrozen(observed) && Object.isFrozen(observed.entries));
	assert.match(JSON.stringify(observed), /UNIQUE-PEER-B/);
	assert.doesNotMatch(JSON.stringify(observed), /UNIQUE-ROOT-A|MANAGED-WORKER|providerSessionId|local-only/);
	assert.equal(await readFile(runtime.view().sessionFile, "utf8"), storedBeforeRead);
	let checks = 0;
	await assert.rejects(
		runtime.readConversation(ref, () => {
			if (++checks > 1) throw new Error("human read revoked");
		}),
		/revoked/,
	);
	const card = {
		namespace: "consumer",
		actorId: "person",
		requestId: "display-only",
		kind: "card",
		text: "DISPLAY-ONLY-INSTALLED-CANARY",
	};
	const cardReceipt = await runtime.writeDisplay(ref, card, () => {});
	assert.deepEqual(await runtime.writeDisplay(ref, card, () => {}), cardReceipt);
	assert.equal(requests.length, 2, "observation and display-only records must not dispatch");
	const ba = a.connect("strategy", ["context_artifacts.write"]),
		bb = b.connect("strategy", ["context_artifacts.write"]);
	for (const binding of [ba, bb])
		binding.activateStrategy({ id: "same", hooks: ["context_artifacts.write"] });
	const ja = ba.bindStrategy("same"),
		jb = bb.bindStrategy("same"),
		fa = ja.readFrame(),
		fb = jb.readFrame();
	assert.throws(
		() => ja.artifacts.append(fb.basis, { expectedVersion: 0, records: ["foreign"] }),
		/Invalid\/copied frame basis scope|Invalid job scope|Stale frame basis/i,
	);
	const ra = ja.artifacts.append(fa.basis, { expectedVersion: 0, records: ["ROOT-JOURNAL"] });
	const rb = jb.artifacts.append(fb.basis, { expectedVersion: 0, records: ["PEER-JOURNAL"] });
	assert.equal(ra.status, "committed");
	assert.equal(rb.status, "committed");
	assert.notEqual(ra.journalPath, rb.journalPath);
	assert.deepEqual(ja.artifacts.read(ja.readFrame().basis).records, ["ROOT-JOURNAL"]);
	assert.deepEqual(jb.artifacts.read(jb.readFrame().basis).records, ["PEER-JOURNAL"]);
	await assert.rejects(runtime.createConversation({ key: "overflow" }), /limit/i);
	const file = runtime.view().sessionFile;
	assert.match(await readFile(file, "utf8"), /UNIQUE-ROOT-A/);
	assert.match(await readFile(file, "utf8"), /UNIQUE-PEER-B/);
	await runtime.close();
	reopened = await createRuntime({ ...options, reopenSessionFile: file });
	assert.equal(requests.length, 2, "reopen/inspection cannot dispatch");
	assert.equal(reopened.view().budget.primaryAttempts, 2);
	assert.deepEqual(await reopened.writeDisplay(ref, card, () => {}), cardReceipt);
	const restoredSnapshot = await reopened.readConversation(ref, () => {});
	assert.equal(restoredSnapshot.entries.filter((entry) => entry.kind === "pakka.display").length, 1);
	const restored = await reopened.conversation(ref);
	assert.equal(restored.view().conversationId, b.view().conversationId);
	const client = restored.connect("user", ["input.submit"]);
	await client.submit({ key: "third", text: "LAST-ALLOWED" });
	await reopened.waitForIdle();
	assert.equal(requests.length, 3);
	assert.doesNotMatch(JSON.stringify(requests[2]), /DISPLAY-ONLY-INSTALLED-CANARY|display-only/);
	const denied = await client.submit({ key: "fourth", text: "OVER-CAP" });
	await reopened.waitForIdle();
	assert.equal(requests.length, 3);
	assert.equal(client.receipt(denied.id).generation?.status, "blocked");
	await writeFile(join(consumer, "runtime-requests.json"), JSON.stringify(requests, null, 2));
	console.log(
		JSON.stringify({
			status: "passed",
			consumer,
			httpRequests: requests.length,
			session: "shared",
			contexts: "independent",
			journals: "independent",
			quotas: "persistent",
			reopen: "zero-dispatch",
			observation: "scoped-frozen-passive",
			display: "reopen-dedup-zero-model-contribution",
		}),
	);
} finally {
	await reopened?.close();
	await runtime?.close();
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
}
