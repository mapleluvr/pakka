import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime } from "../../../packages/agent/src/index.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";

const catalog = { namespace: "pocket-workbench", maxDeliveries: 32, maxPending: 8 };
const ceiling = () => ["default"];

// Another person with access to the same resource still cannot claim the original person's input receipt.
test("Pocket workspace: shared resource does not share message authority or allow forged actor/request fields", async () => {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "people" });
		const session = await people.initializeOwner("Owner"),
			admin = await people.authenticate(session.token);
		const workspace = createPocketWorkspace({ runtime: m.runtime, people, catalog, profileCeiling: ceiling });
		const owner = workspace.bind(admin),
			ref = await owner.create({ requestId: "one", name: "Work", profile: "default" });
		const invite = await people.invite(admin, {
			requestId: "sender",
			role: "sender",
			resources: [ref.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const visitorSession = await people.redeem(invite.token, "Visitor"),
			actor = await people.authenticate(visitorSession.token),
			visitor = workspace.bind(actor);
		const admitted = await owner.submit(ref, { requestId: "private", text: "OWNER-INPUT", mode: "prompt" });
		await owner.wait(admitted.id);
		for (const operation of [
			() => visitor.receipt(admitted.id),
			() => visitor.wait(admitted.id),
			() => visitor.withdraw(admitted.id),
		])
			await assert.rejects(operation(), /denied/i);
		await assert.rejects(
			visitor.display(ref, {
				requestId: "fake",
				kind: "chat",
				text: "Pretend owner",
				...{ actorId: admin.person.id },
			}),
			/input|field/i,
		);
		await assert.rejects(
			visitor.submit(ref, {
				requestId: "fake",
				text: "Pretend owner",
				mode: "prompt",
				...{ actorId: admin.person.id },
			}),
			/input|field/i,
		);
		await assert.rejects(
			visitor.submit(ref, { requestId: "steer", text: "Steer", mode: "steer" }),
			/denied/i,
		);
		assert.equal(m.f.requests.length, 1);
	} finally {
		await m.close();
	}
});

// Re-bootstrap must reuse the committed resource, original message and spent primary quota.
test("Pocket workspace: normal reopen reattaches original creation/admission without allocating or dispatching again", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		let people = await createPocketPeople({ runtime: m.runtime, namespace: "people" });
		const session = await people.initializeOwner("Owner");
		let actor = await people.authenticate(session.token);
		let client = createPocketWorkspace({ runtime: m.runtime, people, catalog, profileCeiling: ceiling }).bind(
			actor,
		);
		const spec = { requestId: "same-work", name: "Work", profile: "default" },
			ref = await client.create(spec);
		const input = { requestId: "same-input", text: "ONE-NATIVE-INPUT", mode: "prompt" as const };
		const receipt = await client.submit(ref, input);
		await client.wait(receipt.id);
		await client.display(ref, { requestId: "card", kind: "card", text: "HUMAN-DISPLAY-ONLY" });
		const file = m.runtime.view().sessionFile,
			budget = m.runtime.view().budget.primaryAttempts;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		people = await createPocketPeople({ runtime: reopened, namespace: "people" });
		actor = await people.authenticate(session.token);
		client = createPocketWorkspace({ runtime: reopened, people, catalog, profileCeiling: ceiling }).bind(
			actor,
		);
		assert.deepEqual(await client.create(spec), ref);
		assert.equal((await client.submit(ref, input)).id, receipt.id);
		assert.equal((await client.receipt(receipt.id)).status, "done");
		assert.equal((await client.list()).length, 1);
		assert.equal(
			(await client.read(ref)).entries.filter((e) => e.display?.text === "HUMAN-DISPLAY-ONLY").length,
			1,
		);
		assert.equal(reopened.view().budget.primaryAttempts, budget);
		assert.equal(m.f.requests.length, 1);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

// UI wait cancellation must not be confused with withdrawing queued input or stopping model work.
test("Pocket workspace: cancelled receipt wait preserves native delivery and an explicit follow-up", async () => {
	const entered = deferred(),
		release = deferred();
	const m = await runtimeFixture({}, undefined, async (_request, index) => {
		if (index === 1) {
			entered.resolve();
			await release.promise;
		}
		return { text: "done" };
	});
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "people" });
		const actor = await people.authenticate((await people.initializeOwner("Owner")).token);
		const client = createPocketWorkspace({
				runtime: m.runtime,
				people,
				catalog,
				profileCeiling: ceiling,
			}).bind(actor),
			ref = await client.create({ requestId: "work", name: "Work", profile: "default" });
		const receipt = await client.submit(ref, { requestId: "first", text: "BUSY-WORK", mode: "prompt" });
		await entered.promise;
		const follow = await client.submit(ref, {
			requestId: "second",
			text: "NATIVE-FOLLOW-UP",
			mode: "followUp",
		});
		assert.equal(follow.status, "queued");
		const controller = new AbortController(),
			wait = client.wait(receipt.id, controller.signal);
		controller.abort(new Error("BROWSER-LEFT"));
		await assert.rejects(wait, /BROWSER-LEFT/);
		assert.equal((await client.receipt(follow.id)).status, "queued");
		release.resolve();
		assert.equal((await client.wait(follow.id)).status, "done");
		assert.equal(m.f.requests.length, 2);
	} finally {
		release.resolve();
		await m.close();
	}
});
