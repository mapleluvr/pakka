import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deferred, fixture } from "./fixture.ts";

test("explicit generation block persists a committed input without HTTP and leaves the host reusable", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const owner = host.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "guard", hooks: ["real_context.write"] });
		const binding = owner.bindStrategy("guard");
		const remove = binding.installProjector((frame) => ({
			status: "blocked",
			basis: frame.basis,
			reason: "policy denied",
		}));
		const user = host.connect("user", ["input.submit"]);
		const submitted = await user.submit({ key: "blocked", text: "BLOCKED-INPUT" });
		await host.waitForIdle();
		const receipt = user.receipt(submitted.id)!;
		assert.equal(receipt.state, "committed");
		assert.deepEqual(receipt.generation, { status: "blocked", reason: "policy denied" });
		assert.equal(host.view().phase, "ready");
		assert.equal(host.view().busy, false);
		assert.equal(f.requests.length, 0);
		assert.ok(host.view().context.some((entry) => entry.text.includes("BLOCKED-INPUT")));
		const storage = await readFile(host.view().sessionFile, "utf8");
		assert.match(storage, /"reason":"blocked"/);
		assert.doesNotMatch(storage, /"reason":"faulted"/);
		assert.doesNotMatch(storage, /"kind":"pi.assistant"/);
		const duplicate = await user.submit({ key: "blocked", text: "BLOCKED-INPUT" });
		assert.equal(duplicate.id, submitted.id);
		assert.equal(f.requests.length, 0);
		remove();
		await user.submit({ key: "next", text: "ALLOWED-INPUT" });
		await host.waitForIdle();
		assert.equal(f.requests.length, 1);
		assert.equal(host.view().phase, "ready");
	} finally {
		await f.close();
	}
});

test(
	"blocking a post-tool generation settles placed steering inputs without another HTTP call",
	{ timeout: 15000 },
	async () => {
		const entered = deferred(),
			release = deferred();
		const f = await fixture(
			{
				tools: [
					{
						name: "gate",
						description: "block while a tool is running",
						parameters: { type: "object", properties: {} },
						execute: async () => {
							entered.resolve();
							await release.promise;
							return "TOOL-RESULT";
						},
					},
				],
			},
			() => ({ tool: "gate" }),
		);
		try {
			const host = await f.start(),
				user = host.connect("user", ["input.submit"]);
			const owner = host.connect("owner", ["real_context.write"]);
			owner.activateStrategy({ id: "guard", hooks: ["real_context.write"] });
			const binding = owner.bindStrategy("guard");
			binding.installProjector((frame) =>
				frame.projection.some((entry) => entry.messages.some((message) => message.role === "toolResult"))
					? { status: "blocked", basis: frame.basis, reason: "post-tool denied" }
					: { status: "disabled", basis: frame.basis },
			);
			const initial = await user.submit({ key: "initial", text: "INITIAL" });
			await Promise.race([
				entered.promise,
				host.waitForIdle().then(() => assert.fail("tool gate not reached")),
			]);
			const steering = await user.submit({ key: "steering", text: "STEERING", mode: "steer" });
			release.resolve();
			await host.waitForIdle();
			for (const receipt of [initial, steering]) {
				assert.equal(user.receipt(receipt.id)?.state, "committed");
				assert.deepEqual(user.receipt(receipt.id)?.generation, {
					status: "blocked",
					reason: "post-tool denied",
				});
			}
			assert.equal(host.view().phase, "ready");
			assert.equal(f.requests.length, 1);
		} finally {
			release.resolve();
			await f.close();
		}
	},
);

test("a blocked generation remains settled after close and reopen without hidden replay", async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		const owner = host.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "guard", hooks: ["real_context.write"] });
		owner.bindStrategy("guard").installProjector((frame) => ({
			status: "blocked",
			basis: frame.basis,
			reason: "persisted refusal",
		}));
		await host.connect("user", ["input.submit"]).submit({ key: "blocked", text: "PERSISTED-INPUT" });
		await host.waitForIdle();
		const file = host.view().sessionFile;
		await host.dispose();
		const reopened = await f.start({ reopenSessionFile: file });
		await reopened.waitForIdle();
		assert.equal(f.requests.length, 0);
		assert.equal(reopened.view().phase, "ready");
		assert.ok(reopened.view().context.some((entry) => entry.text.includes("PERSISTED-INPUT")));
		await reopened.connect("user", ["input.submit"]).submit({ key: "new", text: "AFTER-REOPEN" });
		await reopened.waitForIdle();
		assert.equal(f.requests.length, 1);
	} finally {
		await f.close();
	}
});
