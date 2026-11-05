import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as pakka from "../src/index.ts";
import type { ExecutionAccess, ExecutionTarget, HostOptions } from "../src/index.ts";
import { fixture, raw, text } from "./fixture.ts";

async function contents(path: string) {
	return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
		if (error.code === "ENOENT") return "<missing>";
		throw error;
	});
}

// Missing native registration or ignoring HarnessOptions.env leaves the target absent or unchanged.
test("execution: native write/edit/read use the bound environment and retain real tool results", async () => {
	const targets: ExecutionTarget[] = [];
	let cleaned = 0;
	const config = {
		execution: {
			id: "local-files-v1",
			tools: ["write", "edit", "read"] as const,
			open: (target: ExecutionTarget) => {
				targets.push(target);
				const env = pakka.createLocalExecutionEnvironment({ cwd: target.cwd });
				return Object.freeze({
					...env,
					cleanup: async () => {
						await env.cleanup();
						cleaned++;
					},
				});
			},
		},
	} satisfies Partial<HostOptions>;
	const f = await fixture(config, (_body, n) => {
		if (n === 1) return { tool: "write", args: { path: "result.txt", content: "BEFORE\n" } };
		if (n === 2)
			return { tool: "edit", args: { path: "result.txt", edits: [{ oldText: "BEFORE", newText: "AFTER" }] } };
		if (n === 3) return { tool: "read", args: { path: "result.txt" } };
		return { text: "ENV-DONE" };
	});
	try {
		const host = await f.start();
		const user = host.connect("operator", ["input.submit"]);
		const receipt = await user.submit({ key: "files", text: "Write, edit, then read the file" });
		await host.waitForIdle();
		assert.equal(await contents(join(f.cwd, "result.txt")), "AFTER\n");
		assert.equal(f.requests.length, 4);
		assert.match(text(f.requests[3]!), /AFTER/);
		assert.equal(user.receipt(receipt.id)?.state, "committed");
		assert.equal(host.view().phase, "ready");
		assert.equal(targets.length, 1, "One environment is shared across this Conversation's uses");
		assert.equal(targets[0]!.cwd, f.cwd);
		assert.equal(targets[0]!.sessionId, host.view().sessionId);
		assert.ok(Object.isFrozen(targets[0]));
		assert.equal(cleaned, 0, "A tool's completion does not destroy its environment");
		await host.dispose();
		assert.equal(cleaned, 1);
		await host.dispose();
		assert.equal(cleaned, 1, "Owner cleanup is idempotent");
		assert.deepEqual(f.errors, []);
	} finally {
		await f.close();
	}
});

// Ignoring a required provider or relying on ordinary native env errors would still dispatch HTTP.
test("execution: unavailable required environment blocks before HTTP and preserves settlement", async () => {
	const f = await fixture({
		execution: {
			id: "unavailable-v1",
			tools: ["write"],
			open: () => {
				throw new Error("Execution environment unavailable");
			},
		},
	});
	try {
		const host = await f.start();
		const user = host.connect("operator", ["input.submit"]);
		const receipt = await user.submit({ key: "unavailable", text: "DO-NOT-DISPATCH" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 0);
		assert.equal(user.receipt(receipt.id)?.state, "committed");
		assert.equal(user.receipt(receipt.id)?.generation?.status, "blocked");
		assert.match(await raw(host), /"reason":"blocked"/);
		assert.doesNotMatch(await raw(host), /"kind":"pi.assistant"/);
		assert.equal(await contents(join(f.cwd, "unexpected.txt")), "<missing>");
	} finally {
		await f.close();
	}
});

// A missing bound capability prevents the real effect; an unbound one would permit the late write.
test("execution: cooperating tools run argv commands and retained access cannot cause late effects", async () => {
	let access: ExecutionAccess | undefined;
	let scope: object | undefined;
	const output: { text: string; stream: string }[] = [];
	const f = await fixture(
		{
			execution: {
				id: "local-plugin-v1",
				open: (target) => pakka.createLocalExecutionEnvironment({ cwd: target.cwd }),
			},
			tools: [
				{
					name: "custom_files",
					description: "Use the invocation's approved execution environment",
					parameters: { type: "object", properties: {}, additionalProperties: false },
					execute: async (_args, _signal, invocation) => {
						scope = invocation;
						access = await pakka.executionFor(invocation);
						const command = await access.exec(
							[
								process.execPath,
								"-e",
								"require('node:fs').writeFileSync('command.txt','ARGV-EFFECT'); process.stdout.write('STDOUT'); process.stderr.write('STDERR')",
							],
							{ onOutput: (value, info) => output.push({ text: value, stream: info.stream }) },
						);
						assert.deepEqual(command, { ok: true, value: { exitCode: 0 } });
						const result = await access.readTextFile("command.txt");
						return result.ok ? result.value : result.error.message;
					},
				},
			],
		},
		(_body, n) => (n === 1 ? { tool: "custom_files" } : { text: "PLUGIN-DONE" }),
	);
	try {
		const host = await f.start();
		await host.connect("operator", ["input.submit"]).submit({ key: "plugin", text: "Use the custom tool" });
		await host.waitForIdle();
		assert.equal(await contents(join(f.cwd, "command.txt")), "ARGV-EFFECT");
		assert.equal(f.requests.length, 2);
		assert.match(text(f.requests[1]!), /ARGV-EFFECT/);
		assert.equal(
			output
				.filter((x) => x.stream === "stdout")
				.map((x) => x.text)
				.join(""),
			"STDOUT",
		);
		assert.equal(
			output
				.filter((x) => x.stream === "stderr")
				.map((x) => x.text)
				.join(""),
			"STDERR",
		);
		assert.ok(access && Object.isFrozen(access));
		assert.equal("cleanup" in access, false, "Tool access does not own the environment");
		await assert.rejects(
			() => access!.writeFile("command.txt", "LATE"),
			/invocation|scope|expired|inactive/i,
		);
		await assert.rejects(() => pakka.executionFor(scope!), /invocation|scope|expired|inactive/i);
		await assert.rejects(() => pakka.executionFor({ ...scope }), /invocation|scope|expired|inactive/i);
		assert.equal(await contents(join(f.cwd, "command.txt")), "ARGV-EFFECT");
	} finally {
		await f.close();
	}
});
