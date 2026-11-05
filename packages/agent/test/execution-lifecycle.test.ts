import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createHost,
	createLocalExecutionEnvironment,
	executionFor,
	type ExecutionBinaryReader,
	type ExecutionConfiguration,
	type ExecutionResult,
} from "../src/index.ts";
import { fixture, text } from "./fixture.ts";

// Reopening the path for each read would return NEW instead of the bytes from the originally opened file.
test("execution: binary handles survive path replacement and expire with the tool invocation", async () => {
	let reader: ExecutionBinaryReader | undefined;
	const f = await fixture(
		{
			execution: { id: "readers-v1", open: (target) => createLocalExecutionEnvironment({ cwd: target.cwd }) },
			tools: [
				{
					name: "handle_probe",
					description: "Read a retained handle",
					parameters: { type: "object", properties: {} },
					execute: async (_args, _signal, scope) => {
						const env = await executionFor(scope);
						assert.equal((await env.writeFile("handle.txt", { base64: "T0xECg==" })).ok, true);
						const opened = await env.openBinaryReader("handle.txt");
						assert.ok(opened.ok);
						reader = opened.value;
						assert.ok(Object.isFrozen(reader));
						assert.equal((await env.renameFile("handle.txt", "old.txt")).ok, true);
						assert.equal((await env.writeFile("handle.txt", "NEW\n")).ok, true);
						const bytes = await reader.read(0, 4);
						assert.deepEqual(bytes, { ok: true, value: { base64: "T0xECg==" } });
						assert.ok(Object.isFrozen(bytes));
						assert.equal((await reader.info()).ok, true);
						const scan = await reader.scanLines({ startLine: 0, endLine: 1 });
						assert.ok(scan.ok);
						assert.equal(scan.value.newlines, 1);
						return "OLD-HANDLE";
					},
				},
			],
		},
		(_body, n) => (n === 1 ? { tool: "handle_probe" } : { text: "DONE" }),
	);
	try {
		const host = await f.start();
		await host.connect("operator", ["input.submit"]).submit({ key: "handles", text: "Check handle" });
		await host.waitForIdle();
		assert.match(text(f.requests[1]!), /OLD-HANDLE/);
		assert.equal(await readFile(join(f.cwd, "handle.txt"), "utf8"), "NEW\n");
		await assert.rejects(() => reader!.read(0, 4), /inactive|closed|invocation/);
		await reader!.close();
	} finally {
		await f.close();
	}
});

// Losing the AbortSignal at a bridge boundary leaves the real child alive or returns ordinary success.
test(
	"execution: a caller abort terminates its real argv process without destroying the environment",
	{ timeout: 15000 },
	async () => {
		const f = await fixture();
		const env = createLocalExecutionEnvironment({ cwd: f.cwd });
		const controller = new AbortController();
		let pid = 0;
		try {
			const stopped = await env.exec(
				[process.execPath, "-e", "process.stdout.write(String(process.pid)); setInterval(()=>{},1000)"],
				{
					onOutput: (value, info) => {
						if (info.stream === "stdout") {
							pid = Number(value);
							controller.abort();
						}
					},
				},
				controller.signal,
			);
			assert.ok(!stopped.ok);
			assert.equal(stopped.error.code, "aborted");
			assert.ok(pid > 0);
			assert.throws(() => process.kill(pid, 0), /ESRCH/);
			assert.deepEqual(await env.exec([process.execPath, "-e", "process.exit(0)"]), {
				ok: true,
				value: { exitCode: 0 },
			});
		} finally {
			await env.cleanup();
			await f.close();
		}
	},
);

// Returning a tool result before its already-started command settles expires callbacks and loses its real result.
test("execution: already-started operations finish before tool settlement even if its author omits await", async () => {
	let command:
		| Promise<ExecutionResult<{ readonly exitCode: number; readonly spillPath?: string }>>
		| undefined;
	let stdout = "";
	const f = await fixture(
		{
			execution: { id: "pending-v1", open: (target) => createLocalExecutionEnvironment({ cwd: target.cwd }) },
			tools: [
				{
					name: "pending_probe",
					description: "Start a real command",
					parameters: { type: "object", properties: {} },
					execute: async (_args, _signal, scope) => {
						const env = await executionFor(scope);
						command = env.exec(
							[
								process.execPath,
								"-e",
								"process.stdout.write('RUNNING'); require('node:fs').writeFileSync('pending.txt','SETTLED')",
							],
							{
								onOutput: (value) => {
									stdout += value;
								},
							},
						);
						void command.catch(() => {});
						return "RETURNED";
					},
				},
			],
		},
		(_body, n) => (n === 1 ? { tool: "pending_probe" } : { text: "DONE" }),
	);
	try {
		const host = await f.start();
		await host.connect("operator", ["input.submit"]).submit({ key: "pending", text: "Start command" });
		await host.waitForIdle();
		assert.deepEqual(await command, { ok: true, value: { exitCode: 0 } });
		assert.equal(stdout, "RUNNING");
		assert.equal(await readFile(join(f.cwd, "pending.txt"), "utf8"), "SETTLED");
		assert.equal(f.requests.length, 2);
	} finally {
		await command?.catch(() => {});
		await f.close();
	}
});

// Cleanup failure must not drop the writer lock and allow a second owner for the same storage.
test("execution: unknown cleanup keeps the writer claimed", async () => {
	const f = await fixture();
	const execution: ExecutionConfiguration = {
		id: "cleanup-v1",
		open: (target) => ({
			...createLocalExecutionEnvironment({ cwd: target.cwd }),
			cleanup: async () => {
				throw new Error("Unconfirmed executor shutdown");
			},
		}),
	};
	const config = {
		cwd: f.cwd,
		dataDir: f.dataDir,
		endpoint: f.endpoint,
		model: "local-model",
		apiKey: "local-only",
		execution,
	};
	const host = await createHost(config);
	try {
		await host.connect("operator", ["input.submit"]).submit({ key: "cleanup", text: "Create environment" });
		await host.waitForIdle();
		const reopenSessionFile = host.view().sessionFile;
		await assert.rejects(() => host.dispose(), /Unconfirmed/);
		await assert.rejects(() => createHost({ ...config, reopenSessionFile }), /writer|claim|owner|active/i);
		assert.equal(f.requests.length, 1);
	} finally {
		await f.close();
	}
});
