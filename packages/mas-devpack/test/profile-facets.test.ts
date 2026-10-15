import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMas, type Mas } from "@pakka/mas";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { text } from "../../agent/test/fixture.ts";
import { createMasProfilePacks } from "../src/profiles.ts";
import type { ConversationRef } from "@pakka/agent";

// A high-grant child profile must not mint authority beyond its actual native owner ancestry.
test(
	"Agent facet: public approved profiles bind each native invocation and intersect the complete owner chain",
	{ timeout: 15000 },
	async () => {
		let mas: Mas | undefined, peer: ConversationRef | undefined;
		const packs = createMasProfilePacks(
			{ profiles: { limited: ["spawn"], strong: ["spawn", "send"] } },
			() => mas,
		);
		const m = await runtimeFixture(
			{
				tools: [],
				profiles: [...packs].map(([id, pack]) => ({
					id,
					tools: pack.tools,
					systemPrompt: pack.instructions,
				})),
			},
			undefined,
			(payload) => {
				if (payload.messages.some((row) => row.role === "tool")) return { text: "finished" };
				if (text(payload).includes("SPAWN-GRANDCHILD"))
					return {
						tool: "mas_spawn",
						args: { key: "grandchild", profile: "strong", lifetime: "persistent" },
					};
				if (text(payload).includes("SPAWN-STRONG"))
					return { tool: "mas_spawn", args: { key: "child", profile: "strong", lifetime: "persistent" } };
				if (text(payload).includes("ATTEMPT-ESCALATION"))
					return {
						tool: "mas_send",
						args: { target: peer, requestId: "forbidden-peer", text: "MUST-NOT-REACH-PEER" },
					};
				return { text: "plain" };
			},
		);
		try {
			mas = await createMas({
				runtime: m.runtime,
				namespace: "public.profiles",
				maxDeliveries: 16,
				maxPending: 4,
			});
			await mas.bootstrap([
				{ key: "limited", owner: "operator", profile: "limited" },
				{ key: "peer", owner: "operator" },
			]);
			await mas.activate();
			let members = (await mas.view()).members;
			peer = members.find((row) => row.key === "peer")!.ref;
			const human = mas.connect({ principal: "operator", source: null, grants: ["send", "observe"] });
			await human.wait(
				(
					await human.send(members.find((row) => row.key === "limited")!.ref, {
						requestId: "spawn",
						text: "SPAWN-STRONG",
					})
				).id,
			);
			members = (await mas.view()).members;
			const child = members.find((row) => row.key === "child");
			assert.ok(child);
			await human.wait(
				(await human.send(child.ref, { requestId: "spawn-grandchild", text: "SPAWN-GRANDCHILD" })).id,
			);
			const grandchild = (await mas.view()).members.find((row) => row.key === "grandchild");
			assert.ok(grandchild);
			await human.wait(
				(await human.send(grandchild.ref, { requestId: "try", text: "ATTEMPT-ESCALATION" })).id,
			);
			await m.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 6);
			assert.equal(
				m.f.requests.filter((row) =>
					row.messages.some(
						(message) =>
							message.role === "user" && JSON.stringify(message.content).includes("MUST-NOT-REACH-PEER"),
					),
				).length,
				0,
			);
			assert.match(text(m.f.requests.at(-1)!), /"status":"unknown"/);
			assert.match(text(m.f.requests.at(-1)!), /Missing send grant/);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await m.close();
		}
	},
);
