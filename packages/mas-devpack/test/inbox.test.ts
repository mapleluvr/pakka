import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMasDevPack } from "../src/index.ts";
import { createMas, type MasClient } from "../../mas/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { text } from "../../agent/test/fixture.ts";

test(
	"M4: model discovers native incoming receipt and replies without prompt markers or forged sender",
	{ timeout: 15000 },
	async () => {
		let actor!: MasClient;
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
				if (!text(payload).includes("QUESTION-TO-B")) return { text: "reply received" };
				const results = payload.messages.filter((message) => message.role === "tool");
				if (results.length === 0) return { tool: "mas_inbox" };
				if (results.length > 1) return { text: "replied" };
				let incoming: unknown;
				try {
					incoming = JSON.parse(String(results[0]!.content));
				} catch {
					return { text: "INBOX-NOT-AVAILABLE" };
				}
				if (!Array.isArray(incoming) || !incoming.length) return { text: "INBOX-NOT-AVAILABLE" };
				return {
					tool: "mas_reply",
					args: { receiptId: incoming[0].id, requestId: "native-reply", text: "MODEL-REPLY-ANSWER" },
				};
			},
		);
		try {
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "reply-tools",
				maxDeliveries: 16,
				maxPending: 4,
			});
			await mas.bootstrap([
				{ key: "a", owner: "operator", profile: "plain" },
				{ key: "b", owner: "operator", profile: "pack" },
			]);
			await mas.activate();
			const [a, b] = (await mas.view()).members;
			actor = mas.connect({ principal: "b", source: b!.ref, grants: ["reply"] });
			const from = mas.connect({ principal: "a", source: a!.ref, grants: ["send"] });
			const request = await from.send(b!.ref, { requestId: "question", text: "QUESTION-TO-B" });
			await from.wait(request.id);
			await m.runtime.waitForIdle();
			const source = await m.runtime.conversation(a!.ref);
			assert.ok(
				source
					.view()
					.context.some((message) => message.role === "user" && message.text.includes("MODEL-REPLY-ANSWER")),
				"Real source did not receive model reply",
			);
			assert.equal(m.f.requests.length, 4);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await m.close();
		}
	},
);
