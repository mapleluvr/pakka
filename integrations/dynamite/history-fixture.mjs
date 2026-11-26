import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, createCompresserSession, createHistorianSession } from "@pakka/agent";
import { createDynamite, createHistorian, DEFAULT_STRATEGY_ID } from "@pakka/dynamite";

function parse(text) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error("Invalid local deterministic provider JSON", { cause: error });
	}
}
export async function historyFixture(root, { tools = [], reply = () => ({ text: "MAIN-ANSWER" }) } = {}) {
	const cwd = join(root, "workspace"),
		dataDir = join(root, "profile"),
		requests = [];
	await mkdir(cwd, { recursive: true });
	await mkdir(dataDir, { recursive: true });
	let bookInput;
	const server = createServer((req, res) => {
		void (async () => {
			let body = "";
			for await (const chunk of req) body += chunk;
			const payload = parse(body);
			requests.push(payload);
			let answer;
			if (payload.model === "summary-local") {
				const ids = [
					...new Set(
						payload.messages.flatMap((m) =>
							[...String(m.content).matchAll(/\\"sourceEntryId\\":\\"([^"\\]+)\\"/g)].map((m) => m[1]),
						),
					),
				];
				assert.ok(ids.length);
				answer = {
					tool: "submit_compaction",
					args: {
						summary:
							"## Goal\nPreserve observed operations and their limits.\n\n## Progress\nThe execution produced a candidate result. Testing remains unconfirmed; keep the original evidence and pending verification.",
						graphs: [
							{
								id: "local",
								title: "Observed execution",
								nodes: [{ id: "candidate", label: "Candidate result", sourceEntryIds: [ids.at(-1)] }],
								edges: [],
								annotations: [
									{ nodeIds: ["candidate"], text: "Tests remain unconfirmed", sourceEntryIds: [ids.at(-1)] },
								],
							},
						],
						clues: [{ text: "Candidate needing verification", sourceEntryIds: [ids.at(-1)] }],
						unresolved: [],
					},
				};
			} else if (payload.model === "history-local") {
				bookInput = parse(payload.messages.findLast((m) => m.role === "user").content);
				const item = bookInput.batch[0];
				assert.equal(item.record.artifacts.graphs[0].annotations[0].text, "Tests remain unconfirmed");
				answer = {
					tool: "submit_history_book",
					args: {
						title: "Execution history",
						changes: [
							{
								kind: "put",
								value: {
									id: bookInput.newIdPrefix + "entry",
									kind: "chapter",
									title: "Candidate awaiting verification",
									text: "Tests remain unconfirmed",
									sources: [
										{
											artifactId: item.artifactId,
											version: item.ref.version,
											locator: "/artifacts/graphs/0",
										},
									],
									links: [],
								},
							},
						],
					},
				};
			} else answer = await reply(payload);
			const base = {
				id: "local-" + requests.length,
				object: "chat.completion.chunk",
				created: 1,
				model: payload.model,
			};
			res.writeHead(200, { "content-type": "text/event-stream" });
			const delta = answer.tool
				? {
						tool_calls: [
							{
								index: 0,
								id: "call-" + requests.length,
								type: "function",
								function: { name: answer.tool, arguments: JSON.stringify(answer.args) },
							},
						],
					}
				: { content: answer.text };
			for (const chunk of [
				{ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
				{ ...base, choices: [{ index: 0, delta, finish_reason: null }] },
				{
					...base,
					choices: [{ index: 0, delta: {}, finish_reason: answer.tool ? "tool_calls" : "stop" }],
					usage: {
						prompt_tokens: 20000 + requests.length * 1000,
						completion_tokens: 30,
						total_tokens: 20030 + requests.length * 1000,
					},
				},
			])
				res.write("data: " + JSON.stringify(chunk) + "\n\n");
			res.end("data: [DONE]\n\n");
		})().catch((error) => res.destroy(error));
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
	const compresser = await createCompresserSession({
		storageDir: join(dataDir, "compresser"),
		toolCallingTolerance: 2,
		unresolvedErrorTolerance: 2,
	});
	let historian, service, compression;
	const config = {
		cwd,
		dataDir,
		endpoint,
		model: "main-local",
		apiKey: "local-only",
		tools,
		limits: { maxConversations: 8, maxPrimaryAttempts: 32, maxAuxiliaryAttempts: 16 },
		inference: {
			compresserSession: compresser,
			models: [
				{
					key: "summary",
					model: "summary-local",
					endpoint,
					apiKey: "local-only",
					maxTokens: 4096,
					contextWindow: 32000,
				},
				{
					key: "history",
					model: "history-local",
					endpoint,
					apiKey: "local-only",
					maxTokens: 4096,
					contextWindow: 32000,
				},
			],
			policies: [
				{
					strategyId: DEFAULT_STRATEGY_ID,
					modelKeys: ["summary", "history"],
					maxCalls: 16,
					maxJobCalls: 2,
					maxOutputTokens: 2048,
					timeoutMs: 10000,
				},
			],
		},
	};
	let runtime = await createRuntime(config);
	const open = () => {
		const source = runtime.view().conversations[0];
		service = createHistorian({
			runtime,
			source,
			strategyId: DEFAULT_STRATEGY_ID,
			namespace: "history-books",
			actor: { id: "historian", check() {} },
			check() {},
			modelKey: "history",
			maxCalls: 2,
			maxAttempts: 8,
			openSession: async () =>
				(historian ??= await createHistorianSession({
					storageDir: join(dataDir, "historian"),
					toolCallingTolerance: 2,
					unresolvedErrorTolerance: 2,
				})),
		});
	};
	open();
	return {
		requests,
		root,
		cwd,
		get runtime() {
			return runtime;
		},
		get book() {
			return service.book;
		},
		get service() {
			return service;
		},
		async produce() {
			const host = runtime.root(),
				user = host.connect("operator", ["input.submit"]);
			for (let i = 0; i < 4; i++) {
				await user.submit({ key: "input-" + i, text: "Observed operation " + i });
				await runtime.waitForIdle();
			}
			const owner = host.connect("compression-owner", [
				"real_context.write",
				"context_artifacts.write",
				"model.infer",
			]);
			owner.activateStrategy({
				id: DEFAULT_STRATEGY_ID,
				hooks: ["real_context.write", "context_artifacts.write"],
			});
			compression = createDynamite(owner.bindStrategy(DEFAULT_STRATEGY_ID), {
				config: {
					protectedTail: { steps: 2, tokens: 1 },
					compressionWindowTokens: 1,
					compressionMaxWindowTokens: 60000,
					compressionAttemptsPerModel: 1,
					compressionModel: "summary",
					compressionFormat: "tool",
					autoCompress: true,
					compressionMaxOutputTokens: 2048,
				},
				compressionSession: { maxCalls: 2 },
			});
			await service.enable({ from: "future" });
			await compression.compress();
			await compression.waitForCompression();
			for (let i = 0; i < 16; i++) {
				const step = await service.pump();
				if (step.kind === "published") break;
				assert.equal(step.kind, "advanced");
			}
			const client = service.book.connect({ id: "owner", check() {} });
			assert.equal((await client.open()).revision, 1);
			return client.read({ revision: 1, id: bookInput.newIdPrefix + "entry" });
		},
		async reopen() {
			const file = runtime.view().sessionFile;
			compression?.dispose();
			compression = undefined;
			await service.close();
			await runtime.close();
			await historian?.close();
			historian = undefined;
			await compresser.close();
			runtime = await createRuntime({
				...config,
				inference: { ...config.inference, compresserSession: undefined },
				reopenSessionFile: file,
				observation: "lazy",
			});
			open();
		},
		async close() {
			compression?.dispose();
			await service.close();
			await historian?.close();
			await compresser.close();
			await runtime.close();
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		},
	};
}
