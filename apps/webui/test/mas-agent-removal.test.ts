import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { createMas, type Mas } from "@pakka/mas";
import { createMasProfilePacks, validateRetainedMasRoots } from "@pakka/mas-devpack/agent";
import { masExtensionRoot, masWorkbenchService } from "@pakka/mas-devpack/backend";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket, type PocketProductOptions } from "../src/bootstrap.ts";

test(
	"MAS facet removal: the fixed approved profile set reopens, explicit owner configuration removes current tools and preserves original history/receipt",
	{ timeout: 15000 },
	async () => {
		const m = await runtimeFixture({}, undefined, (payload) =>
			payload.messages.at(-1)?.role === "tool"
				? { text: "FIRST-NATIVE-DONE" }
				: payload.tools?.some((tool) => JSON.stringify(tool).includes("mas_spawn"))
					? { tool: "mas_spawn", args: { key: "kept-child", profile: "plain", lifetime: "persistent" } }
					: { text: "PLAIN-NATIVE-DONE" },
		);
		await m.runtime.close();
		let mas: Mas | undefined, app: Awaited<ReturnType<typeof startPocket>> | undefined;
		const pack = createMasProfilePacks({ profiles: { team: ["spawn"] } }, () => mas).get("team")!;
		let remove = false;
		const options: PocketProductOptions = {
			runtime: {
				...m.config,
				dataDir: join(m.f.root, "fixed-profiles"),
				profiles: [
					{ id: "team", tools: pack.tools, systemPrompt: pack.instructions },
					{ id: "plain", tools: [] },
				],
			},
			owner: "Owner",
			profiles: ["plain"],
			initial: [],
			extensions: [{ root: masExtensionRoot }],
			extensionServices: async (context) => {
				mas = await createMas({
					runtime: context.runtime,
					namespace: "fixed.profiles",
					maxDeliveries: 16,
					maxPending: 4,
				});
				const prior = (await mas.view()).members,
					root = prior.find((row) => row.key === "coordinator");
				if (remove && root?.ref.profile !== "plain") {
					assert.ok(root);
					await mas
						.connect({ principal: context.ownerId, source: null, grants: ["configure"] })
						.configure(root.ref, "plain");
				}
				const roots = [{ key: "coordinator", owner: context.ownerId, profile: remove ? "plain" : "team" }];
				if (prior.length) validateRetainedMasRoots((await mas.view()).members, roots);
				else await mas.bootstrap(roots);
				await mas.activate();
				return { mas: masWorkbenchService({ ...context, mas }) };
			},
		};
		try {
			app = await startPocket(options);
			assert.ok(app.initialOwner);
			assert.ok(mas);
			const ownerId = app.initialOwner.person.id;
			let members = (await mas.view()).members;
			const firstRoot = members[0]!.ref,
				client = mas.connect({ principal: ownerId, source: null, grants: ["send", "observe"] });
			const first = await client.wait(
				(await client.send(firstRoot, { requestId: "first", text: "SPAWN-FIRST" })).id,
			);
			assert.equal(first.status, "done");
			assert.equal(m.f.requests.length, 2);
			const child = (await mas.view()).members.find((row) => row.key === "kept-child")!;
			assert.ok(child);
			const sessionFile = app.runtime.view().sessionFile,
				spent = app.runtime.view().budget.primaryAttempts;
			await app.close();
			app = undefined;
			// An operator cannot rewrite the fixed runtime profile definitions as an implicit removal on reopen.
			await assert.rejects(
				startPocket({
					...options,
					runtime: {
						...options.runtime,
						reopenSessionFile: sessionFile,
						profiles: [
							{ id: "team", tools: [] },
							{ id: "plain", tools: [] },
						],
					},
				}),
				/profile\/limits mismatch/,
			);
			remove = true;
			app = await startPocket({
				...options,
				runtime: { ...options.runtime, reopenSessionFile: sessionFile },
				extensions: [{ root: masExtensionRoot, facets: ["backend", "client"] }],
			});
			assert.equal(app.initialOwner, null);
			members = (await mas!.view()).members;
			const restored = members.find((row) => row.key === "coordinator")!.ref;
			assert.equal(restored.sessionId, firstRoot.sessionId);
			assert.equal(restored.conversationId, firstRoot.conversationId);
			assert.equal(restored.profile, "plain");
			assert.notEqual(restored.incarnation, firstRoot.incarnation);
			assert.deepEqual(members.find((row) => row.key === "kept-child")!.ref, child.ref);
			assert.equal(app.runtime.view().budget.primaryAttempts, spent);
			const catalog = app.runtime.catalog({ namespace: "fixed.profiles", maxDeliveries: 16, maxPending: 4 }),
				receipt = await catalog.receipt(first.id, () => {});
			assert.equal(receipt.status, "done");
			assert.equal(receipt.entryId, first.entryId);
			const reader = mas!.connect({ principal: ownerId, source: null, grants: ["send", "observe"] });
			assert.equal(
				(
					await reader.wait(
						(await reader.send(restored, { requestId: "plain", text: "NO-CURRENT-MAS-TOOLS" })).id,
					)
				).status,
				"done",
			);
			assert.equal(m.f.requests.length, 3);
			assert.equal(JSON.stringify(m.f.requests.at(-1)!.tools ?? []).includes("mas_spawn"), false);
			assert.match(
				JSON.stringify((await app.runtime.readConversation(restored, () => {})).entries),
				/kept-child/,
			);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await app?.close();
			await m.f.close();
		}
	},
);
