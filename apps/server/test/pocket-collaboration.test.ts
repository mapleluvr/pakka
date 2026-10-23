import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime } from "@pakka/agent";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";
import { createPocketCollaboration } from "../src/pocket-collaboration.ts";

async function setup() {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "collab.people" });
		const session = await people.initializeOwner("Owner"),
			owner = await people.authenticate(session.token);
		let now = Date.now();
		const collaboration = await createPocketCollaboration({
			runtime: m.runtime,
			people,
			namespace: "collab.shared",
			now: () => now,
		});
		const workspace = createPocketWorkspace({
			runtime: m.runtime,
			people,
			catalog: { namespace: "collab.workspace", maxDeliveries: 16, maxPending: 4 },
			profileCeiling: () => ["default"],
			beforeInput: (actor, ref) => collaboration.checkInput(actor, ref),
		});
		const client = workspace.bind(owner),
			ref = await client.create({ requestId: "main", name: "Shared project", profile: "default" }),
			hidden = await client.create({ requestId: "hidden", name: "Private project", profile: "default" });
		const invite = await people.invite(owner, {
			requestId: "guest",
			role: "driver",
			resources: [ref.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const guestSession = await people.redeem(invite.token, "Collaborator"),
			guest = await people.authenticate(guestSession.token);
		return {
			m,
			people,
			owner,
			session,
			guest,
			guestSession,
			workspace,
			client,
			ref,
			hidden,
			collaboration,
			setNow: (value: number) => {
				now = value;
			},
			now,
		};
	} catch (error) {
		await m.close();
		throw error;
	}
}

test("WebUI collaboration: real shared attribution, concurrent note conflict, pins/reactions/quote and no human content in model payload", async () => {
	const f = await setup();
	try {
		const owner = f.collaboration.bind(f.owner),
			guest = f.collaboration.bind(f.guest);
		const message = await owner.post(f.ref, {
			requestId: "chat",
			text: "HUMAN-ONLY-CANARY",
			mentions: [f.guest.person.id],
		});
		assert.equal(
			(
				await owner.post(f.ref, {
					requestId: "chat",
					text: "HUMAN-ONLY-CANARY",
					mentions: [f.guest.person.id],
				})
			).id,
			message.id,
		);
		await assert.rejects(owner.post(f.ref, { requestId: "chat", text: "conflicting" }), /conflict/i);
		const reply = await guest.post(f.ref, {
			requestId: "reply",
			text: "HUMAN-SIDE-REPLY",
			quoteId: message.id,
		});
		assert.equal(reply.authorId, f.guest.person.id);
		await guest.react(f.ref, { messageId: message.id, emoji: "👍", active: true });
		await owner.pin(f.ref, { messageId: message.id, pinned: true });
		const edits = await Promise.allSettled([
			owner.editNote(f.ref, { expectedVersion: 0, text: "PRIVATE-NOTE-ONE" }),
			guest.editNote(f.ref, { expectedVersion: 0, text: "PRIVATE-NOTE-TWO" }),
		]);
		assert.equal(edits.filter((result) => result.status === "fulfilled").length, 1);
		assert.equal(edits.filter((result) => result.status === "rejected").length, 1);
		const view = await guest.snapshot(f.ref);
		assert.equal(view.messages.length, 2);
		assert.equal(view.messages[0]!.authorId, f.owner.person.id);
		assert.equal(view.messages[0]!.pinned, true);
		assert.deepEqual(view.messages[0]!.reactions, [{ emoji: "👍", people: [f.guest.person.id] }]);
		assert.equal(view.messages[1]!.quoteId, message.id);
		assert.equal(view.note.version, 1);
		assert.equal(
			view.note.authorId,
			edits[0]!.status === "fulfilled" ? f.owner.person.id : f.guest.person.id,
		);
		assert.equal(Object.isFrozen(view), true);
		assert.equal(f.m.f.requests.length, 0);
		assert.equal(
			(
				await f.client.wait(
					(
						await f.client.submit(f.ref, {
							requestId: "explicit",
							text: "EXPLICIT-MODEL-WORK",
							mode: "prompt",
						})
					).id,
				)
			).status,
			"done",
		);
		assert.equal(f.m.f.requests.length, 1);
		assert.doesNotMatch(JSON.stringify(f.m.f.requests), /HUMAN-ONLY-CANARY|HUMAN-SIDE-REPLY|PRIVATE-NOTE/);
		assert.deepEqual(f.m.f.errors, []);
	} finally {
		await f.m.close();
	}
});

test("WebUI collaboration: viewer participation is human-only, presence is ephemeral and resource/identity scopes are checked before publication", async () => {
	const f = await setup();
	try {
		const invite = await f.people.invite(f.owner, {
			requestId: "viewer",
			role: "viewer",
			resources: [f.ref.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invite.token);
		const viewerSession = await f.people.redeem(invite.token, "Viewer"),
			viewer = await f.people.authenticate(viewerSession.token),
			bound = f.collaboration.bind(viewer);
		await bound.post(f.ref, { requestId: "human-only", text: "VIEWER-SIDE-CHAT" });
		await bound.presence(f.ref, { state: "typing" });
		assert.equal(
			(await f.collaboration.bind(f.owner).snapshot(f.ref)).presence[0]!.personId,
			viewer.person.id,
		);
		await assert.rejects(bound.snapshot(f.hidden), /denied|scope/i);
		await assert.rejects(bound.editNote(f.ref, { expectedVersion: 0, text: "forbidden" }), /denied/i);
		await assert.rejects(
			bound.setDriver(f.ref, { expectedVersion: 0, action: "claim", ttlMs: 60000 }),
			/denied/i,
		);
		assert.throws(() => f.collaboration.bind({ ...viewer }), /denied|authority/i);
		await f.people.revokePerson(f.owner, viewer.person.id);
		assert.equal((await f.collaboration.bind(f.owner).snapshot(f.ref)).presence.length, 0);
		await assert.rejects(bound.snapshot(f.ref), /denied|authority/i);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});

test("WebUI collaboration: real driver CAS controls native input and an expired lease during admission has zero provider effects", async () => {
	const f = await setup();
	try {
		const owner = f.collaboration.bind(f.owner),
			guest = f.collaboration.bind(f.guest);
		const claimed = await owner.setDriver(f.ref, { expectedVersion: 0, action: "claim", ttlMs: 1000 });
		assert.equal(claimed.personId, f.owner.person.id);
		await assert.rejects(
			f.workspace
				.bind(f.guest)
				.submit(f.ref, { requestId: "not-driver", text: "NO-NATIVE-EFFECT", mode: "prompt" }),
			/driver|denied/i,
		);
		await assert.rejects(
			guest.setDriver(f.ref, { expectedVersion: claimed.version, action: "claim", ttlMs: 1000 }),
			/driver|conflict/i,
		);
		await owner.setDriver(f.ref, { expectedVersion: claimed.version, action: "release" });
		const next = await guest.setDriver(f.ref, {
			expectedVersion: claimed.version + 1,
			action: "claim",
			ttlMs: 1000,
		});
		assert.equal(next.personId, f.guest.person.id);
		let boundaries = 0;
		const late = createPocketWorkspace({
			runtime: f.m.runtime,
			people: f.people,
			catalog: { namespace: "collab.workspace", maxDeliveries: 16, maxPending: 4 },
			profileCeiling: () => ["default"],
			beforeInput: (actor, ref) => {
				f.collaboration.checkInput(actor, ref);
				if (++boundaries === 1) f.setNow(f.now + 2000);
			},
		});
		await assert.rejects(
			late
				.bind(f.guest)
				.submit(f.ref, { requestId: "expired-boundary", text: "MUST-NOT-REACH-PROVIDER", mode: "prompt" }),
			/driver|denied|expired/i,
		);
		assert.ok(boundaries >= 1);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});

test("WebUI collaboration: durable records/driver reopen with the original writer while presence is not restored", async () => {
	const f = await setup();
	let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const bound = f.collaboration.bind(f.owner);
		await bound.post(f.ref, { requestId: "kept", text: "KEEP-ATTRIBUTION" });
		await bound.editNote(f.ref, { expectedVersion: 0, text: "KEEP-NOTE" });
		await bound.setDriver(f.ref, { expectedVersion: 0, action: "claim", ttlMs: 60000 });
		await bound.presence(f.ref, { state: "here" });
		const sessionFile = f.m.runtime.view().sessionFile;
		await f.m.runtime.close();
		runtime = await createRuntime({ ...f.m.config, reopenSessionFile: sessionFile });
		const people = await createPocketPeople({ runtime, namespace: "collab.people" }),
			actor = await people.authenticate(f.session.token),
			collaboration = await createPocketCollaboration({
				runtime,
				people,
				namespace: "collab.shared",
				now: () => f.now,
			});
		const view = await collaboration.bind(actor).snapshot(f.ref);
		assert.equal(view.messages[0]!.authorId, actor.person.id);
		assert.equal(view.note.text, "KEEP-NOTE");
		assert.equal(view.driver.personId, actor.person.id);
		assert.deepEqual(view.presence, []);
		assert.throws(() => f.collaboration.checkInput(f.owner, f.ref), /unavailable|closed|denied/i);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await runtime?.close();
		await f.m.close();
	}
});
