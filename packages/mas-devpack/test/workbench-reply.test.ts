import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMas } from "@pakka/mas";
import { createPocketPeople, type PocketAuthority } from "@pakka/server/pocket";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { text } from "../../agent/test/fixture.ts";
import { masAgentPrincipal } from "../src/ownership.ts";
import { createMasWorkbench, type WorkbenchAuthority } from "../src/workbench.ts";

// Reply must be tied to a real incoming native receipt; neither a selected member nor a copied ID grants peer access.
test(
	"Human MAS reply: real incoming receipt, scoped peer checks and stable retry with no duplicate HTTP",
	{ timeout: 15000 },
	async () => {
		const m = await runtimeFixture();
		try {
			const people = await createPocketPeople({ runtime: m.runtime, namespace: "reply.people" }),
				session = await people.initializeOwner("Owner"),
				owner = await people.authenticate(session.token);
			const mas = await createMas({
				runtime: m.runtime,
				namespace: "reply.team",
				maxDeliveries: 16,
				maxPending: 4,
			});
			await mas.bootstrap([
				{ key: "a", owner: session.person.id },
				{ key: "b", owner: session.person.id },
			]);
			await mas.activate();
			const [a, b] = (await mas.view()).members;
			const fromA = mas.connect({
				principal: masAgentPrincipal(a!.ref),
				source: a!.ref,
				grants: ["send", "observe"],
			});
			const incoming = await fromA.send(b!.ref, { requestId: "peer-original", text: "REAL-PEER-INPUT" });
			await fromA.wait(incoming.id);
			const authority = (actor: PocketAuthority): WorkbenchAuthority => ({
				id: people.current(actor).id,
				current: () => {
					people.current(actor);
				},
				check: (permission, ref) => people.check(actor, permission, ref.conversationId),
			});
			const workbench = createMasWorkbench({ mas, runtime: m.runtime }),
				board = workbench.bind(authority(owner));
			const inbox = await board.inbox(b!.ref);
			assert.equal(inbox.length, 1);
			assert.equal(inbox[0]!.id, incoming.id);
			await assert.rejects(
				board.reply(a!.ref, incoming.id, { requestId: "outgoing-not-incoming", text: "DENIED" }),
			);
			assert.equal(m.f.requests.length, 1);
			const invite = await people.invite(owner, {
				requestId: "limited",
				role: "sender",
				resources: [b!.ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const limited = workbench.bind(
				authority(await people.authenticate((await people.redeem(invite.token, "Sender")).token)),
			);
			assert.deepEqual(await limited.inbox(b!.ref), []);
			await assert.rejects(limited.reply(b!.ref, incoming.id, { requestId: "hidden-peer", text: "DENIED" }));
			assert.equal(m.f.requests.length, 1);
			const replied = await board.reply(b!.ref, incoming.id, {
				requestId: "human-reply",
				text: "REAL-HUMAN-REPLY",
			});
			assert.equal((await board.wait(replied.id, undefined, b!.ref)).status, "done");
			assert.equal(
				(await board.reply(b!.ref, incoming.id, { requestId: "human-reply", text: "REAL-HUMAN-REPLY" })).id,
				replied.id,
			);
			assert.equal(m.f.requests.length, 2);
			assert.match(text(m.f.requests[1]!), /REAL-HUMAN-REPLY/);
			assert.equal((await board.receipt(replied.id, b!.ref)).status, "done");
			assert.deepEqual(m.f.errors, []);
		} finally {
			await m.close();
		}
	},
);
