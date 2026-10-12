import { test } from "node:test";
import assert from "node:assert/strict";
import { deferred, fixture } from "./fixture.ts";

test("queued observer replacement cannot run before actual core handoff", { timeout: 15000 }, async () => {
	const entered = deferred(),
		release = deferred();
	const f = await fixture(
		{
			tools: [
				{
					name: "gate",
					description: "gate",
					parameters: { type: "object", properties: {} },
					execute: async () => {
						entered.resolve();
						await release.promise;
						return "RESULT";
					},
				},
			],
		},
		(_p, n) => (n === 1 ? { tool: "gate" } : { text: "ANSWER" }),
	);
	let replacement: Promise<void> | undefined;
	try {
		const host = await f.start(),
			user = host.connect("user", ["input.submit"]);
		await user.submit({ key: "start", text: "START" });
		await entered.promise;
		host.subscribe((event) => {
			if (event.type === "receipt" && event.receipt.key === "reentrant" && event.receipt.state === "queued")
				replacement = host.newSession();
		});
		const queued = await user.submit({ key: "reentrant", text: "STALE", mode: "followUp" });
		assert.ok(replacement);
		assert.equal(user.receipt(queued.id)?.state, "unknown");
		release.resolve();
		await replacement;
		assert.equal(user.receipt(queued.id)?.state, "released");
		assert.equal(f.requests.length, 1, "cancelled input never dispatched before replacement");
	} finally {
		release.resolve();
		await replacement;
		await f.close();
	}
});
