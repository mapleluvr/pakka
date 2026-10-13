import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMasDevPack } from "../src/index.ts";
import {
	createMas,
	createApprovedSessions,
	inProcessPlacement,
	MasRequestDenied,
	type MasClient,
} from "@pakka/mas";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { fixture, text } from "../../agent/test/fixture.ts";
import { createRuntime } from "../../agent/src/index.ts";
import type { ApprovedSessions } from "../../mas/src/approved-sessions.ts";

for (const scenario of [
	{ location: "new-session", drop: false, conflict: false, waitDenied: false },
	{ location: "existing-session", drop: false, conflict: false, waitDenied: false },
	{ location: "new-session", drop: true, conflict: false, waitDenied: false },
	{ location: "new-session", drop: false, conflict: true, waitDenied: false },
	{ location: "new-session", drop: false, conflict: false, waitDenied: true },
] as const)
	test(
		`M4: actual model selects ${scenario.location}, ${scenario.conflict ? "conflicting reservation explicitly denied" : scenario.waitDenied ? "post-delivery wait refusal remains unknown" : "delivery response " + (scenario.drop ? "lost" : "confirmed")}`,
		{ timeout: 15000 },
		async () => {
			let actor!: MasClient, sessions!: ApprovedSessions;
			const pack = createMasDevPack({ resolve: () => actor });
			// Trusted configuration object is provided by the host, not tool JSON.
			const options = { resolve: () => actor, sessions: () => sessions };
			const active = createMasDevPack(options);
			const beta = await fixture();
			let target: Awaited<ReturnType<typeof createRuntime>> | undefined;
			const a = await runtimeFixture(
				{ profiles: [{ id: "pack", systemPrompt: active.instructions, tools: active.tools }] },
				undefined,
				(payload) => {
					if (!text(payload).includes("NEW-SESSION-FROM-MODEL")) return { text: "finished" };
					const outputs = payload.messages.filter((message) => message.role === "tool");
					if (outputs.length === 0)
						return {
							tool: "mas_spawn",
							args: { location: scenario.location, template: "beta", requestId: "allocation" },
						};
					if (outputs.length > 1) return { text: "sent" };
					let created: unknown;
					try {
						created = JSON.parse(String(outputs[0]!.content));
					} catch {
						return { text: "NO-SESSION" };
					}
					if (
						!created ||
						typeof created !== "object" ||
						!("status" in created) ||
						created.status !== "created" ||
						!("ref" in created)
					)
						return { text: "NO-SESSION" };
					if (scenario.conflict)
						return {
							tool: "mas_spawn",
							args: { location: scenario.location, template: "beta", requestId: "conflicting" },
						};
					return {
						tool: scenario.waitDenied ? "mas_ask" : "mas_send",
						args: {
							sessionTemplate: "beta",
							target: created.ref,
							requestId: "message",
							text: "APPROVED-NEW-TARGET",
						},
					};
				},
			);
			const openTarget = () =>
				createRuntime({
					cwd: beta.cwd,
					dataDir: beta.dataDir,
					endpoint: beta.endpoint,
					model: "local-model",
					apiKey: "local-only",
					reservedSessionId: "22222222-2222-2222-2222-222222222222",
					limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 1 },
				});
			try {
				if (scenario.location === "existing-session") target = await openTarget();
				const mas = await createMas({
					runtime: a.runtime,
					namespace: "source",
					maxDeliveries: 8,
					maxPending: 2,
				});
				await mas.bootstrap([{ key: "a", owner: "operator", profile: "pack" }]);
				await mas.activate();
				const ref = (await mas.view()).members[0]!.ref;
				actor = mas.connect({ principal: "a", source: ref, grants: ["spawn", "send"] });
				sessions = createApprovedSessions({
					store: a.runtime.store({ namespace: "model-reservations", maxBytes: 32768 }),
					templates: {
						beta: {
							location: scenario.location,
							principal: "a",
							source: ref,
							targetKey: "b",
							plan: [
								{ key: "a", placement: "source", owner: "operator", profile: "pack" },
								{ key: "b", placement: "target", owner: "a" },
							],
							broker: {
								namespace: "model-broker",
								store: a.runtime.store({ namespace: "model-broker-store", maxBytes: 65536 }),
								maxMembers: 2,
								maxMessages: 8,
								placements: {
									source: inProcessPlacement({
										runtime: a.runtime,
										namespace: "source",
										maxDeliveries: 8,
										maxPending: 2,
									}),
									target: {
										open: async (expected) => {
											target ??= await openTarget();
											return inProcessPlacement({
												runtime: target,
												namespace: "target",
												maxDeliveries: 8,
												maxPending: 2,
											}).open(expected);
										},
									},
								},
							},
						},
					},
				});
				if (scenario.waitDenied) {
					const original = sessions;
					sessions = {
						...original,
						wait: async () => {
							throw new MasRequestDenied("Wait preflight refused after confirmed send");
						},
					};
				}
				if (scenario.drop) {
					const original = sessions;
					sessions = {
						...original,
						send: async (...args: Parameters<ApprovedSessions["send"]>) => {
							await original.send(...args);
							throw new Error("Lost response after actual native delivery");
						},
					};
				}
				const admin = mas.connect({ principal: "operator", source: null, grants: ["send"] });
				const start = await admin.send(ref, { requestId: "start", text: "NEW-SESSION-FROM-MODEL" });
				await admin.wait(start.id);
				await a.runtime.waitForIdle();
				await target?.waitForIdle();
				assert.equal(beta.requests.length, scenario.conflict ? 0 : 1, "Unexpected target effect count");
				assert.ok(target);
				assert.notEqual(target!.view().sessionId, a.runtime.view().sessionId);
				if (!scenario.conflict) assert.ok(text(beta.requests[0]!).includes("APPROVED-NEW-TARGET"));
				assert.equal(a.f.requests.length, 3);
				assert.equal(beta.errors.length, 0);
				assert.equal(a.f.errors.length, 0);
				if (scenario.conflict) {
					const output = JSON.parse(
						String(a.f.requests.at(-1)!.messages.filter((message) => message.role === "tool")[1]!.content),
					);
					assert.equal(
						output.status,
						"denied",
						"Effect-free reservation conflict was misreported as unknown",
					);
					const claims = (
						await a.runtime.store({ namespace: "model-reservations", maxBytes: 32768 }).snapshot()
					).data.claims;
					assert.ok(claims && typeof claims === "object" && !Array.isArray(claims));
					const original = "beta" in claims ? claims.beta : undefined;
					assert.ok(
						original && typeof original === "object" && "requestId" in original && "status" in original,
					);
					assert.equal(original.requestId, "allocation");
					assert.equal(original.status, "created");
				}
				if (scenario.drop || scenario.waitDenied) {
					const output = JSON.parse(
						String(a.f.requests.at(-1)!.messages.filter((message) => message.role === "tool")[1]!.content),
					);
					assert.equal(output.status, "unknown", "Tool claimed denial after an actual target admission");
				}
				// Merely constructing an unused contribution has no startup effects.
				assert.equal(pack.tools.length, active.tools.length);
			} finally {
				await target?.close();
				await beta.close();
				await a.close();
			}
		},
	);
