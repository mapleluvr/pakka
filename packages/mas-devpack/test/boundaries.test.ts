import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMasDevPack } from "../src/index.ts";
import { createMas, type MasClient } from "../../mas/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { text, deferred } from "../../agent/test/fixture.ts";
import type { ConversationRef, ToolInvocationScope } from "../../agent/src/index.ts";

test(
	"M4: foreign and ended invocations cannot use another profile's DevPack client",
	{ timeout: 15000 },
	async () => {
		let actor!: MasClient, target!: ConversationRef, late!: ToolInvocationScope;
		const pack = createMasDevPack({
			resolve: (scope) => {
				late = scope;
				return actor;
			},
		});
		const m = await runtimeFixture(
			{
				profiles: [
					{ id: "pack", tools: pack.tools, systemPrompt: pack.instructions },
					{ id: "plain", tools: [] },
				],
			},
			undefined,
			(payload) =>
				text(payload).includes("FOREIGN-PACK") && !payload.messages.some((message) => message.role === "tool")
					? { tool: "mas_send", args: { target, requestId: "foreign", text: "NO-FOREIGN-SEND" } }
					: { text: "finished" },
		);
		try {
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "foreign-pack",
				maxDeliveries: 8,
				maxPending: 4,
			});
			await mas.bootstrap([
				{ key: "a", owner: "operator", profile: "pack" },
				{ key: "b", owner: "operator", profile: "pack" },
				{ key: "c", owner: "operator", profile: "plain" },
			]);
			await mas.activate();
			const [a, b, c] = (await mas.view()).members;
			target = c!.ref;
			actor = mas.connect({ principal: "a", source: a!.ref, grants: ["send"] });
			const admin = mas.connect({ principal: "operator", source: null, grants: ["send"] });
			const start = await admin.send(b!.ref, { requestId: "start", text: "FOREIGN-PACK" });
			await admin.wait(start.id);
			await m.runtime.waitForIdle();
			const send = pack.tools.find((tool) => tool.name === "mas_send")!;
			const rejected = JSON.parse(
				await send.execute({ target, requestId: "late", text: "NO-LATE-SEND" }, undefined, late),
			);
			assert.equal(rejected.status, "denied");
			const copied = JSON.parse(
				await send.execute({ target, requestId: "copy", text: "NO-COPIED-SEND" }, undefined, { ...late }),
			);
			assert.equal(copied.status, "denied");
			assert.equal((await m.runtime.conversation(c!.ref)).view().context.length, 0);
			assert.equal(m.f.requests.length, 2);
		} finally {
			await m.close();
		}
	},
);

test(
	"M4: profile removal replaces current prompt, retains historical updates and denies old tools",
	{ timeout: 15000 },
	async () => {
		let actor!: MasClient;
		let resolutions = 0,
			forced = false;
		const pack = createMasDevPack({
			resolve: () => {
				resolutions++;
				return actor;
			},
		});
		const m = await runtimeFixture(
			{
				profiles: [
					{ id: "pack", tools: pack.tools, systemPrompt: pack.instructions },
					{ id: "plain", tools: [], systemPrompt: "PLAIN-PROFILE" },
				],
			},
			undefined,
			(payload) => {
				if (text(payload).includes("WITHOUT-OPTIONAL-PACK") && !forced) {
					forced = true;
					return { tool: "mas_discover" };
				}
				return text(payload).includes("WITH-PACK") &&
					!payload.messages.some((message) => message.role === "tool")
					? { tool: "mas_discover" }
					: { text: "finished" };
			},
		);
		try {
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "optional-pack",
				maxDeliveries: 8,
				maxPending: 4,
			});
			await mas.bootstrap([{ key: "a", owner: "operator", profile: "pack" }]);
			await mas.activate();
			const a = (await mas.view()).members[0]!;
			actor = mas.connect({ principal: "a", source: a.ref, grants: ["discover"] });
			const admin = mas.connect({ principal: "operator", source: null, grants: ["send", "configure"] });
			const first = await admin.send(a.ref, { requestId: "first", text: "WITH-PACK" });
			await admin.wait(first.id);
			await m.runtime.waitForIdle();
			const switched = await admin.configure(a.ref, "plain");
			const next = await admin.send(switched.ref, { requestId: "next", text: "WITHOUT-OPTIONAL-PACK" });
			await admin.wait(next.id);
			await m.runtime.waitForIdle();
			const initial = m.f.requests[0]!.tools as { function: { name: string } }[];
			assert.ok(initial.some((tool) => tool.function.name.startsWith("mas_")));
			const last = m.f.requests.at(-1)!;
			assert.equal((last.tools ?? []).length, 0);
			assert.ok(
				last.messages
					.filter((message) => message.role === "system")
					.some((message) => String(message.content).includes("PLAIN-PROFILE")),
			);
			const updates = last.messages.filter((message) => message.role === "system");
			assert.ok(
				updates.some((message) => String(message.content).includes("MAS DevPack")),
				"Native historical prompt update was unexpectedly erased",
			);
			assert.equal(
				String(updates.at(-1)!.content).includes("MAS DevPack"),
				false,
				"Current system update still selected removed instructions",
			);
			assert.equal(resolutions, 1, "Removed native tool still executed its contribution");
			assert.ok(forced);
			assert.equal(m.f.requests.length, 4);
		} finally {
			await m.close();
		}
	},
);

test(
	"M4: bounded ask never withdraws placed peer input when its wait expires",
	{ timeout: 15000 },
	async () => {
		let actor!: MasClient, peer!: ConversationRef;
		const options = { resolve: () => actor, operationTimeoutMs: 200 };
		const pack = createMasDevPack(options),
			arrived = deferred(),
			release = deferred();
		const m = await runtimeFixture(
			{
				profiles: [
					{ id: "pack", tools: pack.tools, systemPrompt: pack.instructions },
					{ id: "plain", tools: [] },
				],
			},
			undefined,
			async (payload) => {
				if (text(payload).includes("BLOCKED-PEER")) {
					arrived.resolve();
					await release.promise;
					return { text: "peer-finished" };
				}
				return text(payload).includes("ASK-FROM-PACK") &&
					!payload.messages.some((message) => message.role === "tool")
					? { tool: "mas_ask", args: { target: peer, requestId: "asked", text: "BLOCKED-PEER" } }
					: { text: "ask-wait-finished" };
			},
		);
		try {
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "ask-pack",
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
			const admin = mas.connect({ principal: "operator", source: null, grants: ["send"] });
			const start = await admin.send(a!.ref, { requestId: "start", text: "ASK-FROM-PACK" });
			await arrived.promise;
			await Promise.race([
				admin.wait(start.id),
				new Promise<void>((resolve) => {
					setTimeout(resolve, 1000).unref();
				}),
			]);
			const providerReply = m.f.requests.find((payload) =>
				payload.messages.some((message) => message.role === "tool"),
			)!;
			assert.ok(providerReply, "Ask did not finish under its declared deadline");
			const output = JSON.parse(
				String(providerReply.messages.find((message) => message.role === "tool")!.content),
			);
			assert.equal(output.status, "unknown");
			const same = await actor.send(peer, { requestId: "asked", text: "BLOCKED-PEER" });
			assert.equal(same.status, "placed");
			assert.equal(
				m.f.requests.filter(
					(payload) => text(payload).includes("BLOCKED-PEER") && !text(payload).includes("ASK-FROM-PACK"),
				).length,
				1,
			);
			release.resolve();
			await m.runtime.waitForIdle();
			assert.equal((await actor.receipt(same.id)).status, "done");
		} finally {
			release.resolve();
			await m.close();
		}
	},
);
