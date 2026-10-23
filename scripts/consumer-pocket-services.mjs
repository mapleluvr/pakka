import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { createPocketPeople, createPocketWorkspace } from "@pakka/server/pocket";
import { decodePocketRequest, decodePocketResponse } from "@pakka/protocol/pocket";
import { createPocketClient } from "@pakka/client/pocket";

const root = dirname(fileURLToPath(import.meta.url)),
	requests = [],
	errors = [];
const provider = createServer((req, res) => {
	void (async () => {
		let text = "";
		for await (const chunk of req) text += chunk;
		let body;
		try {
			body = JSON.parse(text);
		} catch (error) {
			errors.push(String(error));
			res.destroy();
			return;
		}
		requests.push(body);
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant", content: "INSTALLED-POCKET-REPLY" }, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "pocket-" + requests.length,
						object: "chat.completion.chunk",
						model: "local",
						choices: [choice],
					}) +
					"\n\n",
			);
		res.end("data: [DONE]\n\n");
	})().catch((error) => {
		errors.push(String(error));
		res.destroy();
	});
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const cwd = join(root, "pocket-service-cwd"),
	dataDir = join(root, "pocket-service-data");
await mkdir(cwd);
await mkdir(dataDir);
const config = {
	cwd,
	dataDir,
	endpoint: "http://127.0.0.1:" + provider.address().port + "/v1",
	apiKey: "local-only",
	model: "local",
	systemPrompt: "HOST-ONLY-INSTRUCTIONS",
	limits: { maxConversations: 8, maxPrimaryAttempts: 4, maxAuxiliaryAttempts: 2 },
	profiles: [{ id: "safe", systemPrompt: "HOST-ONLY-INSTRUCTIONS" }],
	jobs: [
		{
			id: "installed",
			version: 1,
			authorize: () => {},
			run: async (ctx) => {
				await ctx.complete({ installed: true });
			},
		},
	],
};
const catalog = { namespace: "pocket", maxDeliveries: 16, maxPending: 4 };
let runtime;
try {
	runtime = await createRuntime(config);
	let people = await createPocketPeople({ runtime, namespace: "people" });
	const session = await people.initializeOwner("Owner");
	let actor = await people.authenticate(session.token);
	let client = createPocketWorkspace({ runtime, people, catalog, profileCeiling: () => ["safe"] }).bind(
		actor,
	);
	const create = { requestId: "one", name: "Installed work", profile: "safe" },
		ref = await client.create(create);
	const invite = await people.invite(actor, {
		requestId: "viewer",
		role: "viewer",
		resources: [ref.conversationId],
		ttlMs: 60000,
	});
	assert.ok(invite.token);
	const visitorSession = await people.redeem(invite.token, "Visitor"),
		visitor = createPocketWorkspace({ runtime, people, catalog, profileCeiling: () => ["safe"] }).bind(
			await people.authenticate(visitorSession.token),
		);
	await client.display(ref, { requestId: "card", kind: "card", text: "CARD-MUST-NOT-BE-MODEL-INPUT" });
	const file = runtime.view().sessionFile,
		original = await readFile(file, "utf8");
	const read = await visitor.read(ref, { limit: 1 });
	assert.equal(read.entries.length, 1);
	assert.equal(await readFile(file, "utf8"), original);
	assert.equal(requests.length, 0);
	decodePocketResponse(
		{
			version: 2,
			requestId: "read",
			serverId: "installed",
			result: { kind: "conversation", snapshot: read },
		},
		"read",
	);
	decodePocketRequest({ version: 2, requestId: "list", command: { op: "list" } });
	assert.ok(createPocketClient({ endpoint: "http://127.0.0.1:1/pocket/rpc" }));
	assert.equal(requests.length, 0);
	await assert.rejects(
		visitor.submit(ref, { requestId: "forbidden", text: "Forbidden", mode: "prompt" }),
		/denied/i,
	);
	const input = { requestId: "same-input", text: "EXPLICIT-INSTALLED-WORK", mode: "prompt" };
	const receipt = await client.submit(ref, input);
	assert.equal((await client.wait(receipt.id)).status, "done");
	assert.equal(JSON.stringify(requests).includes("CARD-MUST-NOT-BE-MODEL-INPUT"), false);
	const jobs = runtime.jobs({ namespace: "installed-jobs", maxJobs: 4, maxBytes: 65536 });
	const job = await jobs.start(
		{ requestId: "one", actorId: actor.person.id, target: ref, definition: "installed", payload: {} },
		() => {},
	);
	assert.equal((await jobs.wait(job.id, () => {})).state, "done");
	await runtime.close();
	runtime = await createRuntime({ ...config, reopenSessionFile: file });
	people = await createPocketPeople({ runtime, namespace: "people" });
	actor = await people.authenticate(session.token);
	client = createPocketWorkspace({ runtime, people, catalog, profileCeiling: () => ["safe"] }).bind(actor);
	assert.deepEqual(await client.create(create), ref);
	assert.equal((await client.submit(ref, input)).id, receipt.id);
	assert.equal(
		(
			await runtime
				.jobs({ namespace: "installed-jobs", maxJobs: 4, maxBytes: 65536 })
				.receipt(job.id, () => {})
		).state,
		"done",
	);
	assert.equal(runtime.view().budget.primaryAttempts, 1);
	assert.equal(requests.length, 1);
	assert.deepEqual(errors, []);
	console.log(
		"Installed WebUI services passed: 1 local HTTP; identity, resource scope, passive read/display, finite v2 exports, native jobs and original admission preserved on reopen.",
	);
} finally {
	await runtime?.close();
	await new Promise((resolve) => provider.close(resolve));
}
