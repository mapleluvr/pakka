import { test } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "../../../packages/agent/test/fixture.ts";
import { createWorkerManager } from "../src/worker-manager.ts";
import { configuration } from "../src/worker-ipc.ts";
import { decodeBootstrap } from "../src/bootstrap.ts";

test("worker catalog accepts pending protection without a lifetime quota", async () => {
	const f = await fixture();
	try {
		configuration({
			runtime: {
				cwd: f.cwd,
				dataDir: f.dataDir,
				endpoint: f.endpoint,
				model: "local-model",
				apiKey: "local-only",
				reservedSessionId: "91383703-b5ca-441c-81de-72b487a3e2b8",
				limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 2 },
			},
			catalog: { namespace: "members", maxPending: 2 },
		});
		assert.equal(f.requests.length, 0);
	} finally {
		await f.close();
	}
});

test("Telegraph presets: worker and product JSON retain switches and refuse invalid selections", () => {
	const runtime = {
		cwd: "/unused",
		dataDir: "/unused-data",
		endpoint: "http://127.0.0.1:1/v1",
		model: "local-model",
		apiKey: "local-only",
		systemPrompt: "Preset validation only",
		reservedSessionId: "91383703-b5ca-441c-81de-72b487a3e2b8",
		limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 2 },
		profiles: [{ id: "plain", systemPrompt: "Plain" }],
	};
	const catalog = { namespace: "members", maxPending: 2 };
	const validate = (telegraphByProfile: unknown) => {
		const devpack = { profiles: { default: ["discover"] }, telegraphByProfile };
		const worker: unknown = JSON.parse(JSON.stringify({ runtime, catalog, devpack }));
		configuration(worker);
		const product = decodeBootstrap(
			JSON.parse(
				JSON.stringify({
					schema: "pakka.server.v1",
					runtime,
					mas: catalog,
					devpack,
					members: [{ key: "root", owner: "operator" }],
					roles: [
						{
							token: "local-telegraph-aaaaaaaaaaaaaaaaaaaaaaaaaa",
							principal: "operator",
							sourceKey: null,
							grants: ["send"],
						},
					],
				}),
			),
		);
		assert.deepEqual(worker.devpack, product.devpack);
		assert.deepEqual(product.devpack?.telegraphByProfile, telegraphByProfile);
	};
	for (const selected of [
		undefined,
		{},
		{ default: {} },
		{ default: { reasoning: true } },
		{ default: { communication: true } },
		{ default: { reasoning: true, communication: true } },
		{ default: { reasoning: false, communication: false } },
	])
		validate(selected);
	for (const selected of [
		null,
		[],
		true,
		{ default: null },
		{ default: [] },
		{ default: { reasoning: "true" } },
		{ default: { communication: 1 } },
		{ default: { communications: true } },
		{ plain: { reasoning: true } },
		{ missing: { communication: true } },
	]) {
		const devpack = { profiles: { default: ["discover"] }, telegraphByProfile: selected };
		assert.throws(() => configuration({ runtime, catalog, devpack }), /Telegraph/);
		assert.throws(
			() =>
				decodeBootstrap({
					schema: "pakka.server.v1",
					runtime,
					mas: catalog,
					devpack,
					members: [{ key: "root", owner: "operator" }],
					roles: [
						{
							token: "local-telegraph-aaaaaaaaaaaaaaaaaaaaaaaaaa",
							principal: "operator",
							sourceKey: null,
							grants: ["send"],
						},
					],
				}),
			/Telegraph/,
		);
	}
});

// Missing early UUID validation accepts these presets before probing a derived path or spawning a child.
for (const reservedSessionId of [
	"../../outside-reservation",
	"not-a-uuid",
	"91383703-b5ca-441c-81de-72b487a3e2bg",
	"91383703-b5ca-441c-81de-72b487a3e2bA",
]) {
	test(
		"M3 review: invalid reserved Session identity is refused at manager construction: " + reservedSessionId,
		async () => {
			const f = await fixture();
			let manager: ReturnType<typeof createWorkerManager> | undefined;
			try {
				assert.throws(() => {
					manager = createWorkerManager({
						maxWorkers: 1,
						startupTimeoutMs: 5000,
						requestTimeoutMs: 5000,
						placements: {
							one: {
								runtime: {
									cwd: f.cwd,
									dataDir: f.dataDir,
									endpoint: f.endpoint,
									model: "local-model",
									apiKey: "local-only",
									systemPrompt: "validation",
									reservedSessionId,
									limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 2 },
								},
								catalog: { namespace: "members", maxDeliveries: 8, maxPending: 2 },
							},
						},
					});
				}, /reserved|identity|UUID/);
				assert.equal(f.requests.length, 0);
				assert.equal(existsSync(join(f.dataDir, "sessions", reservedSessionId)), false);
			} finally {
				await manager?.close();
				await f.close();
			}
		},
	);
}
