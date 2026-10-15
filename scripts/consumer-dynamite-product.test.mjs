import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapServer } from "@pakka/server/bootstrap";
import { createClient } from "@pakka/client";

const consumer = dirname(fileURLToPath(import.meta.url));
const token = "product-dynamite-local-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const evidence = [];
function parseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		throw new Error("Invalid product fixture JSON");
	}
}
function content(message) {
	return typeof message?.content === "string"
		? message.content
		: (message?.content ?? []).map((part) => part.text ?? "").join("\n");
}
function wire(payload) {
	return payload.messages.map(content).join("\n");
}
function current(payload) {
	const index = payload.messages.map((message) => message.role).lastIndexOf("user");
	return {
		text: content(payload.messages[index]),
		tools: payload.messages.slice(index + 1).filter((message) => message.role === "tool"),
	};
}
async function findSession(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			const file = await findSession(path);
			if (file) return file;
		} else if (entry.name === "main.jsonl") return path;
	}
}
async function childResult(path, args, cwd) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [path, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let out = "",
			err = "";
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error("Owned product command exceeded 15 seconds"));
		}, 15000);
		child.stdout.on("data", (chunk) => (out += chunk));
		child.stderr.on("data", (chunk) => (err += chunk));
		child.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once("exit", (code) => {
			clearTimeout(timer);
			resolve({ code, out, err });
		});
	});
}
async function fixture(name, { auto = false, cap = 64, devpack = false, dropSummary = false } = {}) {
	const root = join(consumer, "dynamite-product-evidence", name),
		cwd = join(root, "workspace"),
		dataDir = join(root, "profile");
	await mkdir(cwd, { recursive: true });
	const requests = [],
		errors = [],
		toolCalls = [],
		terminal = [],
		pids = [],
		outputs = [];
	let lostSummaryResponses = 0;
	const server = createServer((req, res) => {
		void (async () => {
			let body = "";
			for await (const chunk of req) body += chunk;
			const payload = parseJson(body);
			requests.push(payload);
			const now = current(payload),
				summary = payload.model === "summary-local";
			if (summary && dropSummary) {
				lostSummaryResponses++;
				res.destroy();
				return;
			}
			let tool;
			if (!summary && now.tools.length === 0 && /(?:A|B|U)-REDUCE/.test(now.text)) {
				const prefix = now.text.includes("B-REDUCE") ? "B" : "A";
				const source = payload.messages.find(
					(message) => message.role === "user" && content(message).includes(prefix + "-SOURCE-2"),
				);
				const ordinal = content(source).match(/\[#(\d+)\]/)?.[1] ?? "1";
				tool = {
					name: "ctx_reduce",
					arguments: JSON.stringify({ tags: "#" + ordinal, reason: "actual-product-model" }),
				};
			} else if (!summary && now.tools.length === 0 && now.text.includes("AUTO-DISCOVER"))
				tool = { name: "mas_discover", arguments: "{}" };
			const id = "dynamite-tool-" + requests.length;
			if (tool) toolCalls.push({ id, name: tool.name, request: requests.length });
			const delta = tool
				? { tool_calls: [{ index: 0, id, type: "function", function: tool }] }
				: {
						content: summary
							? "## Goal\nPRODUCT-SUMMARY preserves exact decisions.\n\n## Constraints\nKeep source identity.\n\n## Progress\nCompleted fixture checkpoint.\n\n## Next Steps\nContinue the pending task."
							: "PRODUCT-ANSWER",
					};
			res.writeHead(200, { "Content-Type": "text/event-stream" });
			for (const choice of [
				{ index: 0, delta: { role: "assistant" }, finish_reason: null },
				{ index: 0, delta, finish_reason: null },
				{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" },
			])
				res.write(
					"data: " +
						JSON.stringify({
							id: "local-" + requests.length,
							object: "chat.completion.chunk",
							created: 1,
							model: payload.model,
							choices: [choice],
							...(choice.finish_reason
								? {
										usage: {
											prompt_tokens: 100 + requests.length * 100,
											completion_tokens: 24,
											total_tokens: 124 + requests.length * 100,
										},
									}
								: {}),
						}) +
						"\n\n",
				);
			res.end("data: [DONE]\n\n");
		})().catch((error) => {
			errors.push(String(error));
			res.destroy(error);
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
	let config = {
		schema: "pakka.server.v1",
		runtime: {
			cwd,
			dataDir,
			endpoint,
			model: "main-local",
			apiKey: "local-fixture-only",
			systemPrompt: "LEADING-SYSTEM",
			limits: { maxConversations: 8, maxPrimaryAttempts: 200, maxAuxiliaryAttempts: 8 },
			profiles: [{ id: "plain", systemPrompt: "PLAIN-PROFILE" }],
			inference: {
				models: [
					{
						key: "summary",
						model: "summary-local",
						endpoint,
						apiKey: "local-summary-only",
						contextWindow: 16000,
						maxTokens: 512,
					},
				],
				policies: [
					{
						strategyId: "default-context-strategy",
						modelKeys: ["summary"],
						maxCalls: dropSummary ? 1 : 2,
						maxJobCalls: 1,
						maxOutputTokens: cap,
						timeoutMs: 5000,
					},
				],
			},
		},
		mas: { namespace: "dynamite-product", maxDeliveries: 128, maxPending: 8 },
		members: [
			{ key: "A", owner: "operator" },
			{ key: "B", owner: "operator" },
			{ key: "U", owner: "operator" },
			{ key: "plain", owner: "operator", profile: "plain" },
		],
		roles: [{ token, principal: "operator", sourceKey: null, grants: ["discover", "send", "observe"] }],
		dynamite: {
			members: ["A", "B"].map((key) => ({
				key,
				config: {
					autoCompress: auto,
					...(auto ? { threshold: { mode: "tokens", tokens: 1 } } : {}),
					protectedTail: { steps: 2, tokens: 1 },
					queueThresholdTokens: 1,
					compressionWindowTokens: 1,
					compressionMaxWindowTokens: 60000,
					compressionMaxOutputTokens: cap,
					compressionContextSteps: 0,
					compressionAttemptsPerModel: 1,
					compressionModel: "summary",
				},
			})),
		},
		...(devpack ? { devpack: { profiles: { default: ["discover", "observe"] } } } : {}),
	};
	let app, owned, client, snapshot;
	async function start(executable = false) {
		if (executable) {
			const file = join(root, "server.json");
			await writeFile(file, JSON.stringify(config));
			owned = spawn(
				process.execPath,
				[join(consumer, "node_modules/@pakka/server/dist/main.js"), "--config", file, "--control-stdin"],
				{ cwd: consumer, stdio: ["pipe", "pipe", "pipe"] },
			);
			pids.push(owned.pid);
			assert.notEqual(owned.pid, process.pid);
			const ready = await new Promise((resolve, reject) => {
				let out = "",
					err = "";
				const timer = setTimeout(() => {
					owned.kill();
					reject(new Error("Owned server ready deadline"));
				}, 15000);
				owned.once("error", (error) => {
					clearTimeout(timer);
					reject(error);
				});
				owned.once("exit", () => {
					clearTimeout(timer);
					reject(new Error("Owned server exited before ready: " + err));
					outputs.push(out, err);
				});
				owned.stderr.on("data", (chunk) => (err += chunk));
				owned.stdout.on("data", (chunk) => {
					out += chunk;
					if (!out.includes("\n")) return;
					clearTimeout(timer);
					try {
						resolve(parseJson(out.split("\n")[0]));
					} catch (error) {
						reject(error);
					}
				});
			});
			client = createClient({ endpoint: ready.endpoint, token });
			await writeFile(join(root, "connection.json"), JSON.stringify({ endpoint: ready.endpoint, token }));
		} else {
			app = await bootstrapServer(config);
			client = createClient({ endpoint: app.server.endpoint, token });
			await writeFile(
				join(root, "connection.json"),
				JSON.stringify({ endpoint: app.server.endpoint, token }),
			);
		}
		snapshot = await client.reconnect();
	}
	async function stop() {
		if (owned && owned.exitCode === null) {
			const child = owned;
			const code = new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					child.kill();
					reject(new Error("Owned close deadline; no takeover permission"));
				}, 15000);
				child.once("exit", (value) => {
					clearTimeout(timer);
					resolve(value);
				});
			});
			child.stdin.end("stop\n");
			assert.equal(await code, 0);
			owned = undefined;
		}
		if (app) {
			await app.close();
			app = undefined;
		}
	}
	const f = {
		root,
		dataDir,
		requests,
		errors,
		toolCalls,
		terminal,
		pids,
		get app() {
			return app;
		},
		get snapshot() {
			return snapshot;
		},
		ref(key) {
			const member = snapshot.members.find((member) => member.key === key);
			assert.ok(member, key);
			return member.ref;
		},
		async start(executable) {
			await start(executable);
		},
		async send(key, text, id = text, cli = false) {
			const command = { op: "send", target: f.ref(key), input: { requestId: id, text } };
			let sent;
			if (cli) {
				const file = join(root, "command.json");
				await writeFile(file, JSON.stringify(command));
				const result = await childResult(
					join(consumer, "node_modules/@pakka/cli/dist/main.js"),
					["--connection", join(root, "connection.json"), "call", "--command", file],
					consumer,
				);
				outputs.push(result.out, result.err);
				assert.equal(result.code, 0, result.err);
				sent = parseJson(result.out);
			} else sent = await client.request(command);
			assert.equal(sent.kind, "receipt");
			const done = await client.request({ op: "wait", id: sent.receipt.id });
			assert.equal(done.kind, "receipt");
			assert.equal(done.receipt.status, "done");
			terminal.push(done.receipt);
			return done.receipt;
		},
		async seed(key, count, cli = false) {
			for (let i = 1; i <= count; i++) await f.send(key, key + "-SOURCE-" + i, undefined, cli);
		},
		async reopen(executable, disabledStrategies = []) {
			const before = snapshot;
			await stop();
			const file = await findSession(dataDir);
			assert.ok(file);
			config = { ...config, runtime: { ...config.runtime, reopenSessionFile: file } };
			if (disabledStrategies.length)
				config = {
					...config,
					dynamite: {
						members: config.dynamite.members.filter((member) => !disabledStrategies.includes(member.key)),
					},
				};
			await start(executable);
			assert.equal(snapshot.sessionId, before.sessionId);
			assert.deepEqual(
				snapshot.members.map((member) => member.ref),
				before.members.map((member) => member.ref),
			);
		},
		async raw() {
			const path = await findSession(dataDir);
			assert.ok(path);
			return readFile(path);
		},
		async close() {
			try {
				await stop();
			} finally {
				server.closeAllConnections();
				await new Promise((resolve) => server.close(resolve));
				await writeFile(join(root, "requests.json"), JSON.stringify(requests, null, 2));
				await writeFile(
					join(root, "native-tools.json"),
					JSON.stringify(
						{
							toolCalls,
							results: requests.flatMap((payload) =>
								payload.messages.filter((message) => message.role === "tool"),
							),
						},
						null,
						2,
					),
				);
				await writeFile(join(root, "receipts.json"), JSON.stringify(terminal, null, 2));
				await cp(dataDir, join(root, "raw-profile"), { recursive: true });
				evidence.push({
					name,
					requests: requests.length,
					summaryRequests: requests.filter((payload) => payload.model === "summary-local").length,
					toolCalls: toolCalls.length,
					pids,
					providerErrors: errors.length,
					lostSummaryResponses,
				});
				await writeFile(join(consumer, "dynamite-product-evidence.json"), JSON.stringify(evidence, null, 2));
				assert.equal(errors.length, 0, errors.join("\n"));
				assert.ok(
					outputs.every(
						(out) =>
							!out.includes(token) &&
							!out.includes("local-fixture-only") &&
							!out.includes("local-summary-only"),
					),
				);
				const results = requests.flatMap((payload) =>
					payload.messages.filter((message) => message.role === "tool"),
				);
				for (const call of toolCalls)
					assert.ok(
						results.some((result) => result.tool_call_id === call.id && content(result).length > 0),
						"No native result for " + call.id,
					);
			}
		},
	};
	return f;
}

test(
	"installed executable + CLI: native reduce changes next HTTP, raw history and reopen admission are retained",
	{ timeout: 60000 },
	async () => {
		const f = await fixture("executable");
		try {
			await f.start(true);
			assert.equal(f.requests.length, 0);
			await f.seed("A", 6, true);
			await f.send("B", "B-SOURCE-1", undefined, true);
			const raw = await f.raw();
			const receipt = await f.send("A", "A-REDUCE", "stable-reduce", true);
			await f.send("A", "A-AFTER-REDUCE", undefined, true);
			assert.ok(f.toolCalls.some((call) => call.name === "ctx_reduce"));
			assert.match(wire(f.requests.at(-1)), /omitted/);
			assert.doesNotMatch(wire(f.requests.at(-1)), /A-SOURCE-2/);
			assert.doesNotMatch(
				wire(f.requests.find((payload) => current(payload).text.includes("B-SOURCE-1"))),
				/A-SOURCE/,
			);
			assert.ok(
				(await f.raw()).subarray(0, raw.length).equals(raw),
				"wire projection must not rewrite history",
			);
			const count = f.requests.length;
			await f.reopen(true);
			assert.equal(f.requests.length, count);
			const retried = await f.send("A", "A-REDUCE", "stable-reduce", true);
			assert.equal(retried.id, receipt.id);
			assert.equal(f.requests.length, count);
			await f.send("A", "A-AFTER-REOPEN", undefined, true);
			assert.doesNotMatch(wire(f.requests.at(-1)), /A-SOURCE-2/);
			assert.equal(f.requests.filter((payload) => payload.model === "summary-local").length, 0);
			assert.equal(f.pids.length, 2);
			assert.notEqual(f.pids[0], f.pids[1]);
		} finally {
			await f.close();
		}
	},
);

test(
	"installed trusted controls: same-profile foreign scope is denied and A revoke cannot affect B",
	{ timeout: 60000 },
	async () => {
		const f = await fixture("scope-revoke");
		try {
			await f.start(false);
			await f.seed("A", 6);
			await f.seed("B", 6);
			await f.send("A", "A-REDUCE");
			await f.send("B", "B-REDUCE");
			await f.send("U", "U-REDUCE");
			const denied = f.requests.at(-1);
			assert.ok(current(denied).tools.length);
			assert.match(current(denied).tools.map(content).join("\n"), /No approved product Dynamite invocation/);
			assert.doesNotMatch(wire(denied), /A-SOURCE|B-SOURCE/);
			f.app.revokeDynamite("A");
			await f.send("A", "A-REDUCE-REVOKED");
			assert.match(
				current(f.requests.at(-1)).tools.map(content).join("\n"),
				/No approved product Dynamite invocation/,
			);
			await f.send("A", "A-AFTER-REVOKE");
			assert.match(wire(f.requests.at(-1)), /A-SOURCE-2/);
			await f.send("B", "B-AFTER-REVOKE");
			assert.match(wire(f.requests.at(-1)), /omitted/);
			assert.doesNotMatch(wire(f.requests.at(-1)), /B-SOURCE-2/);
			await f.send("plain", "PLAIN-NATIVE");
			assert.ok(!f.requests.at(-1).tools?.some((tool) => tool.function?.name === "ctx_reduce"));
			const count = f.requests.length;
			await f.reopen(false, ["A"]);
			assert.equal(f.requests.length, count);
			await f.send("A", "A-AFTER-DISABLED-REOPEN");
			assert.match(wire(f.requests.at(-1)), /A-SOURCE-2/);
			assert.equal(
				content(
					f.requests
						.at(-1)
						.messages.filter((message) => message.role === "user")
						.at(-1),
				),
				"A-AFTER-DISABLED-REOPEN",
			);
			await f.send("A", "A-REDUCE-AFTER-DISABLED-REOPEN");
			assert.match(
				current(f.requests.at(-1)).tools.map(content).join("\n"),
				/No approved product Dynamite invocation/,
			);
			await f.send("B", "B-AFTER-DISABLED-A-REOPEN");
			assert.doesNotMatch(wire(f.requests.at(-1)), /B-SOURCE-2/);
			assert.equal(f.requests.filter((payload) => payload.model === "summary-local").length, 0);
		} finally {
			await f.close();
		}
	},
);

test(
	"installed unknown inference: an observed summary request with lost response is not refunded across reopen",
	{ timeout: 90000 },
	async () => {
		const f = await fixture("unknown-inference", { auto: true, dropSummary: true });
		try {
			await f.start(false);
			await f.seed("A", 8, true);
			assert.equal(f.requests.filter((payload) => payload.model === "summary-local").length, 1);
			const count = f.requests.length;
			await f.reopen(false);
			assert.equal(f.requests.length, count);
			await f.seed("B", 8, true);
			assert.equal(f.requests.filter((payload) => payload.model === "summary-local").length, 1);
			assert.ok(
				f.requests
					.filter((payload) => payload.model === "main-local")
					.every((payload) => !wire(payload).includes("PRODUCT-SUMMARY")),
				"a lost response must not become an adopted summary",
			);
		} finally {
			await f.close();
		}
	},
);

for (const cap of [64, 128])
	test(
		`installed compression ${cap}: accepted summary, DevPack union and fresh-Conversation reopen spend`,
		{ timeout: 90000 },
		async () => {
			const f = await fixture("compression-" + cap, { auto: true, cap, devpack: true });
			try {
				await f.start(false);
				await f.seed("A", 12, true);
				const summaries = f.requests.filter((payload) => payload.model === "summary-local");
				assert.equal(summaries.length, 2, "consume the exact strategy+Session budget before reopen");
				for (const payload of summaries)
					assert.equal(payload.max_tokens ?? payload.max_completion_tokens, cap);
				assert.ok(
					f.requests
						.filter((payload) => payload.model === "main-local")
						.some((payload) => wire(payload).includes("PRODUCT-SUMMARY")),
					"actual next HTTP must adopt the committed summary",
				);
				const count = f.requests.length;
				await f.reopen(false);
				assert.equal(f.requests.length, count);
				// B has no generation or retry state before reopen; its new source plans must still share A's spent policy.
				await f.seed("B", 10, true);
				await f.send("B", "AUTO-DISCOVER", undefined, true);
				assert.equal(f.requests.filter((payload) => payload.model === "summary-local").length, 2);
				assert.ok(f.toolCalls.some((call) => call.name === "mas_discover"));
				const tools = new Set(f.requests.at(-1).tools.map((tool) => tool.function.name));
				assert.ok(tools.has("ctx_reduce") && tools.has("mas_discover"));
				assert.doesNotMatch(wire(f.requests.at(-1)), /A-SOURCE/);
			} finally {
				await f.close();
			}
		},
	);
