import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, type ConversationRef, type StrategyBinding } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

// Whole-profile replacement would change tools/instructions/cwd when choosing a model, or lose the model after choosing cwd.
test("Independent configuration: actual provider, tool cwd and instructions remain independent across reopen", async () => {
	const m = await runtimeFixture({}, undefined, (_body, n) =>
		n % 2 ? { tool: "read_marker" } : { text: "INDEPENDENT-DONE" },
	);
	await m.runtime.close();
	const other = join(m.f.root, "approved"),
		nested = join(other, "nested");
	await mkdir(nested, { recursive: true });
	await writeFile(join(m.f.cwd, "marker.txt"), "ORIGINAL-MARKER");
	await writeFile(join(nested, "marker.txt"), "NESTED-MARKER");
	let binding: StrategyBinding;
	const config = {
		...m.config,
		dataDir: join(m.f.root, "independent"),
		profiles: [
			{
				id: "alternate",
				model: "alternate-model",
				cwd: other,
				systemPrompt: "DO-NOT-APPLY-ALT-INSTRUCTIONS",
				tools: [],
			},
		],
		tools: [
			{
				name: "read_marker",
				description: "Read marker in current working directory",
				parameters: { type: "object", properties: {}, additionalProperties: false },
				execute: async (
					_args: Record<string, unknown>,
					_signal: AbortSignal | undefined,
					scope: Parameters<StrategyBinding["readFrame"]>[0],
				) => readFile(join(binding.readFrame(scope).cwd, "marker.txt"), "utf8"),
			},
		],
	};
	let runtime = await createRuntime(config);
	const catalogOptions = { namespace: "independent", maxDeliveries: 16, maxPending: 4 };
	async function bind(ref: ConversationRef) {
		const host = await runtime.conversation(ref),
			client = host.connect("probe-" + ref.incarnation, ["real_context.write"]);
		client.activateStrategy({ id: "probe", hooks: ["real_context.write"] });
		binding = client.bindStrategy("probe");
		return binding.readFrame().cwd;
	}
	try {
		let catalog = runtime.catalog(catalogOptions);
		const original = (
			await catalog.enroll([{ key: "independent", profile: "default", data: { phase: "active" } }], () => {})
		)[0]!.ref;
		let ref = (await catalog.configureAgent(original, { model: "alternate-model" }, () => {})).ref;
		assert.equal(ref.profile, "default");
		assert.equal(await bind(ref), m.f.cwd);
		let sent = await catalog.deliver(
			{
				requestId: "model-only",
				principal: "operator",
				source: null,
				target: ref,
				text: "Read marker",
				mode: "prompt",
			},
			() => {},
		);
		assert.equal((await catalog.wait(sent.id, () => {})).status, "done");
		assert.equal(m.f.requests[0]?.model, "alternate-model");
		assert.match(JSON.stringify(m.f.requests[1]), /ORIGINAL-MARKER/);
		assert.match(JSON.stringify(m.f.requests[0]), /PAKKA-SYSTEM/);
		assert.doesNotMatch(JSON.stringify(m.f.requests), /DO-NOT-APPLY-ALT-INSTRUCTIONS/);
		ref = (await catalog.configureAgent(ref, { cwd: nested }, () => {})).ref;
		assert.equal(await bind(ref), nested);
		sent = await catalog.deliver(
			{
				requestId: "cwd-only",
				principal: "operator",
				source: null,
				target: ref,
				text: "Read nested marker",
				mode: "prompt",
			},
			() => {},
		);
		assert.equal((await catalog.wait(sent.id, () => {})).status, "done");
		assert.equal(m.f.requests[2]?.model, "alternate-model");
		assert.match(JSON.stringify(m.f.requests[3]), /NESTED-MARKER/);
		const tip = (await runtime.readConversation(ref, () => {})).entries.at(-1)!.id;
		const fork = (
			await catalog.enroll(
				[
					{
						key: "independent-fork",
						profile: ref.profile,
						data: { phase: "active" },
						fork: { source: ref, entryId: tip },
					},
				],
				() => {},
			)
		)[0]!.ref;
		assert.deepEqual(
			await runtime.configuration(fork),
			{ model: "alternate-model", cwd: nested },
			"Forking the same base profile preserves independently selected model/cwd",
		);
		await assert.rejects(runtime.conversation(original), /ref|stale|incarnation/i);
		const sessionFile = runtime.view().sessionFile,
			budget = runtime.view().budget;
		await runtime.close();
		runtime = await createRuntime({ ...config, reopenSessionFile: sessionFile });
		assert.equal(await bind(ref), nested);
		assert.deepEqual(await runtime.configuration(ref), { model: "alternate-model", cwd: nested });
		assert.deepEqual(runtime.view().budget, budget);
		assert.equal(m.f.requests.length, 4, "Reopen must not replay model or tool calls");
	} finally {
		await runtime.close();
		await m.f.close();
	}
});

