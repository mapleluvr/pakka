import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMas } from "@pakka/mas";
import { createPocketPeople, type PocketAuthority } from "@pakka/server/pocket";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createMasWorkbench, type WorkbenchAuthority } from "../src/workbench.ts";
import { deferred } from "../../agent/test/fixture.ts";

// Removing the identity-bound check inside native admission would deliver after the human lease was revoked.
test(
	"MAS human workbench: revocation while admission waits produces zero target HTTP",
	{ timeout: 15000 },
	async () => {
		const m = await runtimeFixture(),
			entered = deferred(),
			release = deferred();
		try {
			const people = await createPocketPeople({ runtime: m.runtime, namespace: "late.people" }),
				ownerSession = await people.initializeOwner("Owner"),
				owner = await people.authenticate(ownerSession.token);
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "late.team",
				maxDeliveries: 8,
				maxPending: 2,
			});
			await mas.bootstrap([{ key: "target", owner: ownerSession.person.id }]);
			await mas.activate();
			const member = (await mas.view()).members[0]!;
			const invite = await people.invite(owner, {
				requestId: "sender",
				role: "sender",
				resources: [member.ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const senderSession = await people.redeem(invite.token, "Sender"),
				sender = await people.authenticate(senderSession.token);
			const board = createMasWorkbench({ mas, runtime: m.runtime }).bind({
				id: senderSession.person.id,
				current: () => {
					people.current(sender);
				},
				check: (permission, ref) => people.check(sender, permission, ref.conversationId),
			});
			mas.setAdmission(async () => {
				entered.resolve();
				await release.promise;
				return true;
			});
			const pending = board.send(member.ref, { requestId: "late", text: "MUST-NOT-DELIVER" });
			const rejected = assert.rejects(pending);
			await entered.promise;
			await people.revokePerson(owner, senderSession.person.id);
			release.resolve();
			await rejected;
			await m.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 0);
		} finally {
			release.resolve();
			await m.close();
		}
	},
);

test("MAS human workbench: scoped readers see only approved members and cannot deliver or manage", async () => {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "board.people" }),
			session = await people.initializeOwner("Owner"),
			actor = await people.authenticate(session.token);
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "board.mas",
			maxDeliveries: 16,
			maxPending: 4,
		});
		await mas.bootstrap([
			{ key: "visible", owner: session.person.id },
			{ key: "PRIVATE-TEAM-CANARY", owner: session.person.id },
		]);
		await mas.activate();
		const members = (await mas.view()).members,
			visible = members[0]!,
			hidden = members[1]!;
		const authority = (who: PocketAuthority): WorkbenchAuthority => ({
			id: people.current(who).id,
			current: () => {
				people.current(who);
			},
			check: (permission, ref) => people.check(who, permission, ref?.conversationId),
		});
		const workbench = createMasWorkbench({ mas, runtime: m.runtime }),
			owner = workbench.bind(authority(actor));
		const invitation = await people.invite(actor, {
			requestId: "reader",
			role: "viewer",
			resources: [visible.ref.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invitation.token);
		const viewerActor = await people.authenticate((await people.redeem(invitation.token, "Viewer")).token),
			viewer = workbench.bind(authority(viewerActor));
		const result = await viewer.view();
		assert.equal(
			result.sessionId,
			m.runtime.view().sessionId,
			"Board view identity comes from its bound Session",
		);
		assert.equal(result.members.length, 1);
		assert.equal(result.members[0]!.key, "visible");
		assert.equal(JSON.stringify(result).includes("PRIVATE-TEAM-CANARY"), false);
		assert.ok(Object.isFrozen(result));
		await assert.rejects(viewer.send(visible.ref, { requestId: "denied", text: "DENIED" }));
		await assert.rejects(viewer.retire(visible.ref));
		await assert.rejects(viewer.inspect(hidden.ref));
		assert.equal(m.f.requests.length, 0);
		const sent = await owner.send(visible.ref, { requestId: "native", text: "NATIVE-BOARD-INPUT" });
		assert.equal((await owner.wait(sent.id)).status, "done");
		assert.equal(m.f.requests.length, 1);
		await assert.rejects(viewer.receipt(sent.id));
		await people.revokePerson(actor, viewerActor.person.id);
		await assert.rejects(viewer.view());
		assert.equal(m.f.requests.length, 1);
	} finally {
		await m.close();
	}
});

test("MAS human workbench: management keeps owner authority separate from communication", async () => {
	const m = await runtimeFixture();
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "owner.people" }),
			session = await people.initializeOwner("Owner"),
			actor = await people.authenticate(session.token);
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "owner.mas",
			maxDeliveries: 16,
			maxPending: 4,
		});
		await mas.bootstrap([
			{ key: "owned", owner: session.person.id },
			{ key: "foreign-owner", owner: "another-real-owner" },
		]);
		await mas.activate();
		const [owned, foreign] = (await mas.view()).members,
			board = createMasWorkbench({ mas, runtime: m.runtime }).bind({
				id: session.person.id,
				current: () => {
					people.current(actor);
				},
				check: (permission, ref) => people.check(actor, permission, ref?.conversationId),
			});
		await assert.rejects(board.retire(foreign!.ref));
		assert.equal((await board.inspect(foreign!.ref)).phase, "active");
		const receipt = await board.send(foreign!.ref, {
			requestId: "communicate",
			text: "AUTHORIZED-COMMUNICATION",
		});
		await board.wait(receipt.id);
		assert.equal((await board.retire(owned!.ref)).phase, "retired");
		await assert.rejects(board.send(owned!.ref, { requestId: "terminal", text: "DENIED" }));
		assert.equal(m.f.requests.length, 1);
	} finally {
		await m.close();
	}
});
