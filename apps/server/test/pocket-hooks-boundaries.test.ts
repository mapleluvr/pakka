import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntime, type Runtime } from "@pakka/agent";
import type { PocketInputReceipt } from "../src/pocket-workspace.ts";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";
import { createPocketHooks } from "../src/pocket-hooks.ts";
import { hooksFixture, hookNamespace, signedBody } from "./pocket-hooks-fixture.ts";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

for (const change of ["creator", "extension", "rotation"] as const)
	test(
		`Pocket hooks effect boundary: ${change} invalidation after real intent commit blocks a late native input`,
		{ timeout: 12000 },
		async (t) => {
			let armed = false,
				committed = false;
			const release = deferred();
			const f = await hooksFixture(
				(workspace) => workspace,
				(runtime: Runtime) =>
					Object.freeze({
						...runtime,
						store(options: Parameters<Runtime["store"]>[0]) {
							const store = runtime.store(options);
							if (options.namespace !== hookNamespace) return store;
							return Object.freeze({
								...store,
								compareAndSet: async (...args: Parameters<typeof store.compareAndSet>) => {
									const value = await store.compareAndSet(...args);
									if (
										armed &&
										Array.isArray(args[1].deliveries) &&
										args[1].deliveries.some(
											(row) => row && typeof row === "object" && "state" in row && row.state === "pending",
										)
									) {
										armed = false;
										committed = true;
										await release.promise;
									}
									return value;
								},
							});
						},
					}),
			);
			let pending: ReturnType<typeof f.hooks.receive> | undefined, rotation: Promise<unknown> | undefined;
			try {
				const client = f.hooks.bind(f.driver, f.target),
					added = await client.create({
						requestId: "late",
						name: "Late event",
						instructions: "Describe it.",
						signed: false,
						allowOutside: false,
					});
				assert.ok(added.hook);
				const credentials = await client.credentials(added.hook.id);
				let active = true;
				armed = true;
				pending = f.hooks.receive(
					{ id: credentials.id, secret: credentials.secret, headers: {}, body: Buffer.from("NO-LATE-INPUT") },
					() => {
						if (!active) throw Error("TEST expired generation");
					},
				);
				await t.waitFor(() => assert.equal(committed, true), { timeout: 2000 });
				if (change === "creator") await f.people.revokePerson(f.owner, f.driverSession.person.id);
				else if (change === "extension") active = false;
				else
					rotation = client.rotate({
						requestId: "rotate",
						id: credentials.id,
						expectedVersion: credentials.version,
					});
				release.resolve();
				assert.equal((await pending).state, "denied");
				await rotation;
				await f.m.runtime.waitForIdle();
				assert.equal(f.m.f.requests.length, 0);
				assert.equal(f.m.runtime.view().budget.primaryAttempts, 0);
				assert.equal(
					(await f.hooks.bind(f.owner, f.target).deliveries(credentials.id))[0]!.result.state,
					"denied",
				);
			} finally {
				release.resolve();
				await pending?.catch(() => {});
				await rotation?.catch(() => {});
				await f.m.close();
			}
		},
	);

test(
	"Pocket hooks unknown: a real admission followed by lost confirmation is retained across retries and writer reopen without a second HTTP",
	{ timeout: 12000 },
	async () => {
		const captured: PocketInputReceipt[] = [];
		let idle = async () => {};
		const f = await hooksFixture((workspace) =>
			Object.freeze({
				...workspace,
				submitScheduled: async (...args: Parameters<typeof workspace.submitScheduled>) => {
					const receipt = await workspace.submitScheduled(...args);
					captured.push(receipt);
					await idle();
					throw Error("TEST LOST REAL ADMISSION RESULT");
				},
			}),
		);
		idle = () => f.m.runtime.waitForIdle();
		let reopened: Runtime | undefined;
		try {
			const client = f.hooks.bind(f.driver, f.target),
				added = await client.create({
					requestId: "unknown",
					name: "Unknown",
					instructions: "Describe it.",
					signed: false,
					allowOutside: false,
				});
			assert.ok(added.hook);
			const credentials = await client.credentials(added.hook.id),
				post = {
					id: credentials.id,
					secret: credentials.secret,
					headers: { "idempotency-key": "lost-admission" },
					body: Buffer.from("REAL-HTTP-BEFORE-UNKNOWN"),
				};
			const first = await f.hooks.receive(post, () => {});
			assert.equal(first.state, "unknown");
			assert.equal(f.m.f.requests.length, 1);
			assert.equal(captured.length, 1);
			assert.equal((await f.workspace.bind(f.driver).wait(captured[0]!.id)).status, "done");
			assert.deepEqual(await f.hooks.receive(post, () => {}), first);
			assert.equal(captured.length, 1);
			const file = f.m.runtime.view().sessionFile;
			await f.m.runtime.close();
			reopened = await createRuntime({ ...f.m.config, reopenSessionFile: file });
			const people = await createPocketPeople({ runtime: reopened, namespace: "hooks.people" });
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
			assert.deepEqual(await hooks.receive(post, () => {}), first);
			await reopened.waitForIdle();
			assert.equal(f.m.f.requests.length, 1);
			assert.equal(reopened.view().budget.primaryAttempts, 1);
		} finally {
			await reopened?.close();
			await f.m.close();
		}
	},
);

