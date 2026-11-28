import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.ts";
import { binding } from "./strategy-fixture.ts";

// More than one native page, using the real SDK and a local deterministic HTTP provider.
test(
	"paged history remains complete and duplicate-free across tail growth, reload and reopen",
	{ timeout: 120000 },
	async () => {
		const f = await fixture({}, async () => ({ text: "FIXED-HISTORY-ANSWER" }));
		try {
			let host = await f.start();
			const user = host.connect("user", ["input.submit"]);
			for (let i = 0; i < 130; i++) {
				const receipt = await user.submit({ key: "history-" + i, text: "HISTORY-INPUT-" + i + ":END" });
				await host.waitForIdle();
				assert.equal(f.requests.length, i + 1, "each history seed must reach the real local provider");
				assert.equal(user.receipt(receipt.id)?.state, "committed");
				assert.equal(
					user.receipt(receipt.id)?.generation,
					undefined,
					"history seeds must complete without a failed generation",
				);
			}
			let reader = 0;
			const frame = () => {
				const owner = host.connect("reader-" + ++reader, ["context_artifacts.write"]);
				const id = "history-strategy-" + reader;
				owner.activateStrategy({ id, hooks: ["context_artifacts.write"] });
				return binding(owner, id).readFrame();
			};
			const original = frame();
			assert.ok(original.entries.length > 256, "the fixture must actually cross the native page boundary");
			const ids = original.entries.map((entry) => entry.id);
			assert.equal(new Set(ids).size, ids.length);
			const stored = JSON.stringify(original.entries);
			for (let i = 0; i < 130; i++) assert.ok(stored.includes("HISTORY-INPUT-" + i + ":END"));
			await user.submit({ key: "tail", text: "HISTORY-TAIL" });
			await host.waitForIdle();
			const tail = frame().entries.map((entry) => entry.id);
			assert.deepEqual(tail.slice(0, ids.length), ids);
			assert.ok(tail.length > ids.length);
			assert.equal(new Set(tail).size, tail.length);
			await host.reload();
			assert.deepEqual(
				frame().entries.map((entry) => entry.id),
				tail,
			);
			const file = host.view().sessionFile;
			await host.dispose();
			host = await f.start({ reopenSessionFile: file });
			assert.deepEqual(
				frame().entries.map((entry) => entry.id),
				tail,
			);
			assert.equal(f.requests.length, 131, "cold reads must not generate or replay model requests");
			assert.equal(f.errors.length, 0);
		} finally {
			await f.close();
		}
	},
);
