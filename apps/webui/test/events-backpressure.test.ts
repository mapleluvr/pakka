import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fixture } from "./fixture.ts";
import { stream } from "./events.ts";

test(
	"WebUI SSE: normal large frame handles backpressure and remains subscribed for the next real commit",
	{ timeout: 10000 },
	async () => {
		const m = await fixture();
		let events: Awaited<ReturnType<typeof stream>> | undefined;
		try {
			for (let i = 0; i < 8; i++)
				await m.client.display(m.ref, { requestId: "large-" + i, kind: "card", text: "L".repeat(12000) });
			events = await stream(m.http.origin, m.ref.conversationId, m.admin.cookies);
			const first = await events.next();
			assert.ok(first?.kind === "conversation");
			assert.equal(first.snapshot.entries.filter((row) => row.display?.text.length === 12000).length, 8);
			await m.client.display(m.ref, { requestId: "next", kind: "card", text: "AFTER-LARGE" });
			const next = await events.next();
			assert.ok(
				next?.kind === "conversation",
				"a single full write buffer is not a disconnected/slow client",
			);
			assert.ok(next.snapshot.entries.some((row) => row.display?.text === "AFTER-LARGE"));
			assert.equal(m.f.requests.length, 0);
		} finally {
			events?.close();
			await m.close();
		}
	},
);
