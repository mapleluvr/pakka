import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { HostOptions, ConversationRef, ToolInvocationScope } from "../../agent/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { text, deferred } from "../../agent/test/fixture.ts";
import { createMas, type MasClient } from "../../mas/src/index.ts";

// The missing factory is the initial red condition, not a replacement for behavioral assertions.
async function factory() {
	const path = new URL("../src/index.ts", import.meta.url).href;
	const module = await import(path).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
		return {};
	});
	assert.equal(typeof module.createMasDevPack, "function", "DevPack production factory is missing");
	return module.createMasDevPack as (options: { resolve(scope: ToolInvocationScope): MasClient }) => {
		readonly tools: NonNullable<HostOptions["tools"]>;
		readonly instructions: string;
		revoke(): void;
	};
}

test(
	"M4: real DevPack tool call routes to peer with native invocation and no caller principal",
	{ timeout: 15000 },
	async () => {
		const create = await factory();
		let actor!: MasClient, peer!: ConversationRef;
		const pack = create({ resolve: () => actor });
		const m = await runtimeFixture(
			{
				profiles: [
					{ id: "pack", systemPrompt: pack.instructions, tools: pack.tools },
					{ id: "plain", tools: [] },
				],
			},
			undefined,
			(payload) =>
				text(payload).includes("USE-PACK") && !payload.messages.some((message) => message.role === "tool")
					? { tool: "mas_send", args: { target: peer, requestId: "peer-message", text: "NATIVE-PEER-INPUT" } }
					: { text: "finished" },
		);
		try {
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "pack",
				maxDeliveries: 16,
				maxPending: 4,
			});
			await mas.bootstrap([
				{ key: "a", owner: "operator", profile: "pack" },
				{ key: "b", owner: "operator", profile: "plain" },
			]);
			await mas.activate();
			const [a, b] = (await mas.view()).members;
			peer = b!.ref;
			actor = mas.connect({ principal: "a", source: a!.ref, grants: ["send"] });
			const admin = mas.connect({ principal: "operator", source: null, grants: ["send"] });
			const receipt = await admin.send(a!.ref, { requestId: "start", text: "USE-PACK" });
			await admin.wait(receipt.id);
			await m.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 3);
			assert.equal(m.f.requests.filter((payload) => text(payload).includes("NATIVE-PEER-INPUT")).length, 1);
			const advertised = m.f.requests[0]!.tools as {
				function: { name: string; parameters: Record<string, unknown> };
			}[];
			assert.ok(advertised.some((tool) => tool.function.name === "mas_send"));
			assert.ok(advertised.every((tool) => /^[a-zA-Z0-9_-]+$/.test(tool.function.name)));
			const toolsText = JSON.stringify(advertised);
			assert.equal(toolsText.includes("apiKey"), false);
			const toolOutput = m.f.requests.find((payload) =>
				payload.messages.some((message) => message.role === "tool"),
			);
			assert.ok(text(toolOutput!).includes("peer-message"));
			assert.equal(m.f.errors.length, 0);
		} finally {
			await m.close();
		}
	},
);

test(
	"M4: revoked package during recipient admission produces zero target HTTP",
	{ timeout: 15000 },
	async () => {
		const create = await factory();
		let actor!: MasClient, peer!: ConversationRef;
		const pack = create({ resolve: () => actor });
		const entered = deferred(),
			release = deferred();
		const m = await runtimeFixture(
			{
				profiles: [
					{ id: "pack", systemPrompt: pack.instructions, tools: pack.tools },
					{ id: "plain", tools: [] },
				],
			},
			undefined,
			(payload) =>
				text(payload).includes("REVOKE-PACK") && !payload.messages.some((message) => message.role === "tool")
					? { tool: "mas_send", args: { target: peer, requestId: "revoked", text: "MUST-NOT-REACH-PEER" } }
					: { text: "finished" },
		);
		try {
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "revoke-pack",
				maxDeliveries: 8,
				maxPending: 4,
			});
			await mas.bootstrap([
				{ key: "a", owner: "operator", profile: "pack" },
				{ key: "b", owner: "operator", profile: "plain" },
			]);
			await mas.activate();
			const [a, b] = (await mas.view()).members;
			peer = b!.ref;
			actor = mas.connect({ principal: "a", source: a!.ref, grants: ["send"] });
			mas.setAdmission(async (request) => {
				if (request.input.requestId === "revoked") {
					entered.resolve();
					await release.promise;
				}
				return true;
			});
			const admin = mas.connect({ principal: "operator", source: null, grants: ["send"] });
			const start = await admin.send(a!.ref, { requestId: "start", text: "REVOKE-PACK" });
			await entered.promise;
			pack.revoke();
			release.resolve();
			await admin.wait(start.id);
			await m.runtime.waitForIdle();
			assert.equal(
				m.f.requests.filter(
					(payload) =>
						text(payload).includes("MUST-NOT-REACH-PEER") && !text(payload).includes("REVOKE-PACK"),
				).length,
				0,
			);
			const bHost = await m.runtime.conversation(b!.ref);
			assert.equal(bHost.view().context.length, 0);
		} finally {
			release.resolve();
			await m.close();
		}
	},
);

test(
	"M4: temporary spawn binds actual tool task, advertises no authority-bearing schema",
	{ timeout: 15000 },
	async () => {
		const create = await factory();
		let actor!: MasClient;
		const pack = create({ resolve: () => actor });
		const m = await runtimeFixture(
			{
				profiles: [
					{ id: "pack", systemPrompt: pack.instructions, tools: pack.tools },
					{ id: "plain", tools: [] },
				],
			},
			undefined,
			(payload) =>
				text(payload).includes("SPAWN-TEMP") && !payload.messages.some((message) => message.role === "tool")
					? {
							tool: "mas_spawn",
							args: {
								location: "current-session",
								key: "temporary-child",
								profile: "plain",
								lifetime: "temporary",
							},
						}
					: { text: "finished" },
		);
		try {
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "temporary",
				maxDeliveries: 8,
				maxPending: 4,
			});
			await mas.bootstrap([{ key: "a", owner: "operator", profile: "pack" }]);
			await mas.activate();
			const a = (await mas.view()).members[0]!;
			actor = mas.connect({ principal: "a", source: a.ref, grants: ["spawn"] });
			const admin = mas.connect({ principal: "operator", source: null, grants: ["send"] });
			const start = await admin.send(a.ref, { requestId: "start", text: "SPAWN-TEMP" });
			await admin.wait(start.id);
			await m.runtime.waitForIdle();
			const snapshot = await m.runtime
				.catalog({ namespace: "temporary", maxDeliveries: 8, maxPending: 4 })
				.snapshot();
			const child = snapshot.members.find((member) => member.key === "temporary-child")!;
			assert.ok(child, "actual child was enrolled");
			assert.ok(child.ownerTaskId);
			assert.equal(child.data.owner, "a");
			const observed = await m.runtime
				.catalog({ namespace: "temporary", maxDeliveries: 8, maxPending: 4 })
				.readiness(child.ref);
			assert.equal(observed.phase, "ended");
			assert.equal(m.f.requests.length, 2, "creation alone never dispatches a child provider request");
		} finally {
			await m.close();
		}
	},
);
