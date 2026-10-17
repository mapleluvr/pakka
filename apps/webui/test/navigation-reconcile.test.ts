import { test } from "node:test";
import { strict as assert } from "node:assert";
import { fixture } from "./fixture.ts";

test("Pocket original-operation lookup is read-only: absent and committed metadata/create/fork never re-enter a mutation", async () => {
	const m = await fixture();
	try {
		const catalog = m.runtime.catalog({ namespace: "pocket", maxDeliveries: 32, maxPending: 8 });
		const metadata = {
			op: "conversation.set",
			target: m.ref,
			input: { requestId: "lost-metadata", expectedVersion: 0, name: "Original name", archived: true },
		};
		const initialVersion = (await catalog.snapshot()).version;
		const absent = await m.rpc({ op: "conversation.lookup", original: metadata });
		assert.equal(absent.response.status, 200);
		assert.ok("result" in absent.decoded && absent.decoded.result.kind === "conversation.operation");
		assert.equal(absent.decoded.result.result, null);
		assert.equal((await catalog.snapshot()).version, initialVersion);
		const committed = await m.rpc(metadata);
		assert.ok("result" in committed.decoded && committed.decoded.result.kind === "metadata");
		const afterMetadata = (await catalog.snapshot()).version;
		const recovered = await m.rpc({ op: "conversation.lookup", original: metadata });
		assert.ok("result" in recovered.decoded && recovered.decoded.result.kind === "conversation.operation");
		assert.deepEqual(recovered.decoded.result.result, committed.decoded.result.metadata);
		assert.equal((await catalog.snapshot()).version, afterMetadata);
		const create = {
			op: "create",
			requestId: "lost-creation",
			name: "Original creation",
			profile: "default",
		};
		const beforeCreate = await m.rpc({ op: "conversation.lookup", original: create });
		assert.ok(
			"result" in beforeCreate.decoded && beforeCreate.decoded.result.kind === "conversation.operation",
		);
		assert.equal(beforeCreate.decoded.result.result, null);
		assert.equal((await m.client.list()).length, 1);
		const created = await m.rpc(create);
		assert.ok("result" in created.decoded && created.decoded.result.kind === "reference");
		const readCreation = await m.rpc({ op: "conversation.lookup", original: create });
		assert.ok(
			"result" in readCreation.decoded && readCreation.decoded.result.kind === "conversation.operation",
		);
		assert.deepEqual(readCreation.decoded.result.result, created.decoded.result.ref);
		const display = await m.client.display(m.ref, { requestId: "anchor", kind: "card", text: "Fork anchor" });
		const fork = {
			op: "fork",
			target: m.ref,
			requestId: "lost-fork",
			name: "Original fork",
			profile: "default",
			entryId: display.entryId,
		};
		const beforeFork = await m.rpc({ op: "conversation.lookup", original: fork });
		assert.ok("result" in beforeFork.decoded && beforeFork.decoded.result.kind === "conversation.operation");
		assert.equal(beforeFork.decoded.result.result, null);
		assert.equal((await m.client.list()).length, 2);
		const forked = await m.rpc(fork);
		assert.ok("result" in forked.decoded && forked.decoded.result.kind === "reference");
		const afterFork = (await catalog.snapshot()).version;
		const lookup = await m.rpc({ op: "conversation.lookup", original: fork });
		assert.ok("result" in lookup.decoded && lookup.decoded.result.kind === "conversation.operation");
		assert.deepEqual(lookup.decoded.result.result, forked.decoded.result.ref);
		assert.equal((await catalog.snapshot()).version, afterFork);
		assert.equal((await m.client.list()).length, 3);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
