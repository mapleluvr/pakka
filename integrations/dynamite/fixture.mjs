import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHost } from "@pakka/agent";
import { createDynamite, DEFAULT_STRATEGY_ID } from "@pakka/dynamite";

export const SUMMARY =
	"## Goal\nPreserve source decisions, exact identifiers, completed work and pending next actions.\n\n## Progress\nThe fixed local source was checked without changing the original history.";
export const wireText = (payload) =>
	payload.messages
		.map((message) =>
			typeof message.content === "string" ? message.content : JSON.stringify(message.content),
		)
		.join("\n");

export async function fixture(name) {
	// The driver supplies an isolated, ignored evidence directory; no user profile.
	const evidenceRoot = process.env.PAKKA_DYNAMITE_EVIDENCE;
	if (!evidenceRoot) throw new Error("Run via npm run test:dynamite");
	await mkdir(evidenceRoot, { recursive: true });
	const root = await mkdtemp(join(evidenceRoot, name + "-"));
	const cwd = join(root, "workspace"),
		dataDir = join(root, "profile");
	await mkdir(cwd);
	await mkdir(dataDir);
	const requests = [],
		errors = [];
	const server = createServer((request, response) => {
		void (async () => {
			let body = "";
			for await (const chunk of request) body += chunk;
			let payload;
			try {
				payload = JSON.parse(body);
			} catch (error) {
				errors.push(String(error));
				response.destroy(error);
				return;
			}
			requests.push(payload);
			const base = {
				id: "local-" + requests.length,
				object: "chat.completion.chunk",
				created: 1,
				model: payload.model,
			};
			response.writeHead(200, { "content-type": "text/event-stream" });
			for (const chunk of [
				{
					...base,
					choices: [
						{
							index: 0,
							delta: {
								role: "assistant",
								content: payload.model === "summary-local" ? SUMMARY : "MAIN-ANSWER",
							},
							finish_reason: null,
						},
					],
				},
				{
					...base,
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: {
						prompt_tokens: 100 + requests.length * 10,
						completion_tokens: 12,
						total_tokens: 112 + requests.length * 10,
					},
				},
			])
				response.write("data: " + JSON.stringify(chunk) + "\n\n");
			response.end("data: [DONE]\n\n");
		})().catch((error) => {
			errors.push(String(error));
			response.destroy(error);
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
	let host;
	const f = {
		root,
		dataDir,
		requests,
		errors,
		host: undefined,
		service: undefined,
		binding: undefined,
		async start(extra = {}) {
			host = await createHost({
				cwd,
				dataDir,
				endpoint,
				model: "main-local",
				apiKey: "local-only",
				systemPrompt: "LEADING-SYSTEM",
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
							strategyId: DEFAULT_STRATEGY_ID,
							modelKeys: ["summary"],
							maxCalls: 8,
							maxJobCalls: 2,
							maxOutputTokens: 256,
							timeoutMs: 5000,
						},
					],
				},
				...extra,
			});
			f.host = host;
			return host;
		},
		async close() {
			try {
				await writeFile(join(root, "requests.json"), JSON.stringify(requests, null, 2));
				await writeFile(join(root, "view.json"), JSON.stringify(host?.view() ?? null, null, 2));
				await writeFile(join(root, "server-errors.json"), JSON.stringify(errors, null, 2));
				if (f.binding && host?.view().phase === "ready")
					await writeFile(join(root, "frame.json"), JSON.stringify(f.binding.readFrame(), null, 2));
				for (const name of ["sessions", "artifacts", "journal-ownership"]) {
					try {
						await cp(join(dataDir, name), join(root, "raw-" + name), { recursive: true });
					} catch (error) {
						if (error.code !== "ENOENT") throw error;
					}
				}
			} finally {
				f.service?.dispose();
				await host?.dispose();
				server.closeAllConnections();
				await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
			}
		},
	};
	return f;
}

export function install(f, config = {}) {
	f.service?.dispose();
	const owner = f.host.connect("dynamite-owner", [
		"real_context.write",
		"context_artifacts.write",
		"model.infer",
		"branch.control",
	]);
	owner.activateStrategy({
		id: DEFAULT_STRATEGY_ID,
		hooks: ["real_context.write", "context_artifacts.write"],
	});
	const binding = owner.bindStrategy(DEFAULT_STRATEGY_ID);
	const service = createDynamite(binding, {
		config: {
			protectedTail: { steps: 2, tokens: 1 },
			compressionWindowTokens: 1,
			compressionMaxWindowTokens: 60000,
			compressionAttemptsPerModel: 1,
			compressionModel: "summary",
			...config,
		},
	});
	f.service = service;
	f.binding = binding;
	return { owner, binding, service };
}

export async function next(host, user, key) {
	const input = await user.submit({ key, text: key });
	await host.waitForIdle();
	assert.equal(host.view().phase, "ready", host.view().lastError);
	assert.equal(user.receipt(input.id).state, "committed");
}

export async function seed(host) {
	const user = host.connect("user", ["input.submit"]);
	for (let i = 1; i <= 4; i++) await next(host, user, "SOURCE-" + i);
	return user;
}
