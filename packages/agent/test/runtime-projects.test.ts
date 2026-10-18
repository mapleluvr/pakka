import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, type ConversationRef, type StrategyBinding } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

// Ignoring an approved project's cwd must read the wrong real file; changed recovery definitions must not redirect old work.
test("Runtime project profiles: real tool reads follow the selected cwd and persist across a normal reopen", async () => {
	const m = await runtimeFixture({}, undefined, (_payload, n) =>
		n % 2 ? { tool: "read_project" } : { text: "PROJECT-READ-DONE" },
	);
	await m.runtime.close();
	const other = join(m.f.root, "other-project");
	await mkdir(other);
	await writeFile(join(m.f.cwd, "marker.txt"), "FIRST-PROJECT-CONTENT");
	await writeFile(join(other, "marker.txt"), "SECOND-PROJECT-CONTENT");
	let binding: StrategyBinding | undefined;
	const config = {
		...m.config,
		dataDir: join(m.f.root, "project-runtime"),
		profiles: [{ id: "second", cwd: other }],
		tools: [
			{
				name: "read_project",
				description: "Read this project's marker",
				parameters: { type: "object", properties: {}, additionalProperties: false },
				execute: async (
					_args: Record<string, unknown>,
					_signal: AbortSignal | undefined,
					scope: Parameters<StrategyBinding["readFrame"]>[0],
				) => readFile(join(binding!.readFrame(scope).cwd, "marker.txt"), "utf8"),
			},
		],
	};
	let runtime = await createRuntime(config);
	const catalogOptions = { namespace: "cwd-projects", maxDeliveries: 16, maxPending: 4 };
	async function inspect(ref: ConversationRef) {
		const host = await runtime.conversation(ref),
			client = host.connect("project-probe-" + ref.incarnation, ["real_context.write"]);
		client.activateStrategy({ id: "cwd-probe", hooks: ["real_context.write"] });
		binding = client.bindStrategy("cwd-probe");
		return binding.readFrame().cwd;
	}
	try {
		let catalog = runtime.catalog(catalogOptions);
		const original = (
			await catalog.enroll([{ key: "project", profile: "default", data: { phase: "active" } }], () => {})
		)[0]!.ref;
		assert.equal(await inspect(original), m.f.cwd);
		let sent = await catalog.deliver(
			{
				requestId: "first",
				principal: "operator",
				source: null,
				target: original,
				text: "Read the project",
				mode: "prompt",
			},
			() => {},
		);
		assert.equal((await catalog.wait(sent.id, () => {})).status, "done");
		assert.match(JSON.stringify(m.f.requests[1]), /FIRST-PROJECT-CONTENT/);
		const changed = (await catalog.configure(original, "second", () => {})).ref;
		assert.equal(
			await inspect(changed),
			other,
			"Configuration must update the actual native Conversation cwd",
		);
		assert.notEqual(changed.incarnation, original.incarnation);
		await assert.rejects(runtime.conversation(original), /ref|stale|incarnation|resource/i);
		sent = await catalog.deliver(
			{
				requestId: "second",
				principal: "operator",
				source: null,
				target: changed,
				text: "Read the other project",
				mode: "prompt",
			},
			() => {},
		);
		assert.equal((await catalog.wait(sent.id, () => {})).status, "done");
		assert.match(JSON.stringify(m.f.requests[3]), /SECOND-PROJECT-CONTENT/);
		const sessionFile = runtime.view().sessionFile,
			budget = runtime.view().budget;
		await runtime.close();
		await assert.rejects(
			createRuntime({
				...config,
				reopenSessionFile: sessionFile,
				profiles: [{ id: "second", cwd: m.f.cwd }],
			}),
			/profile|reopen|changed/i,
		);
		assert.equal(m.f.requests.length, 4);
		runtime = await createRuntime({ ...config, reopenSessionFile: sessionFile });
		catalog = runtime.catalog(catalogOptions);
		assert.equal(await inspect(changed), other);
		assert.deepEqual(runtime.view().budget, budget);
		assert.equal(m.f.requests.length, 4, "Reopen must not replay any original model or tool work");
		sent = await catalog.deliver(
			{
				requestId: "third",
				principal: "operator",
				source: null,
				target: changed,
				text: "Read after reopening",
				mode: "prompt",
			},
			() => {},
		);
		assert.equal((await catalog.wait(sent.id, () => {})).status, "done");
		assert.match(JSON.stringify(m.f.requests[5]), /SECOND-PROJECT-CONTENT/);
	} finally {
		await runtime.close();
		await m.f.close();
	}
});

test("Runtime project profiles: invalid or missing cwd is refused before opening storage", async () => {
	const m = await runtimeFixture();
	try {
		const file = join(m.f.root, "not-directory");
		await writeFile(file, "content");
		for (const [index, cwd] of [
			"relative/project",
			"",
			null,
			42,
			join(m.f.root, "missing"),
			file,
		].entries()) {
			const dataDir = join(m.f.root, "bad-cwd-" + index);
			let unexpected: Awaited<ReturnType<typeof createRuntime>> | undefined;
			try {
				await assert.rejects(async () => {
					unexpected = await Reflect.apply(createRuntime, undefined, [
						{ ...m.config, dataDir, profiles: [{ id: "invalid", cwd }] },
					]);
				}, /cwd|directory|profile/i);
			} finally {
				await unexpected?.close();
			}
			await assert.rejects(access(dataDir));
		}
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
