import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createLocalExecutionEnvironment,
	createRuntime,
	type ExecutionBytes,
	type ExecutionConfiguration,
	type ExecutionTarget,
} from "../src/index.ts";
import { fixture, text } from "./fixture.ts";
import { runtimeLimits } from "./runtime-fixture.ts";

// Inheriting the default driver for every profile writes the wrong bytes in beta's real directory.
test("execution: concurrent Conversations use their own approved profile driver and cwd", async () => {
	const targets: ExecutionTarget[] = [];
	let cleaned = 0;
	const execution = (id: string): ExecutionConfiguration => ({
		id,
		tools: ["write"],
		open: (target) => {
			targets.push(target);
			const env = createLocalExecutionEnvironment({ cwd: target.cwd });
			return Object.freeze({
				...env,
				writeFile: (path: string, content: string | ExecutionBytes, signal?: AbortSignal) =>
					env.writeFile(path, `${id}:${content}`, signal),
				cleanup: async () => {
					await env.cleanup();
					cleaned++;
				},
			});
		},
	});
	const f = await fixture({}, (body) =>
		body.messages.some((m) => m.role === "tool")
			? { text: "DONE" }
			: { tool: "write", args: { path: "profile.txt", content: "WORK" } },
	);
	const other = join(f.root, "beta");
	await mkdir(other);
	const runtime = await createRuntime({
		cwd: f.cwd,
		dataDir: f.dataDir,
		endpoint: f.endpoint,
		model: "local-model",
		apiKey: "local-only",
		limits: runtimeLimits,
		execution: execution("alpha-v1"),
		profiles: [{ id: "beta", cwd: other, execution: execution("beta-v1") }],
	});
	try {
		const betaRef = await runtime.createConversation({ key: "beta", profile: "beta" });
		const beta = await runtime.conversation(betaRef);
		await Promise.all(
			[runtime.root(), beta].map((host) =>
				host.connect("operator", ["input.submit"]).submit({ key: "write", text: "Write the profile file" }),
			),
		);
		await runtime.waitForIdle();
		assert.equal(await readFile(join(f.cwd, "profile.txt"), "utf8"), "alpha-v1:WORK");
		assert.equal(await readFile(join(other, "profile.txt"), "utf8"), "beta-v1:WORK");
		assert.equal(new Set(targets.map((t) => t.conversationId)).size, 2);
		assert.deepEqual(targets.map((t) => t.profile).sort(), ["beta", "default"]);
		assert.equal(targets.find((t) => t.profile === "beta")?.incarnation, betaRef.incarnation);
		assert.equal(f.requests.length, 4);
		await runtime.close();
		assert.equal(cleaned, 2);
	} finally {
		await runtime.close();
		await f.close();
	}
});

// Omitting execution from the saved profile hash accepts a changed policy or tool set on reopen.
test("execution: reopen checks policy, native tool selection and presence before dispatch", async () => {
	const execution: ExecutionConfiguration = {
		id: "policy-v1",
		tools: ["read"],
		open: (target) => createLocalExecutionEnvironment({ cwd: target.cwd }),
	};
	const f = await fixture({ execution });
	try {
		const first = await f.start();
		await first.connect("operator", ["input.submit"]).submit({ key: "seed", text: "Seed" });
		await first.waitForIdle();
		const reopenSessionFile = first.view().sessionFile;
		await first.dispose();
		for (const changed of [
			{ ...execution, id: "policy-v2" },
			{ ...execution, tools: ["write"] as const },
			undefined,
		]) {
			await assert.rejects(async () => {
				const host = await f.start({ reopenSessionFile, execution: changed });
				await host.dispose();
			}, /profile|configuration|execution/i);
		}
		const same = await f.start({ reopenSessionFile, execution });
		assert.equal(same.view().phase, "ready");
		assert.equal(f.requests.length, 1, "Reopen never replays a request");
	} finally {
		await f.close();
	}
});

// Reusing a cached env after configureAgent writes into the previous cwd instead of the newly approved cwd.
test("execution: changing approved cwd binds a fresh environment and retains the selected model", async () => {
	const opened: string[] = [];
	let cleaned = 0;
	const f = await fixture({}, (body) =>
		body.messages.filter((m) => m.role === "tool").length >=
		body.messages.filter((m) => m.role === "user").length
			? { text: "DONE" }
			: { tool: "write", args: { path: "cwd.txt", content: "SELECTED" } },
	);
	const other = join(f.root, "other");
	await mkdir(other);
	const runtime = await createRuntime({
		cwd: f.cwd,
		dataDir: f.dataDir,
		endpoint: f.endpoint,
		model: "local-model",
		apiKey: "local-only",
		limits: runtimeLimits,
		cwdRoots: [f.cwd, other],
		execution: {
			id: "cwd-v1",
			tools: ["write"],
			open: (target) => {
				opened.push(target.cwd);
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
	});
	try {
		const catalog = runtime.catalog({ namespace: "env", maxDeliveries: 8, maxPending: 4 });
		let ref = (await catalog.enroll([{ key: "worker", data: { phase: "active" } }], () => {}))[0]!.ref;
		const deliver = async (key: string) => {
			const sent = await catalog.deliver(
				{
					requestId: key,
					principal: "operator",
					source: null,
					target: ref,
					text: "Write cwd",
					mode: "prompt",
				},
				() => {},
			);
			assert.equal((await catalog.wait(sent.id, () => {})).status, "done");
		};
		await deliver("first");
		ref = (await catalog.configureAgent(ref, { cwd: other }, () => {})).ref;
		await deliver("second");
		assert.equal(await readFile(join(other, "cwd.txt"), "utf8"), "SELECTED");
		assert.equal(await readFile(join(f.cwd, "cwd.txt"), "utf8"), "SELECTED");
		assert.deepEqual(opened, [f.cwd, other]);
		assert.ok(f.requests.every((r) => r.model === "local-model"));
		assert.match(text(f.requests.at(-1)!), /DONE|cwd/);
		await runtime.close();
		assert.equal(cleaned, 2);
	} finally {
		await runtime.close();
		await f.close();
	}
});

// A returned but invalid owner must still be cleaned; validation must not abandon its resources.
test("execution: a mismatched driver blocks HTTP and still owns cleanup", async () => {
	let cleaned = 0;
	const f = await fixture({
		execution: {
			id: "mismatch-v1",
			tools: ["write"],
			open: (target) => {
				const env = createLocalExecutionEnvironment({ cwd: target.cwd });
				return {
					...env,
					cwd: target.cwd + "-wrong",
					cleanup: async () => {
						await env.cleanup();
						cleaned++;
					},
				};
			},
		},
	});
	try {
		const host = await f.start();
		const user = host.connect("operator", ["input.submit"]);
		const sent = await user.submit({ key: "mismatch", text: "Do not dispatch" });
		await host.waitForIdle();
		assert.equal(user.receipt(sent.id)?.generation?.status, "blocked");
		assert.equal(f.requests.length, 0);
		await host.dispose();
		assert.equal(cleaned, 1);
	} finally {
		await f.close();
	}
});
