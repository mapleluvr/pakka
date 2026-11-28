import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";

const catalog = { namespace: "content-workbench", maxPending: 8 };

test("WebUI content: a child-only viewer can read inherited original bytes without learning or acquiring the parent resource", async () => {
	const m = await runtimeFixture({ observation: "lazy" });
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "content-people" });
		const login = await people.initializeOwner("Owner");
		const admin = await people.authenticate(login.token);
		const workspace = createPocketWorkspace({
			runtime: m.runtime,
			people,
			catalog,
			profileCeiling: () => ["default"],
		});
		const owner = workspace.bind(admin);
		const parent = await owner.create({ requestId: "parent", name: "Parent", profile: "default" });
		const text = "ORIGINAL-INHERITED-CONTENT\n" + "x".repeat(10000);
		const receipt = await owner.submit(parent, { requestId: "source", text, mode: "prompt" });
		const settled = await owner.wait(receipt.id);
		assert.equal(settled.status, "done");
		assert.ok(settled.entryId);
		const child = await owner.fork(parent, {
			requestId: "child",
			name: "Child",
			profile: "default",
			entryId: settled.entryId,
		});
		const invite = await people.invite(admin, {
			requestId: "viewer",
			role: "viewer",
			resources: [child.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const session = await people.redeem(invite.token, "Child viewer");
		const actor = await people.authenticate(session.token);
		const viewer = workspace.bind(actor);
		assert.equal(
			typeof viewer.preview,
			"function",
			"the browser projection needs its own authorized workspace port",
		);
		const page = await viewer.preview(child);
		const inherited = page.entries.find((row) => row.id === settled.entryId)!;
		assert.ok(inherited);
		assert.equal(inherited.sourceConversationId, undefined);
		const message = inherited.messages.find((row) => row.role === "user")!;
		const reference = message.contentReference;
		assert.ok(reference);
		assert.equal(
			reference.sourceConversationId,
			undefined,
			"a new body reference must not undo source-ID redaction",
		);
		const chunk = await viewer.readContent(child, reference, { offset: 0, length: 65536 });
		assert.equal(chunk.text, text);
		assert.equal(chunk.reference.sourceConversationId, undefined);
		await assert.rejects(viewer.preview(parent), /denied|scope/i);
		await assert.rejects(
			viewer.readContent(parent, reference, { offset: 0, length: 65536 }),
			/denied|scope/i,
		);
		const calls = m.f.requests.length;
		await people.revokePerson(admin, actor.person.id);
		await assert.rejects(viewer.readContent(child, reference, { offset: 0, length: 65536 }), /denied|scope/i);
		assert.equal(m.f.requests.length, calls, "a content read never resubmits model input");
	} finally {
		await m.close();
	}
});
