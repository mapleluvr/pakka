// Copy into an independent installed consumer; run only against the deterministic loopback provider below.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHost, createLocalExecutionEnvironment, executionFor } from "@pakka/agent";

const root = await realpath(await mkdtemp(join(tmpdir(), "pakka-execution-consumer-")));
const requests = [];
const targets = [];
let cleaned = 0;
const server = createServer((request, response) => {
	void (async () => {
		let body = "";
		for await (const chunk of request) body += chunk;
		requests.push(JSON.parse(body));
		const calls = [
			["write", { path: "native.txt", content: "OLD" }],
			["edit", { path: "native.txt", edits: [{ oldText: "OLD", newText: "NEW" }] }],
			["read", { path: "native.txt" }],
			["argv_write", {}],
		];
		const next = calls[requests.length - 1];
		const base = {
			id: "consumer-" + requests.length,
			object: "chat.completion.chunk",
			created: 1,
			model: "local-model",
		};
		const delta = next
			? {
					tool_calls: [
						{
							index: 0,
							id: "call-" + requests.length,
							type: "function",
							function: { name: next[0], arguments: JSON.stringify(next[1]) },
						},
					],
				}
			: { content: "CONSUMER-DONE" };
		response.writeHead(200, { "content-type": "text/event-stream" });
		for (const chunk of [
			{ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
			{ ...base, choices: [{ index: 0, delta, finish_reason: null }] },
			{
				...base,
				choices: [{ index: 0, delta: {}, finish_reason: next ? "tool_calls" : "stop" }],
				usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
			},
		])
			response.write("data: " + JSON.stringify(chunk) + "\n\n");
		response.end("data: [DONE]\n\n");
	})().catch((error) => response.destroy(error));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const config = {
	cwd: root,
	dataDir: join(root, "state"),
	endpoint: `http://127.0.0.1:${server.address().port}/v1`,
	model: "local-model",
	apiKey: "local-only",
	execution: {
		id: "consumer-v1",
		tools: ["write", "edit", "read"],
		open: (target) => {
			targets.push(target);
			const env = createLocalExecutionEnvironment({ cwd: target.cwd });
			return Object.freeze({
				...env,
				cleanup: async () => {
					await env.cleanup();
					cleaned++;
				},
			});
		},
	},
	tools: [
		{
			name: "argv_write",
			description: "Write via the invocation execution environment",
			parameters: { type: "object", properties: {} },
			execute: async (_args, _signal, scope) => {
				const env = await executionFor(scope);
				const result = await env.exec([
					process.execPath,
					"-e",
					"require('node:fs').writeFileSync('argv.txt','ARGV'); process.stdout.write('ARGV-OUTPUT')",
				]);
				assert.equal(result.ok, true);
				return "ARGV-DONE";
			},
		},
	],
};
let host;
try {
	host = await createHost(config);
	const user = host.connect("operator", ["input.submit"]);
	const receipt = await user.submit({ key: "consumer", text: "Use the execution tools" });
	await host.waitForIdle();
	assert.equal(await readFile(join(root, "native.txt"), "utf8"), "NEW");
	assert.equal(await readFile(join(root, "argv.txt"), "utf8"), "ARGV");
	assert.equal(requests.length, 5);
	assert.match(JSON.stringify(requests[3]), /NEW/);
	assert.equal(user.receipt(receipt.id).state, "committed");
	assert.equal(targets.length, 1);
	assert.ok(Object.isFrozen(targets[0]));
	const reopenSessionFile = host.view().sessionFile;
	await host.dispose();
	assert.equal(cleaned, 1);
	host = await createHost({ ...config, reopenSessionFile });
	assert.equal(host.view().phase, "ready");
	assert.equal(requests.length, 5);
	console.log(
		JSON.stringify({
			consumer: "execution",
			requests: requests.length,
			nativeFile: "NEW",
			argvFile: "ARGV",
			cleaned,
			root,
		}),
	);
} finally {
	await host?.dispose();
	server.closeAllConnections();
	await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
