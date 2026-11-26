import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";

const check = () => {};
test("committed artifact feed fixes its upper bound, returns exact versions and survives passive Runtime reopen", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		assert.equal(typeof m.runtime.artifactHistory, "function", "Passive artifact history port missing");
		const owner = m.runtime.root().connect("writer", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const binding = owner.bindStrategy("strategy");
		for (let version = 0; version < 5; version++) {
			const receipt = await binding.artifacts.append(binding.readFrame().basis, {
				expectedVersion: version,
				transactionId: `batch-${version}`,
				records: [
					{ kind: "block", id: "block-" + version, text: "old-" + version },
					{ kind: "run", id: "run-" + version },
				],
			});
			assert.equal(receipt.status, "committed");
		}
		const ref = m.runtime.view().conversations[0]!;
		const history = m.runtime.artifactHistory(ref, "strategy", check);
		const first = await history.page({ limit: 3, maxBytes: 4096 });
		assert.equal(first.items.length, 3);
		assert.equal(first.through, 5);
		assert.ok(first.cursor);
		assert.equal(first.items[0]!.ref.version, 1);
		assert.ok(!JSON.stringify(first).includes("old-0"), "metadata pages do not publish artifact bodies");
		assert.deepEqual(await history.read(first.items[0]!.ref), {
			kind: "block",
			id: "block-0",
			text: "old-0",
		});
		await binding.artifacts.append(binding.readFrame().basis, {
			expectedVersion: 5,
			records: [{ kind: "block", id: "late", text: "late" }],
		});
		let page = first,
			count = first.items.length;
		while (page.cursor) {
			page = await history.page({ cursor: page.cursor, limit: 3 });
			count += page.items.length;
		}
		assert.equal(count, 10);
		assert.equal(await history.head(), 6);
		const file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, observation: "lazy", reopenSessionFile: file });
		const after = reopened.artifactHistory(reopened.view().conversations[0]!, "strategy", check);
		assert.deepEqual(await after.read(first.items[0]!.ref), { kind: "block", id: "block-0", text: "old-0" });
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

test("artifact read capabilities check current authority and reject foreign or changed content references", async () => {
	const m = await runtimeFixture();
	try {
		assert.equal(typeof m.runtime.artifactHistory, "function", "Passive artifact history port missing");
		const owner = m.runtime.root().connect("writer", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "strategy", hooks: ["context_artifacts.write"] });
		const binding = owner.bindStrategy("strategy");
		await binding.artifacts.append(binding.readFrame().basis, {
			expectedVersion: 0,
			records: [{ kind: "block", text: "private" }],
		});
		let allowed = true;
		const ref = m.runtime.view().conversations[0]!;
		const history = m.runtime.artifactHistory(ref, "strategy", () => {
			if (!allowed) throw Error("revoked");
		});
		const first = await history.page({});
		await assert.rejects(
			history.read({ ...first.items[0]!.ref, digest: "0".repeat(64) }),
			/reference|version|digest/i,
		);
		const foreign = m.runtime.artifactHistory(ref, "other", check);
		await assert.rejects(foreign.page({ cursor: first.startCursor! }), /cursor|scope/i);
		allowed = false;
		await assert.rejects(history.read(first.items[0]!.ref), /revoked|authority/i);
		assert.equal(m.runtime.view().phase, "ready");
	} finally {
		await m.close();
	}
});
