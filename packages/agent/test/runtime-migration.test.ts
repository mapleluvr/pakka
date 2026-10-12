import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRuntime, type Host, type RuntimeOptions } from "../src/index.ts";
import { fixture, seed } from "./fixture.ts";
import { inferencePolicy, target } from "./strategy-fixture.ts";
import { runtimeLimits } from "./runtime-fixture.ts";

function bound(host: Host) {
	const client = host.connect("owner", ["real_context.write", "context_artifacts.write", "model.infer"]);
	client.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
	return client.bindStrategy("strategy");
}
async function legacy() {
	const f = await fixture();
	const options: RuntimeOptions = {
		cwd: f.cwd,
		dataDir: f.dataDir,
		model: "local-model",
		endpoint: f.endpoint,
		apiKey: "local-only",
		systemPrompt: "PAKKA-SYSTEM",
		...inferencePolicy(f.endpoint),
		limits: runtimeLimits,
	};
	const host = await f.start(options);
	return { f, options, host };
}

test("M1: explicit legacy mapping preserves source/journal transactions/adoption and spent slots", async () => {
	const { f, options, host } = await legacy();
	let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined, reopened: typeof runtime;
	try {
		await seed(host, "LEGACY-SOURCE");
		const beforeView = host.view(),
			strategy = bound(host),
			frame = strategy.readFrame();
		const job = strategy.createJob(frame.basis, {
			planId: "already-paid",
			targetEntryIds: [target(frame)],
			maxCalls: 1,
			requireArtifactReceipt: true,
		});
		const result = await job.infer({ modelKey: "summary", prompt: "LEGACY-AUX", maxOutputTokens: 64 });
		assert.equal(result.status, "completed");
		const receipt = strategy.artifacts.append(job.scope, {
			expectedVersion: 0,
			records: [{ legacy: "ADOPTED" }],
			attemptIds: [result.attemptId],
		});
		assert.equal(receipt.status, "committed");
		await host.dispose();
		const source = await readFile(beforeView.sessionFile, "utf8"),
			journal = await readFile(receipt.journalPath, "utf8");
		const requestCount = f.requests.length;
		runtime = await createRuntime({
			...options,
			reopenSessionFile: beforeView.sessionFile,
			migrateLegacy: {
				expectedSessionId: beforeView.sessionId,
				expectedConversationId: beforeView.conversationId!,
			},
		});
		const migrated = runtime.view().journalMigration!;
		assert.ok(migrated?.id);
		assert.equal(Object.isFrozen(migrated), true);
		assert.equal(runtime.root().view().conversationId, beforeView.conversationId);
		assert.equal(runtime.root().view().providerSessionId, beforeView.providerSessionId);
		assert.equal(f.requests.length, requestCount);
		assert.ok((await readFile(beforeView.sessionFile, "utf8")).startsWith(source));
		assert.equal(await readFile(receipt.journalPath, "utf8"), journal);
		assert.equal(runtime.view().budget.auxiliaryAttempts, 1);
		assert.equal(runtime.view().budget.primaryAttempts, migrated.primaryAttempts);
		assert.ok(migrated.primaryAttempts >= 1);
		const rootBinding = bound(runtime.root());
		assert.deepEqual(rootBinding.readFrame().artifacts.records, [{ legacy: "ADOPTED" }]);
		assert.equal(rootBinding.audit()[0]?.attemptId, result.attemptId);
		const after = rootBinding.artifacts.append(rootBinding.readFrame().basis, {
			expectedVersion: 1,
			records: ["AFTER-MAPPING"],
		});
		assert.equal(after.status, "committed");
		assert.equal(after.journalPath, receipt.journalPath);
		const peer = await runtime.conversation(await runtime.createConversation({ key: "peer" }));
		assert.deepEqual(bound(peer).readFrame().artifacts.records, []);
		await runtime.close();
		reopened = await createRuntime({ ...options, reopenSessionFile: beforeView.sessionFile });
		assert.equal(reopened.view().journalMigration?.id, migrated.id);
		assert.deepEqual(bound(reopened.root()).readFrame().artifacts.records, [
			{ legacy: "ADOPTED" },
			"AFTER-MAPPING",
		]);
		assert.equal(f.requests.length, requestCount);
		await assert.rejects(
			f.start({ ...options, reopenSessionFile: beforeView.sessionFile }),
			/writer|runtime|managed/i,
		);
	} finally {
		await reopened?.close();
		await runtime?.close();
		await f.close();
	}
});

