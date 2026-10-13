import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as module from "../src/index.ts";
import { inProcessPlacement, createMas, type MasClient } from "../src/index.ts";
import { fixture, text } from "../../agent/test/fixture.ts";
import { createRuntime } from "../../agent/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import type { SessionPlacement, SessionEndpoint, BrokerAgentRef } from "../src/broker-types.ts";

test(
	"M4: approved new Session reserves one identity and retries lost preparation on the same real storage",
	{ timeout: 15000 },
	async () => {
		const create = Reflect.get(module, "createApprovedSessions");
		assert.equal(typeof create, "function", "Approved Session service is missing");
		const a = await runtimeFixture();
		const f = await fixture();
		let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
		const reserved = "11111111-1111-1111-1111-111111111111";
		let lose = true;
		const placement: SessionPlacement = {
			open: async (expected) => {
				runtime ??= await createRuntime({
					cwd: f.cwd,
					dataDir: f.dataDir,
					endpoint: f.endpoint,
					model: "local-model",
					apiKey: "local-only",
					reservedSessionId: reserved,
					limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 1 },
				});
				const endpoint = await inProcessPlacement({
					runtime,
					namespace: "target",
					maxDeliveries: 8,
					maxPending: 2,
				}).open(expected);
				return Object.freeze({
					...endpoint,
					prepare: async (specs: Parameters<SessionEndpoint["prepare"]>[0]) => {
						const result = await endpoint.prepare(specs);
						if (lose) {
							lose = false;
							throw new Error("lost-after-real-prepare");
						}
						return result;
					},
				});
			},
		};
		try {
			const mas = await createMas({
				runtime: a.runtime,
				namespace: "source",
				maxDeliveries: 8,
				maxPending: 2,
			});
			await mas.bootstrap([{ key: "a", owner: "operator" }]);
			await mas.activate();
			const ref = (await mas.view()).members[0]!.ref;
			const client = mas.connect({ principal: "a", source: ref, grants: ["spawn", "send"] });
			const store = a.runtime.store({ namespace: "approved-requests", maxBytes: 32768 });
			const templates = {
				newWorker: {
					location: "new-session" as const,
					principal: "a",
					source: ref,
					targetKey: "b",
					plan: [
						{ key: "a", placement: "source", owner: "operator" },
						{ key: "b", placement: "target", owner: "a" },
					],
					broker: {
						namespace: "session-template",
						store: a.runtime.store({ namespace: "approved-broker", maxBytes: 65536 }),
						maxMembers: 2,
						maxMessages: 8,
						placements: {
							source: inProcessPlacement({
								runtime: a.runtime,
								namespace: "source",
								maxDeliveries: 8,
								maxPending: 2,
							}),
							target: placement,
						},
					},
				},
			};
			const provisioner = create({ store, templates }) as {
				request(
					client: MasClient,
					input: { template: string; requestId: string; location: string },
				): Promise<{ status: string; ref?: BrokerAgentRef }>;
				send(
					client: MasClient,
					template: string,
					target: BrokerAgentRef,
					input: { requestId: string; text: string },
				): Promise<{ status: string; id: string }>;
			};
			const first = await provisioner.request(client, {
				template: "newWorker",
				requestId: "one",
				location: "new-session",
			});
			assert.equal(first.status, "unknown");
			assert.ok(runtime, JSON.stringify((await templates.newWorker.broker.store.snapshot()).data));
			assert.equal(f.requests.length, 0);
			const original = runtime!.view().sessionId;
			const resumed = create({ store, templates }) as typeof provisioner;
			const ready = await resumed.request(client, {
				template: "newWorker",
				requestId: "one",
				location: "new-session",
			});
			assert.equal(ready.status, "created");
			assert.equal(ready.ref!.sessionId, original);
			assert.equal(ready.ref!.conversation.sessionId, reserved);
			assert.equal(
				(await resumed.request(client, { template: "newWorker", requestId: "one", location: "new-session" }))
					.ref!.conversation.incarnation,
				ready.ref!.conversation.incarnation,
			);
			await assert.rejects(
				resumed.request(client, { template: "newWorker", requestId: "two", location: "new-session" }),
				/reservation|occupied|conflict/,
			);
			await resumed.send(client, "newWorker", ready.ref!, {
				requestId: "message",
				text: "REAL-APPROVED-SESSION",
			});
			await runtime!.waitForIdle();
			assert.equal(f.requests.length, 1);
			assert.ok(text(f.requests[0]!).includes("REAL-APPROVED-SESSION"));
			assert.equal(a.f.requests.length, 0);
			mas.revoke("a");
			await assert.rejects(
				resumed.send(client, "newWorker", ready.ref!, { requestId: "revoked", text: "NO-SECOND-REQUEST" }),
				/revoked/,
			);
			assert.equal(f.requests.length, 1);
		} finally {
			await runtime?.close();
			await f.close();
			await a.close();
		}
	},
);
