import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Runtime } from "@pakka/agent";
import { createPocketPeople, createPocketWorkspace } from "@pakka/server/pocket";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { createExtensionHost } from "../src/extension-host.ts";
import { workspaceFilesExtensionRoot, workspaceFilesService } from "../src/workflows.ts";

// Removing the bound check at the disk boundary lets a disabled generation overwrite real bytes.
// This wait wraps a public port AFTER its real Durable CAS; it does not replace storage or disk effects.
for (const change of ["disable", "abort"] as const) {
	test(
		`WebUI file contribution: ${change} after real intent commit prevents a late disk effect`,
		{ timeout: 15000 },
		async (t) => {
			const m = await runtimeFixture(),
				entered = deferred(),
				release = deferred();
			let paused = false;
			try {
				const runtime: Runtime = Object.freeze({
					...m.runtime,
					store(options: Parameters<Runtime["store"]>[0]) {
						const port = m.runtime.store(options);
						if (options.namespace !== "delayed.files") return port;
						return Object.freeze({
							snapshot: port.snapshot,
							compareAndSet: async (...args: Parameters<typeof port.compareAndSet>) => {
								const saved = await port.compareAndSet(...args);
								if (
									!paused &&
									Array.isArray(saved.data.rows) &&
									saved.data.rows.some(
										(row) => row && typeof row === "object" && !Array.isArray(row) && row.state === "running",
									)
								) {
									paused = true;
									entered.resolve();
									await release.promise;
								}
								return saved;
							},
						});
					},
				});
				const people = await createPocketPeople({ runtime, namespace: "delayed.people" });
				const session = await people.initializeOwner("Owner"),
					actor = await people.authenticate(session.token);
				const workspace = createPocketWorkspace({
					runtime,
					people,
					catalog: { namespace: "delayed.workspace", maxDeliveries: 8, maxPending: 2 },
					profileCeiling: () => ["default"],
				});
				const target = await workspace
					.bind(actor)
					.create({ requestId: "work", name: "Work", profile: "default" });
				await writeFile(join(m.f.cwd, "guarded.txt"), "ORIGINAL\n");
				const files = await workspaceFilesService(
					{ runtime, people, workspace, ownerId: actor.person.id },
					{
						namespace: "delayed.files",
						roots: [{ id: "project", path: m.f.cwd, resources: [target.conversationId], writable: true }],
					},
				);
				const host = await createExtensionHost({
					runtime,
					people,
					workspace,
					sources: [{ root: workspaceFilesExtensionRoot }],
					services: { files },
				});
				const registration = host.list(actor, target)[0]!,
					controller = new AbortController();
				const call = {
					extension: registration.manifest.id,
					generation: registration.generation,
					action: "write",
					requestId: "stable-write",
					target,
					input: {
						root: "project",
						path: "guarded.txt",
						expectedSha256: createHash("sha256").update("ORIGINAL\n").digest("hex"),
						text: "LATE-FORBIDDEN\n",
					},
				};
				const pending = host.call(actor, call, controller.signal);
				await t.waitFor(() => assert.equal(paused, true), { timeout: 5000 });
				await entered.promise;
				const intent = await m.runtime
					.store({ namespace: "delayed.files", maxBytes: 1024 * 1024 })
					.snapshot();
				assert.ok(Array.isArray(intent.data.rows));
				assert.equal(intent.data.rows.length, 1);
				assert.equal(await readFile(join(m.f.cwd, "guarded.txt"), "utf8"), "ORIGINAL\n");
				if (change === "disable") await host.setEnabled(actor, registration.manifest.id, false);
				else controller.abort();
				release.resolve();
				const result = await pending;
				assert.equal(result.state, "unknown");
				assert.equal(
					await readFile(join(m.f.cwd, "guarded.txt"), "utf8"),
					"ORIGINAL\n",
					"revoked generation must be checked before changing target bytes",
				);
				if (change === "disable") await host.setEnabled(actor, registration.manifest.id, true);
				const current = host.list(actor, target)[0]!;
				assert.equal((await host.call(actor, { ...call, generation: current.generation })).state, "unknown");
				assert.equal(await readFile(join(m.f.cwd, "guarded.txt"), "utf8"), "ORIGINAL\n");
				assert.equal(m.f.requests.length, 0);
				assert.deepEqual(m.f.errors, []);
			} finally {
				release.resolve();
				await m.close();
			}
		},
	);
}
