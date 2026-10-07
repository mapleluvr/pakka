import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture, raw, text } from "./fixture.ts";

test("construction isolates discovery and exposes no mutable runtime", { timeout: 15000 }, async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.cwd, ".pi/extensions"), { recursive: true });
		await writeFile(join(f.cwd, ".pi/extensions/poison.ts"), 'throw new Error("UNCONTROLLED DISCOVERY");');
		let host: Awaited<ReturnType<typeof f.start>>;
		await assert.doesNotReject(async () => {
			host = await f.start();
		});
		const client = host!.connect("reader", []);
		assert.equal(client.view().autoCompaction, false);
		assert.equal(Object.isFrozen(client), true);
		assert.equal(Object.isFrozen(client.view().context), true);
		for (const value of [host!, client, client.capture(), client.view()]) {
			for (const key of ["session", "agent", "sessionManager", "modelRuntime", "resourceLoader"])
				assert.equal(Reflect.get(value, key), undefined);
		}
		assert.throws(() => client.submit({ key: "forbidden", text: "BAD" }), /grant/);
	} finally {
		await f.close();
	}
});

test(
	"input identity deduplicates through real HTTP and physical persistence",
	{ timeout: 15000 },
	async () => {
		const f = await fixture();
		try {
			const host = await f.start(),
				client = host.connect("user", ["input.submit"]);
			const first = await client.submit({ key: "same-key", text: "ONE" });
			await host.waitForIdle();
			const again = await client.submit({ key: "same-key", text: "ONE" });
			assert.equal(again.id, first.id);
			assert.equal(again.state, "committed");
			assert.equal(f.requests.length, 1);
			assert.match(text(f.requests[0]), /ONE/);
			assert.match(await raw(host), new RegExp(again.entryId!));
			assert.equal(Object.isFrozen(again), true);
			await assert.rejects(async () => client.submit({ key: "same-key", text: "DIFFERENT" }), /conflict/);
		} finally {
			await f.close();
		}
	},
);

test(
	"host input transform and handled run before transfer, unsupported commands fail closed",
	{ timeout: 15000 },
	async () => {
		const f = await fixture({
			prepareInput: async ({ text }) =>
				text === "SKIP" ? { action: "handled" } : { action: "text", text: "PREPARED:" + text },
		});
		try {
			const host = await f.start(),
				client = host.connect("user", ["input.submit"]);
			assert.equal((await client.submit({ key: "handled", text: "SKIP" })).state, "handled");
			await client.submit({ key: "prepared", text: "HELLO" });
			await host.waitForIdle();
			assert.equal(f.requests.length, 1);
			assert.match(text(f.requests[0]), /PREPARED:HELLO/);
			await assert.rejects(async () => client.submit({ key: "skill", text: "/skill:any" }), /unsupported/);
		} finally {
			await f.close();
		}
	},
);
