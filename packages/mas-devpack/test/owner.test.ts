import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMasDevPack } from "../src/index.ts";
import { createMas, type MasClient } from "../../mas/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { text } from "../../agent/test/fixture.ts";
import type { ConversationRef } from "../../agent/src/index.ts";

test(
	"M4: real communicator tool cannot retire peer even with a lifecycle action grant",
	{ timeout: 15000 },
	async () => {
		let actor!: MasClient, peer!: ConversationRef;
		const pack = createMasDevPack({ resolve: () => actor });
		const m = await runtimeFixture(
			{
				profiles: [
					{ id: "pack", tools: pack.tools, systemPrompt: pack.instructions },
					{ id: "plain", tools: [] },
				],
			},
			undefined,
			(payload) => {
				if (!text(payload).includes("COMMUNICATOR-TOOLS")) return { text: "peer still available" };
				const outputs = payload.messages.filter((message) => message.role === "tool");
				if (outputs.length === 0)
					return {
						tool: "mas_send",
						args: { target: peer, requestId: "communicate", text: "PEER-COMMUNICATION" },
					};
				if (outputs.length === 1) return { tool: "mas_retire", args: { target: peer } };
				return { text: "finished" };
			},
		);
		try {
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "owner-pack",
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
			actor = mas.connect({ principal: "a", source: a!.ref, grants: ["send", "retire"] });
			const admin = mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] });
			await admin.wait((await admin.send(a!.ref, { requestId: "start", text: "COMMUNICATOR-TOOLS" })).id);
			await m.runtime.waitForIdle();
			assert.equal((await admin.inspect(peer)).phase, "active");
			await admin.wait((await admin.send(peer, { requestId: "probe", text: "PEER-AFTER-DENIED-RETIRE" })).id);
			await m.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 5);
			assert.equal(
				m.f.requests.filter((payload) =>
					String(payload.messages.filter((message) => message.role === "user").at(-1)?.content).includes(
						"PEER-COMMUNICATION",
					),
				).length,
				1,
			);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await m.close();
		}
	},
);
