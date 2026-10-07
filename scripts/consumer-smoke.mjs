import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHost } from "@pakka/agent";
const consumer = dirname(fileURLToPath(import.meta.url));
const versions = {};
for (const name of [
	"pi-coding-agent",
	"pi-ai",
	"pi-agent-core",
	"pi-tui",
	"chord",
	"pi-codemode",
	"pi-mcp",
	"pi-telemetry",
]) {
	let dir = dirname(fileURLToPath(import.meta.resolve("@earendil-works/" + name)));
	for (;;) {
		try {
			const data = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
			if (data.name === "@earendil-works/" + name) {
				versions[name] = data.version;
				break;
			}
		} catch {}
		const next = dirname(dir);
		if (next === dir) throw new Error("Package metadata not found");
		dir = next;
	}
	assert.equal(versions[name], "1.0.3");
}
await assert.rejects(import("@pakka/agent/dist/pi-adapter.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
const requests = [];
const server = createServer((req, res) => {
	void (async () => {
		let body = "";
		for await (const part of req) body += part;
		requests.push(JSON.parse(body));
		res.writeHead(200, { "content-type": "text/event-stream" });
		const base = { id: "smoke", object: "chat.completion.chunk", created: 1, model: "local" };
		res.write(
			"data: " +
				JSON.stringify({
					...base,
					choices: [{ index: 0, delta: { role: "assistant", content: "ANSWER" }, finish_reason: null }],
				}) +
				"\n\n",
		);
		res.write(
			"data: " +
				JSON.stringify({
					...base,
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}) +
				"\n\n",
		);
		res.end("data: [DONE]\n\n");
	})().catch((e) => res.destroy(e));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const cwd = join(consumer, "workspace"),
	dataDir = join(consumer, "profile");
await mkdir(cwd);
await mkdir(dataDir);
let host;
try {
	host = await createHost({
		cwd,
		dataDir,
		endpoint: "http://127.0.0.1:" + server.address().port + "/v1",
		model: "local",
		apiKey: "local-only",
	});
	const user = host.connect("user", ["input.submit"]),
		owner = host.connect("owner", ["real_context.write"]);
	owner.activateStrategy({ id: "strategy", hooks: ["real_context.write"] });
	const input = await user.submit({ key: "first", text: "ORIGINAL-PACKED" });
	await host.waitForIdle();
	assert.equal(user.receipt(input.id).state, "committed");
	assert.equal(
		(
			await owner.commit(owner.capture(), {
				type: "cut",
				summary: "PACKED-SUMMARY",
				firstKeptEntryId: null,
				tokensBefore: 2,
			})
		).status,
		"committed",
	);
	await user.submit({ key: "second", text: "PACKED-NEXT" });
	await host.waitForIdle();
	assert.equal(requests.length, 2);
	assert.match(JSON.stringify(requests[1]), /PACKED-SUMMARY/);
	assert.doesNotMatch(JSON.stringify(requests[1]), /ORIGINAL-PACKED/);
	console.log(
		JSON.stringify({
			status: "passed",
			consumer,
			entry: import.meta.resolve("@pakka/agent"),
			versions,
			httpRequests: requests.length,
			privateSubpath: "rejected",
		}),
	);
} finally {
	await host?.dispose();
	server.closeAllConnections();
	await new Promise((r) => server.close(r));
}
