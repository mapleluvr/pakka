import { test } from "node:test";
import assert from "node:assert/strict";
import { createRuntime, type Runtime } from "@pakka/agent";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";
import { createPocketHooks } from "../src/pocket-hooks.ts";
import { hooksFixture, hookNamespace } from "./pocket-hooks-fixture.ts";

const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test(
	"Pocket hooks interrupted intent: writer reopen retains unknown without admitting a replacement native input",
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
								const result = await store.compareAndSet(...args);
								if (
									armed &&
									Array.isArray(args[1].deliveries) &&
									args[1].deliveries.some((row) => record(row) && row.state === "pending")
								) {
									armed = false;
									committed = true;
									await release.promise;
								}
								return result;
							},
						});
					},
				}),
		);
		let reopened: Runtime | undefined, settled: Promise<unknown> | undefined;
		try {
			const client = f.hooks.bind(f.driver, f.target),
				added = await client.create({
					requestId: "interrupted",
					name: "Interrupted",
					instructions: "Describe.",
					signed: false,
					allowOutside: false,
				});
			assert.ok(added.hook);
			const credentials = await client.credentials(added.hook.id);
			const post = {
				id: credentials.id,
				secret: credentials.secret,
				headers: { "idempotency-key": "interrupted" },
				body: Buffer.from("NO-AUTOMATIC-REPLAY"),
			};
			armed = true;
			settled = f.hooks
				.receive(post, () => {})
				.then(
					(value) => value,
					() => null,
				);
			await t.waitFor(() => assert.equal(committed, true), { timeout: 2000 });
			const file = f.m.runtime.view().sessionFile;
			await f.m.runtime.close();
			reopened = await createRuntime({ ...f.m.config, reopenSessionFile: file });
			const people = await createPocketPeople({ runtime: reopened, namespace: "hooks.people" }),
				owner = await people.authenticate(f.ownerToken),
				workspace = createPocketWorkspace({
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
			assert.equal((await hooks.receive(post, () => {})).state, "unknown");
			assert.equal(
				(await hooks.bind(owner, f.target).deliveries(credentials.id))[0]!.result.state,
				"unknown",
			);
			await reopened.waitForIdle();
			assert.equal(f.m.f.requests.length, 0);
			assert.equal(reopened.view().budget.primaryAttempts, 0);
		} finally {
			await reopened?.close();
			release.resolve();
			await settled;
			await f.m.close();
		}
	},
);

for (const corruption of ["enum", "association"] as const)
	test(
		`Pocket hooks persistent ${corruption}: malformed or foreign recorded results fail closed`,
		{ timeout: 12000 },
		async () => {
			const f = await hooksFixture();
			try {
				const client = f.hooks.bind(f.driver, f.target),
					added = await client.create({
						requestId: "corrupt",
						name: "Corrupt",
						instructions: "Describe.",
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
								body: Buffer.from("BEFORE-CORRUPTION"),
							},
							() => {},
						)
					).state,
					"accepted",
				);
				await f.m.runtime.waitForIdle();
				const store = f.m.runtime.store({ namespace: hookNamespace, maxBytes: 2097152 }),
					before = await store.snapshot(),
					raw: unknown = JSON.parse(JSON.stringify(before.data));
				assert.ok(
					record(raw) &&
						Array.isArray(raw.deliveries) &&
						record(raw.deliveries[0]) &&
						record(raw.deliveries[0].result),
				);
				if (corruption === "enum") raw.deliveries[0].result.state = ["accepted"];
				else {
					assert.ok(record(raw.deliveries[0].result.receipt));
					raw.deliveries[0].result.receipt.target = f.hidden;
				}
				await store.compareAndSet(before.version, { ...before.data, deliveries: raw.deliveries }, () => {});
				await assert.rejects(client.deliveries(credentials.id), /invalid|unavailable|association/i);
				assert.equal(f.m.f.requests.length, 1);
				assert.equal(f.m.runtime.view().budget.primaryAttempts, 1);
			} finally {
				await f.m.close();
			}
		},
	);