test(
	"Pocket hooks finite rate: 30 actual native inputs consume the hour quota and the 31st has no effect",
	{ timeout: 20000 },
	async () => {
		const f = await hooksFixture();
		try {
			const client = f.hooks.bind(f.driver, f.target),
				added = await client.create({
					requestId: "rate",
					name: "Rate limit",
					instructions: "Summarize briefly.",
					signed: false,
					allowOutside: false,
				});
			assert.ok(added.hook);
			const credentials = await client.credentials(added.hook.id);
			for (let index = 0; index < 30; index++) {
				assert.equal(
					(
						await f.hooks.receive(
							{
								id: credentials.id,
								secret: credentials.secret,
								headers: { "idempotency-key": "rate-" + index },
								body: Buffer.from("REAL-RATE-EVENT-" + index),
							},
							() => {},
						)
					).state,
					"accepted",
				);
				await f.m.runtime.waitForIdle();
			}
			assert.equal(f.m.f.requests.length, 30);
			assert.equal(f.m.runtime.view().budget.primaryAttempts, 30);
			assert.equal(
				(
					await f.hooks.receive(
						{
							id: credentials.id,
							secret: credentials.secret,
							headers: { "idempotency-key": "rate-31" },
							body: Buffer.from("NO-31ST-EFFECT"),
						},
						() => {},
					)
				).state,
				"capacity",
			);
			await f.m.runtime.waitForIdle();
			assert.equal(f.m.f.requests.length, 30);
			assert.equal((await client.list())[0]!.received, 30);
		} finally {
			await f.m.close();
		}
	},
);

test(
	"Pocket hooks finite bytes: oversized raw input has no effect and the exact 5 MiB bound fits the real native text limit",
	{ timeout: 12000 },
	async () => {
		const f = await hooksFixture();
		try {
			const client = f.hooks.bind(f.driver, f.target),
				added = await client.create({
					requestId: "body",
					name: "B".repeat(60),
					instructions: "I".repeat(2000),
					signed: false,
					allowOutside: false,
				});
			assert.ok(added.hook);
			const credentials = await client.credentials(added.hook.id);
			assert.equal(
				(
					await f.hooks.receive(
						{
							id: credentials.id,
							secret: credentials.secret,
							headers: {},
							body: Buffer.alloc(5 * 1024 * 1024 + 1),
						},
						() => {},
					)
				).state,
				"capacity",
			);
			assert.equal(f.m.f.requests.length, 0);
			assert.equal(
				(
					await f.hooks.receive(
						{
							id: credentials.id,
							secret: credentials.secret,
							headers: {},
							body: Buffer.alloc(5 * 1024 * 1024, 0x78),
						},
						() => {},
					)
				).state,
				"accepted",
			);
			await f.m.runtime.waitForIdle();
			assert.equal(f.m.f.requests.length, 1);
			assert.equal(JSON.stringify(f.m.f.requests[0]).includes("x".repeat(8193)), false);
		} finally {
			await f.m.close();
		}
	},
);

test(
	"Pocket hooks authority and copies: viewers and foreign resources cannot create hooks, and later input mutation cannot change signed bytes",
	{ timeout: 12000 },
	async () => {
		const f = await hooksFixture();
		try {
			const client = f.hooks.bind(f.driver, f.target),
				input = {
					requestId: "copied",
					name: "Copied",
					instructions: "Describe.",
					signed: true,
					allowOutside: false,
				};
			await assert.rejects(async () => f.hooks.bind(f.driver, f.hidden).create(input), /denied/i);
			const invite = await f.people.invite(f.owner, {
				requestId: "viewer",
				role: "viewer",
				resources: [f.target.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const login = await f.people.redeem(invite.token, "Viewer"),
				viewer = await f.people.authenticate(login.token);
			await assert.rejects(async () => f.hooks.bind(viewer, f.target).create(input), /denied/i);
			assert.deepEqual(await f.hooks.bind(viewer, f.target).list(), []);
			const added = await client.create(input);
			assert.ok(added.hook);
			const credentials = await client.credentials(added.hook.id),
				body = Buffer.from(
					JSON.stringify({ ref: "refs/heads/main", commits: [{ message: "COPY-ORIGINAL-CANARY" }] }),
				),
				headers = signedBody(credentials.secret, body);
			const result = f.hooks.receive({ id: credentials.id, headers, body }, () => {});
			body.fill(0x20);
			headers["x-hub-signature-256"] = "forged";
			assert.equal((await result).state, "accepted");
			await f.m.runtime.waitForIdle();
			assert.equal(f.m.f.requests.length, 1);
			assert.ok(JSON.stringify(f.m.f.requests[0]).includes("COPY-ORIGINAL-CANARY"));
			await assert.rejects(async () => f.hooks.bind(viewer, f.target).credentials(credentials.id), /denied/i);
		} finally {
			await f.m.close();
		}
	},
);
