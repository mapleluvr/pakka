import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, appendFile, cp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createHost, type Host, type HostOptions } from "../src/index.ts";
import { createHostWithAdapter } from "../src/host.ts";
import { PiAdapter } from "./pi-adapter.ts";

type FixtureOptions = Omit<Partial<HostOptions>, "backend"> & { backend?: "durable" | "oracle" };
export function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
export type Payload = {
	model: string;
	max_tokens?: number;
	messages: { role: string; content: unknown; [key: string]: unknown }[];
	tools?: unknown[];
};
export type Answer = (
	| { text: string }
	| { tool: string; args?: Record<string, unknown>; argsJson?: string }
	| { toolCalls: { tool: string; args?: Record<string, unknown>; argsJson?: string }[] }
	| { error: number }
) & {
	finishReason?: string;
	usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
};
export async function oracleFixture(
	options: FixtureOptions = {},
	reply: (payload: Payload, n: number) => Answer | Promise<Answer> = () => ({ text: "LOCAL-ANSWER" }),
) {
	return fixture({ ...options, backend: "oracle" }, reply);
}

export async function fixture(
	options: FixtureOptions = {},
	reply: (payload: Payload, n: number) => Answer | Promise<Answer> = () => ({ text: "LOCAL-ANSWER" }),
) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "pakka-integration-")));
	const requests: Payload[] = [];
	const errors: unknown[] = [];
	// Synthetic deterministic-provider evidence only; never reads ambient credentials.
	const authorization: (string | undefined)[] = [];
	const server = createServer((request, response) => {
		void (async () => {
			let body = "";
			for await (const chunk of request) body += chunk;
			const payload = JSON.parse(body) as Payload;
			requests.push(payload);
			authorization.push(request.headers.authorization);
			const n = requests.length;
			const answer = await reply(payload, n);
			if ("error" in answer) {
				response.writeHead(answer.error, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: { message: "LOCAL-FAILURE" } }));
				return;
			}
			const base = { id: "local-" + n, object: "chat.completion.chunk", created: 1, model: "local-model" };
			const delta =
				"tool" in answer || "toolCalls" in answer
					? {
							tool_calls: ("toolCalls" in answer ? answer.toolCalls : [answer]).map((call, index) => ({
								index,
								id: "call-" + n + (index ? "-" + index : ""),
								type: "function",
								function: { name: call.tool, arguments: call.argsJson ?? JSON.stringify(call.args ?? {}) },
							})),
						}
					: { content: answer.text };
			const chunks = [
				{ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
				{ ...base, choices: [{ index: 0, delta, finish_reason: null }] },
				{
					...base,
					choices: [
						{
							index: 0,
							delta: {},
							finish_reason:
								answer.finishReason ?? ("tool" in answer || "toolCalls" in answer ? "tool_calls" : "stop"),
						},
					],
					...(answer.usage === null
						? {}
						: { usage: answer.usage ?? { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }),
				},
			];
			response.writeHead(200, { "content-type": "text/event-stream" });
			for (const chunk of chunks) response.write("data: " + JSON.stringify(chunk) + "\n\n");
			response.end("data: [DONE]\n\n");
		})().catch((error) => {
			errors.push(error);
			response.destroy(error as Error);
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No server port");
	const cwd = join(root, "workspace"),
		dataDir = join(root, "profile");
	await mkdir(cwd);
	await mkdir(dataDir);
	let host: Host | undefined;
	return {
		root,
		cwd,
		dataDir,
		requests,
		authorization,
		errors,
		endpoint: "http://127.0.0.1:" + address.port + "/v1",
		async start(extra: FixtureOptions = {}) {
			const { backend, ...config } = { ...options, ...extra };
			const hostOptions: HostOptions = {
				cwd,
				dataDir,
				endpoint: "http://127.0.0.1:" + address.port + "/v1",
				model: "local-model",
				apiKey: "local-only",
				systemPrompt: "PAKKA-SYSTEM",
				...config,
			};
			host =
				backend === "oracle"
					? await createHostWithAdapter(hostOptions, (opts, notify, control) =>
							PiAdapter.create(opts, notify, control),
						)
					: await createHost(hostOptions);
			return host;
		},
		async close() {
			try {
				const artifacts = process.env.PAKKA_TEST_ARTIFACTS;
				if (artifacts) {
					const directory = join(artifacts, basename(root));
					await mkdir(directory, { recursive: true });
					await writeFile(join(directory, "requests.json"), JSON.stringify(requests, null, 2));
					await writeFile(join(directory, "view.json"), JSON.stringify(host?.view() ?? null, null, 2));
					await writeFile(join(directory, "server-errors.json"), JSON.stringify(errors.map(String), null, 2));
					for (const [source, destination] of [
						["sessions", "sessions"],
						["artifacts", "strategy-artifacts"],
						["journal-ownership", "journal-ownership"],
						["../compresser", "compresser"],
					]) {
						try {
							await cp(join(dataDir, source), join(directory, destination), { recursive: true });
						} catch (e) {
							if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
						}
					}
					await appendFile(
						join(artifacts, "manifest.jsonl"),
						JSON.stringify({ root, directory, requestCount: requests.length }) + "\n",
					);
				}
			} finally {
				await host?.dispose();
				server.closeAllConnections();
				await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
			}
		},
	};
}
export function text(payload: Payload): string {
	return payload.messages
		.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
		.join("\n");
}
export async function raw(host: Host): Promise<string> {
	try {
		return await readFile(host.view().sessionFile, "utf8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
		throw e;
	}
}
export async function seed(host: Host, value = "ORIGINAL") {
	const client = host.connect("user", ["input.submit"]);
	const receipt = await client.submit({ key: "seed", text: value });
	await host.waitForIdle();
	return { client, receipt: client.receipt(receipt.id)! };
}
