import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntime } from "@pakka/agent";
import { hooksFixture, hookNamespace, signedBody } from "./pocket-hooks-fixture.ts";
import { createPocketHooks } from "../src/pocket-hooks.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";

// Replacing raw HMAC verification, re-entering admission, or publishing setup secrets must fail real provider/storage assertions.
test(
	"Pocket hooks: exact signed bytes admit one native input and changing unsigned delivery metadata cannot replay it",
	{ timeout: 12000 },
	async () => {
		const f = await hooksFixture();
		try {
			const client = f.hooks.bind(f.driver, f.target),
				created = await client.create({
					requestId: "signed",
					name: "Build finished",
					instructions: "Report this build.",
					signed: true,
					allowOutside: false,
				});
			assert.equal(created.state, "done");
			assert.ok(created.hook);
			const credentials = await client.credentials(created.hook.id);
			const bytes = Buffer.from(
				JSON.stringify({
					ref: "refs/heads/main",
					repository: { full_name: "example/project" },
					commits: [{ message: "LOCAL-BUILD-CANARY" }],
				}),
			);
			const input = { id: created.hook.id, headers: signedBody(credentials.secret, bytes), body: bytes };
			const received = await f.hooks.receive(input, () => {});
			assert.equal(received.state, "accepted");
			assert.ok(received.receipt);
			await f.m.runtime.waitForIdle();
			assert.equal(f.m.f.requests.length, 1);
			assert.ok(JSON.stringify(f.m.f.requests[0]).includes("LOCAL-BUILD-CANARY"));
			assert.ok(JSON.stringify(f.m.f.requests[0]).includes("webhook-payload"));
			const again = await f.hooks.receive(
				{ ...input, headers: signedBody(credentials.secret, bytes, "changed-delivery-header") },
				() => {},
			);
			assert.deepEqual(again, received);
			await f.m.runtime.waitForIdle();
			assert.equal(f.m.f.requests.length, 1);
			const native = await f.workspace.bind(f.driver).wait(received.receipt.id);
			assert.equal(native.status, "done");
			assert.equal(native.actorId, f.driverSession.person.id);
			for (const value of [
				await client.list(),
				await client.operation("signed"),
				await client.deliveries(created.hook.id),
				f.m.f.requests,
			])
				assert.equal(JSON.stringify(value).includes(credentials.secret), false);
			const bad = await f.hooks.receive({ ...input, body: Buffer.from("changed bytes") }, () => {});
			assert.equal(bad.state, "denied");
			assert.equal(f.m.f.requests.length, 1);
		} finally {
			await f.m.close();
		}
	},
);

test(
	"Pocket hooks: generic secret rotation and removal preserve original records while refusing old endpoints",
	{ timeout: 12000 },
	async () => {
		const f = await hooksFixture();
		try {
			const client = f.hooks.bind(f.driver, f.target),
				added = await client.create({
					requestId: "generic",
					name: "Deploy",
					instructions: "Describe the event.",
					signed: false,
					allowOutside: false,
				});
			assert.ok(added.hook);
			const original = await client.credentials(added.hook.id),
				body = Buffer.from("GENERIC-LOCAL-EVENT");
			assert.equal(
				(await f.hooks.receive({ id: original.id, secret: "forged", headers: {}, body }, () => {})).state,
				"denied",
			);
			const rotated = await client.rotate({
				requestId: "rotate",
				id: original.id,
				expectedVersion: original.version,
			});
			assert.ok(rotated.hook);
			assert.deepEqual(
				await client.rotate({ requestId: "rotate", id: original.id, expectedVersion: original.version }),
				rotated,
			);
			const current = await client.credentials(original.id);
			assert.notEqual(current.secret, original.secret);
			assert.equal(
				(await f.hooks.receive({ id: original.id, secret: original.secret, headers: {}, body }, () => {}))
					.state,
				"denied",
			);
			const result = await f.hooks.receive(
				{ id: original.id, secret: current.secret, headers: { "idempotency-key": "deploy-one" }, body },
				() => {},
			);
			assert.equal(result.state, "accepted");
			await f.m.runtime.waitForIdle();
			assert.equal(f.m.f.requests.length, 1);
			assert.equal(
				(
					await f.hooks.receive(
						{
							id: original.id,
							secret: current.secret,
							headers: { "idempotency-key": "deploy-one" },
							body: Buffer.from("conflicting"),
						},
						() => {},
					)
				).state,
				"conflict",
			);
			const removed = await client.remove({
				requestId: "remove",
				id: original.id,
				expectedVersion: current.version,
			});
			assert.equal(removed.state, "done");
			assert.equal(
				(
					await f.hooks.receive(
						{ id: original.id, secret: current.secret, headers: {}, body: Buffer.from("after removal") },
						() => {},
					)
				).state,
				"denied",
			);
			await f.m.runtime.waitForIdle();
			assert.equal(f.m.f.requests.length, 1);
			assert.equal((await client.deliveries(original.id)).length, 1);
		} finally {
			await f.m.close();
		}
	},
);