test("Independent configuration: active native work and follow-up retain admission when a change is refused", async () => {
	let release!: () => void, started!: () => void;
	const began = new Promise<void>((resolve) => {
		started = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const m = await runtimeFixture(
		{ profiles: [{ id: "alternate", model: "alternate-model" }] },
		undefined,
		async (_body, n) => {
			if (n === 1) {
				started();
				await gate;
			}
			return { text: "HELD-DONE" };
		},
	);
	try {
		const catalog = m.runtime.catalog({ namespace: "busy-config", maxDeliveries: 8, maxPending: 4 });
		const ref = (
			await catalog.enroll([{ key: "busy", profile: "default", data: { phase: "active" } }], () => {})
		)[0]!.ref;
		const active = await catalog.deliver(
			{
				requestId: "active",
				principal: "operator",
				source: null,
				target: ref,
				text: "Held work",
				mode: "prompt",
			},
			() => {},
		);
		await began;
		const queued = await catalog.deliver(
			{
				requestId: "follow",
				principal: "operator",
				source: null,
				target: ref,
				text: "Native follow up",
				mode: "followUp",
			},
			() => {},
		);
		await assert.rejects(
			catalog.configureAgent(ref, { model: "alternate-model" }, () => {}),
			/idle|busy|active/i,
		);
		await assert.rejects(
			catalog.configureAgent(ref, { cwd: m.f.cwd }, () => {}),
			/idle|busy|active/i,
		);
		assert.equal(m.f.requests.length, 1);
		assert.equal(m.runtime.view().budget.primaryAttempts, 1);
		assert.ok(["queued", "placed"].includes((await catalog.receipt(queued.id, () => {})).status));
		release();
		assert.equal((await catalog.wait(active.id, () => {})).status, "done");
		assert.equal((await catalog.wait(queued.id, () => {})).status, "done");
		assert.equal(m.f.requests.length, 2);
		assert.equal(m.runtime.view().budget.primaryAttempts, 2);
		assert.ok(m.f.requests.every((row) => row.model === "local-model"));
	} finally {
		release();
		await m.close();
	}
});

// Merely resolving or normalizing a requested path must not authorize paths/symlinks outside approved roots.
test("Independent configuration: unapproved model, missing directory and symlink escape cannot change a conversation", async () => {
	const m = await runtimeFixture();
	try {
		const outside = join(m.f.root, "outside");
		await mkdir(outside);
		await symlink(outside, join(m.f.cwd, "escape"), "dir");
		const catalog = m.runtime.catalog({
			namespace: "invalid-configuration",
			maxDeliveries: 8,
			maxPending: 2,
		});
		const ref = (
			await catalog.enroll([{ key: "probe", profile: "default", data: { phase: "active" } }], () => {})
		)[0]!.ref;
		for (const change of [
			{ model: "unapproved" },
			{ cwd: outside },
			{ cwd: join(m.f.cwd, "escape") },
			{ cwd: join(m.f.cwd, "missing") },
			{ cwd: "relative" },
			{},
			{ cwd: m.f.cwd, tools: [] },
		]) {
			await assert.rejects(catalog.configureAgent(ref, change, () => {}));
			assert.deepEqual(await m.runtime.configuration(ref), { model: "local-model", cwd: m.f.cwd });
		}
		assert.equal(m.f.requests.length, 0);
		assert.equal(m.runtime.view().budget.primaryAttempts, 0);
	} finally {
		await m.close();
	}
});
