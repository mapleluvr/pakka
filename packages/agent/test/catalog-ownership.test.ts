import { test } from "node:test";
import { strict as assert } from "node:assert";
import { deferred, text } from "./fixture.ts";
import { runtimeFixture } from "./runtime-fixture.ts";
import type { RuntimeCatalog, CatalogMember, ConversationRef, ToolInvocationScope } from "../src/index.ts";

for (const lifetime of ["temporary", "task-bound", "background"] as const)
	test(
		`M2: ${lifetime} ownership uses actual tool task and respects the native background boundary`,
		{ timeout: 15000 },
		async () => {
			const arrived = deferred(),
				release = deferred(),
				spawned = deferred();
			let catalog!: RuntimeCatalog,
				rootRef!: ConversationRef,
				child!: CatalogMember,
				late!: ToolInvocationScope,
				deliveryId!: string,
				spawnError: unknown;
			const m = await runtimeFixture(
				{
					tools: [
						{
							name: "spawn_child",
							description: "real task ownership",
							parameters: { type: "object", properties: {} },
							execute: async (_args, _signal, invocation) => {
								try {
									late = invocation;
									[child] = await catalog.enroll(
										[{ key: "child", data: { phase: "preparing" }, lifetime, source: rootRef, invocation }],
										() => {},
									);
									await catalog.update(
										child!.key,
										{ phase: "active" },
										(await catalog.snapshot()).version,
										() => {},
									);
									deliveryId = (
										await catalog.deliver(
											{
												requestId: "child-work",
												principal: "owner",
												source: null,
												target: child!.ref,
												text: "CHILD-HOLD",
												mode: "prompt",
											},
											() => {},
										)
									).id;
									return "CHILD-ENROLLED";
								} catch (error) {
									spawnError = error;
									throw error;
								} finally {
									spawned.resolve();
								}
							},
						},
					],
				},
				undefined,
				async (payload) => {
					if (text(payload).includes("CHILD-HOLD")) {
						arrived.resolve();
						await release.promise;
						return { text: "child-finished" };
					}
					if (payload.messages.some((m) => m.role === "tool")) return { text: "parent-finished" };
					return { tool: "spawn_child" };
				},
			);
			try {
				catalog = m.runtime.catalog({ namespace: "task-test", maxDeliveries: 16, maxPending: 4 });
				rootRef = m.runtime.view().conversations[0]!;
				await m.runtime
					.root()
					.connect("owner", ["input.submit"])
					.submit({ key: "task", text: "SPAWN-FROM-REAL-TOOL" });
				await spawned.promise;
				if (spawnError) throw spawnError;
				await arrived.promise;
				assert.ok(child.ownerTaskId);
				await assert.rejects(
					catalog.enroll([{ key: "late", data: {}, lifetime, source: rootRef, invocation: late }], () => {}),
					/invocation|scope/i,
				);
				await m.runtime.root().reload();
				const phase = (await catalog.readiness(child.ref)).phase;
				assert.equal(phase, lifetime === "background" ? "ready" : "ended");
				const [peer] = await catalog.enroll([{ key: "peer", data: { phase: "active" } }], () => {});
				if (lifetime !== "background")
					await assert.rejects(
						catalog.deliver(
							{
								requestId: "ended-source",
								principal: "child",
								source: child.ref,
								target: peer!.ref,
								text: "ENDED-SOURCE-MUST-NOT-SEND",
								mode: "prompt",
							},
							() => {},
						),
						/owner.*ended/,
					);
				if (lifetime === "background") {
					release.resolve();
					await (await m.runtime.conversation(child.ref)).waitForIdle();
					assert.equal((await catalog.receipt(deliveryId, () => {})).status, "done");
					await catalog.stop(child.ref, () => {});
					assert.equal(
						(await catalog.readiness(child.ref)).phase,
						"ended",
						"retiring a background child must drain its owning anchor",
					);
				}
			} finally {
				release.resolve();
				await m.close();
			}
		},
	);
