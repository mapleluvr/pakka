import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startPocket } from "../src/bootstrap.ts";
import { createLocalProduct } from "../src/product-runtime.ts";
import { isolated, configuration } from "./product-model-fixture.ts";
import { text, type Answer, type Payload } from "../../../packages/agent/test/fixture.ts";

async function local(reply?: (payload: Payload, n: number) => Answer) {
	const p = await isolated(reply);
	await configuration(p.agentDir, p.f.endpoint);
	const options = await createLocalProduct({ cwd: p.f.cwd, dataDir: p.f.dataDir, agentDir: p.agentDir });
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	try {
		app = await startPocket(options);
	} catch (error) {
		await options.modelConfiguration?.close();
		await p.f.close();
		throw error;
	}
	return {
		...p,
		options,
		app,
		async close() {
			await app?.close();
			await options.modelConfiguration?.close();
			await p.f.close();
		},
	};
}

// Missing native registration, wrong cwd, or an inherited host secret each breaks a real observable result.
test("built-in local product performs native file edits and shell work without inheriting model secrets", async () => {
	const variable = "PAKKA_TEST_MODEL_SECRET";
	const original = process.env[variable];
	process.env[variable] = "LOCAL-SECRET-MUST-NOT-LEAVE-HOST";
	const shell = process.platform === "win32" ? "powershell" : "bash";
	const command =
		process.platform === "win32"
			? "[IO.File]::WriteAllText((Join-Path (Get-Location) 'shell.txt'),'SHELL-EFFECT'); if (Test-Path Env:PAKKA_TEST_MODEL_SECRET) { Write-Output 'LEAKED' } else { Write-Output 'CLEAN-CHILD' }"
			: 'printf SHELL-EFFECT > shell.txt; if [ -n "$PAKKA_TEST_MODEL_SECRET" ]; then printf LEAKED; else printf CLEAN-CHILD; fi';
	const p = await local((_body, n) => {
		if (n === 1) return { tool: "write", args: { path: "result.txt", content: "BEFORE\n" } };
		if (n === 2)
			return { tool: "edit", args: { path: "result.txt", edits: [{ oldText: "BEFORE", newText: "AFTER" }] } };
		if (n === 3) return { tool: "read", args: { path: "result.txt" } };
		if (n === 4) return { tool: shell, args: { command, timeout: 10 } };
		return { text: "DONE" };
	});
	try {
		const ref = await p.app.runtime.createConversation({ key: "coding", profile: "default" });
		const host = await p.app.runtime.conversation(ref);
		const client = host.connect("operator", ["input.submit"]);
		await client.submit({ key: "local-tools", text: "Exercise the local project tools" });
		await host.waitForIdle();
		assert.equal(await readFile(join(p.f.cwd, "result.txt"), "utf8"), "AFTER\n");
		assert.equal(await readFile(join(p.f.cwd, "shell.txt"), "utf8"), "SHELL-EFFECT");
		const results = p.f.requests[4]!.messages.filter((message) => message.role === "tool")
			.map((message) => JSON.stringify(message.content))
			.join("\n");
		assert.match(results, /AFTER[\s\S]*CLEAN-CHILD/);
		assert.doesNotMatch(results, /LEAKED/);
		assert.doesNotMatch(JSON.stringify(p.f.requests), /LOCAL-SECRET-MUST-NOT-LEAVE-HOST/);
		assert.equal(p.f.requests.length, 5);
		assert.equal(p.f.requests[0]!.reasoning_effort, "high");
		assert.ok(p.f.authorization.every((value) => value === "Bearer local-alpha-secret"));
	} finally {
		await p.close();
		if (original === undefined) delete process.env[variable];
		else process.env[variable] = original;
	}
});

// Restricting just the advertised description would still allow write; removing read would fail the positive read oracle.
test("built-in read-only profile reads native files but rejects attempted write and shell tools", async () => {
	const shell = process.platform === "win32" ? "powershell" : "bash";
	const p = await local((_body, n) => {
		if (n === 1) return { tool: "read", args: { path: "protected.txt" } };
		if (n === 2) return { tool: "write", args: { path: "protected.txt", content: "WRONG" } };
		if (n === 3) return { tool: shell, args: { command: "echo WRONG > protected.txt" } };
		return { text: "DONE" };
	});
	try {
		await writeFile(join(p.f.cwd, "protected.txt"), "READ-ONLY-CONTENT");
		const ref = await p.app.runtime.createConversation({ key: "reader", profile: "read-only" });
		const host = await p.app.runtime.conversation(ref);
		await host
			.connect("reader", ["input.submit"])
			.submit({ key: "read-only", text: "Read then attempt unauthorized tools" });
		await host.waitForIdle();
		assert.match(text(p.f.requests[1]!), /READ-ONLY-CONTENT/);
		assert.equal(await readFile(join(p.f.cwd, "protected.txt"), "utf8"), "READ-ONLY-CONTENT");
		assert.match(JSON.stringify(p.f.requests[0]!.tools), /"name":"read"/);
		assert.doesNotMatch(JSON.stringify(p.f.requests[0]!.tools), /"name":"(?:write|edit|powershell|bash)"/);
		assert.equal(p.f.requests.length, 4);
	} finally {
		await p.close();
	}
});

// New Pi defaults affect new work, not an already selected native Conversation or the stored Session identity.
test("changing native defaults does not invalidate the local Session or replace old Conversation choices", async () => {
	const p = await local();
	let next: Awaited<ReturnType<typeof startPocket>> | undefined;
	let config: Awaited<ReturnType<typeof createLocalProduct>> | undefined;
	try {
		const ref = await p.app.runtime.createConversation({ key: "existing", profile: "default" });
		const sessionFile = p.app.runtime.view().sessionFile;
		assert.equal((await p.app.runtime.configuration(ref)).model, "alpha/reasoner");
		await p.app.close();
		await p.options.modelConfiguration?.close();
		await writeFile(
			join(p.agentDir, "settings.json"),
			JSON.stringify({ defaultProvider: "beta", defaultModel: "model-001", defaultThinkingLevel: "low" }),
		);
		config = await createLocalProduct({ cwd: p.f.cwd, dataDir: p.f.dataDir, agentDir: p.agentDir });
		next = await startPocket({ ...config, runtime: { ...config.runtime, reopenSessionFile: sessionFile } });
		assert.equal(next.runtime.view().sessionFile, sessionFile);
		assert.equal((await next.runtime.configuration(ref)).model, "alpha/reasoner");
		const newer = await next.runtime.createConversation({ key: "newer", profile: "default" });
		assert.equal((await next.runtime.configuration(newer)).model, "beta/model-001");
		assert.equal((await next.runtime.configuration(newer)).thinkingLevel, "low");
		assert.equal(p.f.requests.length, 0);
	} finally {
		await next?.close();
		await config?.modelConfiguration?.close();
		await p.close();
	}
});
