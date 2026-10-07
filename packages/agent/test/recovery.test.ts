import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rename, rm } from "node:fs/promises";
import { deferred, fixture, text } from "./fixture.ts";

test(
	"failed storage cannot be re-enabled by reload; explicit fresh session recovers",
	{ timeout: 15000 },
	async () => {
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
		let damaged: string | undefined;
		try {
			const host = await f.start(),
				user = host.connect("user", ["input.submit"]);
			await user.submit({ key: "old", text: "OLD-FAILED-RUN" });
			await entered.promise;
			damaged = host.view().sessionFile;
			await rename(damaged, damaged + ".saved");
			await mkdir(damaged);
			release.resolve();
			await host.waitForIdle();
			assert.equal(host.view().phase, "failed");
			await rm(damaged, { recursive: true });
			await rename(damaged + ".saved", damaged);
			damaged = undefined;
			await assert.rejects(host.reload(), /failed.*newSession/);
			await host.newSession();
			assert.equal(host.view().phase, "ready");
			await user.submit({ key: "new", text: "FRESH-RECOVERY" });
			await host.waitForIdle();
			assert.match(text(f.requests.at(-1)!), /FRESH-RECOVERY/);
			assert.doesNotMatch(text(f.requests.at(-1)!), /OLD-FAILED-RUN/);
		} finally {
			release.resolve();
			if (damaged) {
				await rm(damaged, { recursive: true });
				await rename(damaged + ".saved", damaged);
			}
			await f.close();
		}
	},
);

test("old suspended preparation cannot hold the new session admission slot", { timeout: 15000 }, async () => {
	const entered = deferred(),
		release = deferred();
	const f = await fixture({
		prepareInput: async ({ text }) => {
			if (text === "OLD") {
				entered.resolve();
				await release.promise;
			}
			return { action: "text", text };
		},
	});
	let pending: Promise<unknown> | undefined;
	try {
		const host = await f.start(),
			user = host.connect("user", ["input.submit"]);
		pending = user.submit({ key: "old", text: "OLD" });
		await entered.promise;
		await host.newSession();
		await assert.doesNotReject(async () => {
			await user.submit({ key: "new", text: "FRESH" });
		});
		await host.waitForIdle();
		assert.match(text(f.requests[0]), /FRESH/);
		release.resolve();
		const old = (await pending) as { state: string };
		assert.equal(old.state, "released");
		assert.equal(f.requests.length, 1);
	} finally {
		release.resolve();
		await pending;
		await f.close();
	}
});
