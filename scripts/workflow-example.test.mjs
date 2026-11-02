import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const workspace = new URL("../", import.meta.url);
const script = new URL("../examples/workflow.mjs", import.meta.url);
const content = (message) =>
	typeof message.content === "string" ? message.content : JSON.stringify(message.content);

// Real Pi tools, Conversations and SQLite; only model responses come from this loopback server.
async function fixture(omitAFinish = false) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "pakka-workflow-")));
	const requests = [],
		errors = [];
	let refs;
	const server = createServer((request, response) => {
		void (async () => {
			let raw = "";
			for await (const chunk of request) raw += chunk;
			const body = JSON.parse(raw);
			requests.push(body);
			const role = body.messages.some((m) => m.role === "system" && content(m).includes("WORKFLOW_ROLE_A"))
				? "A"
				: "B";
			const input = body.messages
				.filter((m) => m.role === "user")
				.map(content)
				.join("\n");
			const kickoff = body.messages.find(
				(m) => m.role === "user" && content(m).startsWith('{"kind":"workflow-input"'),
			);
			if (kickoff) refs = JSON.parse(content(kickoff)).members;
			const last = body.messages.at(-1);
			const lastTool =
				last.role === "tool"
					? body.messages.flatMap((m) => m.tool_calls ?? []).find((call) => call.id === last.tool_call_id)
							?.function.name
					: undefined;
			let tool,
				args,
				text = "Waiting for the peer.";
			if (role === "A") {
				if (input.includes("C-IS-SAVED")) {
					if (last.role !== "tool" && !omitAFinish) {
						tool = "workflow_finish";
						args = { artifactId: "C" };
					} else text = "A finished reading C.";
				} else if (last.role !== "tool") {
					tool = "mas_send";
					args = {
						target: refs.B,
						requestId: "a-draft",
						text: "DRAFT-FROM-A: use concise Chinese prose.",
						mode: "followUp",
					};
				}
			} else if (input.includes("DRAFT-FROM-A")) {
				if (last.role !== "tool") {
					tool = "X";
					args = { content: "# C\n\nA proposed concise prose; B checked it.\n" };
				} else if (lastTool === "X") {
					tool = "mas_send";
					args = {
						target: refs.A,
						requestId: "b-result",
						text: "C-IS-SAVED: artifact C is ready.",
						mode: "followUp",
					};
				} else if (lastTool === "mas_send") {
					tool = "workflow_finish";
					args = { artifactId: "C" };
				} else text = "B finished saving C.";
			}
			const base = {
				id: "workflow-" + requests.length,
				object: "chat.completion.chunk",
				created: 1,
				model: "local-workflow",
			};
			const delta = tool
				? {
						role: "assistant",
						tool_calls: [
							{
								index: 0,
								id: "call-" + requests.length,
								type: "function",
								function: { name: tool, arguments: JSON.stringify(args) },
							},
						],
					}
				: { role: "assistant", content: text };
			response.writeHead(200, { "content-type": "text/event-stream" });
			for (const choice of [
				{ index: 0, delta, finish_reason: null },
				{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" },
			])
				response.write("data: " + JSON.stringify({ ...base, choices: [choice] }) + "\n\n");
			response.end("data: [DONE]\n\n");
		})().catch((error) => {
			errors.push(String(error));
			response.destroy(error);
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const home = join(root, "home");
	await mkdir(home);
	return {
		root,
		requests,
		errors,
		async run(reopenSessionFile) {
			const env = {};
			for (const key of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC"])
				if (process.env[key]) env[key] = process.env[key];
			Object.assign(env, {
				HOME: home,
				USERPROFILE: home,
				PI_CODING_AGENT_DIR: join(home, "pi"),
				PI_OFFLINE: "1",
				TEMP: realpathSync.native(tmpdir()),
				TMP: realpathSync.native(tmpdir()),
				PAKKA_ENDPOINT: `http://127.0.0.1:${server.address().port}/v1`,
				PAKKA_MODEL: "local-workflow",
				PAKKA_API_KEY: "local-only",
				PAKKA_WORKFLOW_DIR: root,
			});
			if (reopenSessionFile) env.PAKKA_REOPEN_FILE = reopenSessionFile;
			const child = spawn(process.execPath, [fileURLToPath(script), "Write and review a short guide."], {
				cwd: workspace,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "",
				stderr = "";
			child.stdout.on("data", (chunk) => {
				stdout += chunk;
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			const timer = setTimeout(() => child.kill(), 25000);
			try {
				const code = await new Promise((resolve, reject) => {
					child.on("error", reject);
					child.on("close", resolve);
				});
				return { code, stdout, stderr, output: stdout.trim() ? JSON.parse(stdout) : null };
			} finally {
				clearTimeout(timer);
			}
		},
		async close() {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
			await rm(root, { recursive: true, force: true });
		},
	};
}

test(
	"workflow example: real peer tools produce C; both finish; reopen retains the result without HTTP",
	{ timeout: 40000 },
	async () => {
		const f = await fixture();
		try {
			const run = await f.run();
			assert.equal(run.code, 0, JSON.stringify({ run, requests: f.requests, errors: f.errors }, null, 2));
			assert.equal(run.output.state.phase, "done");
			assert.deepEqual(run.output.state.finished, { A: true, B: true });
			assert.equal(run.output.state.artifact.id, "C");
			assert.equal(run.output.state.artifact.content, "# C\n\nA proposed concise prose; B checked it.\n");
			assert.equal(
				await readFile(run.output.artifactFile, "utf8"),
				"# C\n\nA proposed concise prose; B checked it.\n",
			);
			assert.equal(run.output.deliveries.length, 4);
			assert.ok(run.output.deliveries.some((r) => r.source?.profile === "A" && r.target.profile === "B"));
			assert.ok(run.output.deliveries.some((r) => r.source?.profile === "B" && r.target.profile === "A"));
			const count = f.requests.length;
			const reopened = await f.run(run.output.sessionFile);
			assert.equal(reopened.code, 0, reopened.stderr);
			assert.deepEqual(reopened.output.state, run.output.state);
			assert.equal(f.requests.length, count, "reopen must not send model requests");
			assert.deepEqual(f.errors, []);
		} finally {
			await f.close();
		}
	},
);

test(
	"workflow example: C plus idle Conversations is insufficient without A's explicit finish",
	{ timeout: 40000 },
	async () => {
		const f = await fixture(true);
		try {
			const run = await f.run();
			assert.equal(run.code, 1, run.stderr);
			assert.ok(run.output, run.stderr);
			assert.equal(run.output.state.phase, "running");
			assert.deepEqual(run.output.state.finished, { A: false, B: true });
			assert.equal(run.output.state.artifact.id, "C");
			const count = f.requests.length;
			const reopened = await f.run(run.output.sessionFile);
			assert.equal(reopened.code, 1, reopened.stderr);
			assert.deepEqual(reopened.output.state, run.output.state);
			assert.equal(f.requests.length, count);
			assert.deepEqual(f.errors, []);
		} finally {
			await f.close();
		}
	},
);