test(
	"Pocket hooks: signed outsider content is ignored by default even when the unsigned event header claims a push",
	{ timeout: 12000 },
	async () => {
		const f = await hooksFixture();
		try {
			const client = f.hooks.bind(f.driver, f.target),
				added = await client.create({
					requestId: "outside",
					name: "Issues",
					instructions: "Triage approved content.",
					signed: true,
					allowOutside: false,
				});
			assert.ok(added.hook);
			const credentials = await client.credentials(added.hook.id);
			const outside = Buffer.from(
				JSON.stringify({
					action: "opened",
					issue: {
						title: "OUTSIDER-TITLE",
						body: "OUTSIDER-BODY",
						author_association: "NONE",
						user: { login: "outside" },
					},
				}),
			);
			assert.equal(
				(
					await f.hooks.receive(
						{
							id: credentials.id,
							headers: signedBody(credentials.secret, outside, "outside-one", "push"),
							body: outside,
						},
						() => {},
					)
				).state,
				"ignored",
			);
			assert.equal(f.m.f.requests.length, 0);
			const allowed = Buffer.from(
				JSON.stringify({
					action: "created",
					comment: {
						body: "APPROVED-COMMENT",
						author_association: "MEMBER",
						user: { login: "approved-writer" },
					},
					issue: {
						title: "Issue",
						body: "HIDDEN-OUTSIDER-BODY",
						author_association: "NONE",
						user: { login: "outside" },
					},
				}),
			);
			assert.equal(
				(
					await f.hooks.receive(
						{
							id: credentials.id,
							headers: signedBody(credentials.secret, allowed, "comment-one", "issue_comment"),
							body: allowed,
						},
						() => {},
					)
				).state,
				"accepted",
			);
			await f.m.runtime.waitForIdle();
			assert.equal(f.m.f.requests.length, 1);
			assert.ok(JSON.stringify(f.m.f.requests[0]).includes("APPROVED-COMMENT"));
			assert.equal(JSON.stringify(f.m.f.requests[0]).includes("HIDDEN-OUTSIDER-BODY"), false);
		} finally {
			await f.m.close();
		}
	},
);

test(
	"Pocket hooks: normal writer reopen reconciles the original native delivery with retained creator scope and budget",
	{ timeout: 12000 },
	async () => {
		const f = await hooksFixture();
		let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
		try {
			const client = f.hooks.bind(f.driver, f.target),
				added = await client.create({
					requestId: "persist",
					name: "Persistent",
					instructions: "Review event.",
					signed: false,
					allowOutside: false,
				});
			assert.ok(added.hook);
			const credentials = await client.credentials(added.hook.id),
				input = {
					id: credentials.id,
					secret: credentials.secret,
					headers: { "idempotency-key": "original" },
					body: Buffer.from("BEFORE-REOPEN"),
				};
			const before = await f.hooks.receive(input, () => {});
			await f.m.runtime.waitForIdle();
			assert.equal(f.m.f.requests.length, 1);
			const sessionFile = f.m.runtime.view().sessionFile;
			await f.m.runtime.close();
			reopened = await createRuntime({ ...f.m.config, reopenSessionFile: sessionFile });
			const people = await createPocketPeople({ runtime: reopened, namespace: "hooks.people" }),
				owner = await people.authenticate(f.ownerToken);
			const workspace = createPocketWorkspace({
				runtime: reopened,
				people,
				catalog: { namespace: "hooks.workspace", maxDeliveries: 64, maxPending: 8 },
				profileCeiling: () => ["default"],
			});
			const hooks = await createPocketHooks({
				runtime: reopened,
				people,
				workspace,
				namespace: hookNamespace,
				githubWriters: ["approved-writer"],
			});
			assert.deepEqual(await hooks.receive(input, () => {}), before);
			assert.equal(f.m.f.requests.length, 1);
			assert.equal(reopened.view().budget.primaryAttempts, 1);
			assert.equal((await hooks.bind(owner, f.target).deliveries(credentials.id)).length, 1);
			await people.revokePerson(owner, f.driverSession.person.id);
			assert.equal(
				(
					await hooks.receive(
						{
							...input,
							headers: { "idempotency-key": "after-revoke" },
							body: Buffer.from("NO-AFTER-REVOKE"),
						},
						() => {},
					)
				).state,
				"denied",
			);
			assert.equal(f.m.f.requests.length, 1);
			assert.equal(reopened.view().budget.primaryAttempts, 1);
		} finally {
			await reopened?.close();
			await f.m.close();
		}
	},
);