test("M1: legacy tool rounds cannot be migrated into a reset primary budget", async () => {
	const f = await fixture(
		{
			tools: [
				{
					name: "legacy_probe",
					description: "local effect",
					parameters: { type: "object", properties: {} },
					execute: async () => "LOCAL-EFFECT",
				},
			],
		},
		(payload) =>
			payload.messages.some((message) => message.role === "tool")
				? { text: "settled" }
				: { tool: "legacy_probe" },
	);
	let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const options = {
			cwd: f.cwd,
			dataDir: f.dataDir,
			endpoint: f.endpoint,
			model: "local-model",
			apiKey: "local-only",
			limits: runtimeLimits,
		};
		const host = await f.start();
		await seed(host, "LEGACY-TOOL-ROUND");
		const view = host.view();
		await host.dispose();
		assert.equal(f.requests.length, 2);
		const source = await readFile(view.sessionFile, "utf8");
		const migration = {
			reopenSessionFile: view.sessionFile,
			migrateLegacy: { expectedSessionId: view.sessionId, expectedConversationId: view.conversationId! },
		};
		await assert.rejects(
			createRuntime({ ...options, ...migration, limits: { ...runtimeLimits, maxPrimaryAttempts: 1 } }),
			/consumed spending/,
		);
		assert.equal(await readFile(view.sessionFile, "utf8"), source);
		runtime = await createRuntime({ ...options, ...migration });
		assert.ok(runtime.view().budget.primaryAttempts >= f.requests.length);
		assert.equal(f.requests.length, 2);
	} finally {
		await runtime?.close();
		await f.close();
	}
});

for (const rejection of [
	"implicit",
	"wrong-identity",
	"unknown-journal",
	"pending-intent",
	"fork-history",
] as const) {
	test(`M1: ${rejection} legacy migration refuses without dispatch or source rewrite`, async () => {
		const { f, options, host } = await legacy();
		let candidate: Awaited<ReturnType<typeof createRuntime>> | undefined;
		try {
			const seeded = await seed(host),
				strategy = bound(host);
			const receipt = strategy.artifacts.append(strategy.readFrame().basis, {
				expectedVersion: 0,
				records: ["LEGACY"],
			});
			assert.equal(receipt.status, "committed");
			if (rejection === "fork-history") {
				const navigation = host.connect("nav", ["branch.control"]);
				navigation.branch(navigation.capture(), seeded.receipt.entryId!);
				await host.waitForIdle();
			}
			const view = host.view();
			await host.dispose();
			if (rejection === "unknown-journal")
				await writeFile(receipt.journalPath, (await readFile(receipt.journalPath, "utf8")).slice(0, -1));
			if (rejection === "pending-intent") await writeFile(receipt.journalPath + ".intent", "UNCONFIRMED");
			const source = await readFile(view.sessionFile, "utf8"),
				calls = f.requests.length;
			const migrateLegacy =
				rejection === "implicit"
					? undefined
					: {
							expectedSessionId: rejection === "wrong-identity" ? "foreign" : view.sessionId,
							expectedConversationId: view.conversationId!,
						};
			await assert.rejects(
				createRuntime({ ...options, reopenSessionFile: view.sessionFile, migrateLegacy }).then((r) => {
					candidate = r;
					return r;
				}),
				/migration|legacy|journal|provenance|Conversation/i,
			);
			assert.equal(await readFile(view.sessionFile, "utf8"), source);
			assert.equal(f.requests.length, calls);
		} finally {
			await candidate?.close();
			await f.close();
		}
	});
}
