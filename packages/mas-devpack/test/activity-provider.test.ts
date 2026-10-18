import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMas } from "@pakka/mas";
import { createServer } from "node:http";
import { setTimeout } from "node:timers/promises";
import type { ConversationSnapshot } from "@pakka/agent";
import { deferred } from "../../agent/test/fixture.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createMasWorkbench } from "../src/workbench.ts";

test(
	"Board follows an actual native stream from thinking to reply while earlier parts remain retained",
	{ timeout: 15000 },
	async () => {
		const replyGate = deferred(),
			endGate = deferred();
		let calls = 0;
		const errors: unknown[] = [];
		const server = createServer((request, response) => {
			void (async () => {
				for await (const _chunk of request) {
					/* Drain the real provider request. */
				}
				calls++;
				response.writeHead(200, { "content-type": "text/event-stream" });
				response.flushHeaders();
				const emit = (delta: object, finish_reason: string | null = null) =>
					response.write(
						"data: " +
							JSON.stringify({
								id: "local-stream",
								object: "chat.completion.chunk",
								created: 1,
								model: "local-model",
								choices: [{ index: 0, delta, finish_reason }],
							}) +
							"\n\n",
					);
				emit({ role: "assistant" });
				emit({ reasoning_content: "PUBLIC-THINKING-COMPLETE" });
				await replyGate.promise;
				emit({ content: "REPLY-ALREADY-STREAMING" });
				await endGate.promise;
				emit({}, "stop");
				response.end("data: [DONE]\n\n");
			})().catch((error) => {
				errors.push(error);
				response.destroy(error instanceof Error ? error : Error(String(error)));
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		let m: Awaited<ReturnType<typeof runtimeFixture>> | undefined;
		try {
			const address = server.address();
			assert.ok(address && typeof address !== "string");
			const active = await runtimeFixture({ endpoint: "http://127.0.0.1:" + address.port + "/v1" });
			m = active;
			const mas = await createMas({
				runtime: active.runtime,
				namespace: "stream-phase",
				maxDeliveries: 8,
				maxPending: 4,
			});
			await mas.bootstrap([{ key: "recipient", owner: "owner" }]);
			await mas.activate();
			const ref = (await mas.view()).members[0]!.ref;
			const sender = mas.connect({ principal: "owner", source: null, grants: ["send", "observe"] });
			const board = createMasWorkbench({ mas, runtime: active.runtime }).bind({
				id: "owner",
				current() {},
				check() {},
			});
			const receipt = await sender.send(ref, { requestId: "stream-once", text: "ONE-STREAM" });
			const until = async (predicate: (snapshot: ConversationSnapshot) => boolean) => {
				for (let n = 0; n < 400; n++) {
					const snapshot = await active.runtime.readConversation(ref, () => {});
					if (predicate(snapshot)) return snapshot;
					await setTimeout(10);
				}
				throw Error("Native streaming observation deadline");
			};
			const nativeParts = (snapshot: ConversationSnapshot) => {
				const value = snapshot.live.message?.content;
				return typeof value === "string" || !value ? [] : value;
			};
			await until(
				(snapshot) =>
					snapshot.live.busy &&
					nativeParts(snapshot).some(
						(part) => part.type === "thinking" && part.thinking === "PUBLIC-THINKING-COMPLETE",
					),
			);
			assert.equal((await board.activities([ref]))[0]!.state, "thinking");
			replyGate.resolve();
			const native = await until(
				(snapshot) =>
					snapshot.live.busy &&
					nativeParts(snapshot).some(
						(part) => part.type === "text" && part.text === "REPLY-ALREADY-STREAMING",
					),
			);
			assert.ok(
				nativeParts(native).some((part) => part.type === "thinking"),
				"The provider retains earlier thinking alongside live text",
			);
			const live = (await board.activities([ref]))[0]!;
			assert.equal(live.state, "reply", "The current native phase wins over retained earlier thinking");
			assert.equal(live.preview, "REPLY-ALREADY-STREAMING");
			endGate.resolve();
			assert.equal((await sender.wait(receipt.id)).status, "done");
			assert.equal((await board.activities([ref]))[0]!.preview, "REPLY-ALREADY-STREAMING");
			assert.equal(calls, 1, "Activity reads do not start another model generation");
			assert.equal(active.runtime.view().budget.primaryAttempts, 1);
			assert.deepEqual(errors, []);
		} finally {
			replyGate.resolve();
			endGate.resolve();
			try {
				await m?.close();
			} finally {
				server.closeAllConnections();
				await new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
			}
		}
	},
);

test("Board shows an actual provider rejection in its failed Conversation while retaining the original delivery", async () => {
	const m = await runtimeFixture({}, undefined, () => ({ error: 401 }));
	try {
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "provider.observation",
			maxDeliveries: 8,
			maxPending: 4,
		});
		await mas.bootstrap([
			{ key: "sender", owner: "owner" },
			{ key: "recipient", owner: "owner" },
		]);
		await mas.activate();
		const [sender, recipient] = (await mas.view()).members;
		const client = mas.connect({ principal: "owner", source: sender!.ref, grants: ["send", "observe"] });
		const receipt = await client.send(recipient!.ref, {
			requestId: "failed-input",
			text: "ONE-PROVIDER-FAILURE",
		});
		assert.equal((await client.wait(receipt.id)).status, "unanswered");
		const reader = createMasWorkbench({ runtime: m.runtime, mas }).bind({
			id: "owner",
			current() {},
			check() {},
		});
		const [activity] = await reader.activities([recipient!.ref]);
		assert.equal(activity!.state, "error");
		assert.match(activity!.preview, /401/);
		assert.match(activity!.preview, /LOCAL-FAILURE/);
		assert.equal(
			activity!.code,
			undefined,
			"The SDK error string is retained as supplied; it is not reclassified as structured HTTP metadata",
		);
		assert.equal((await reader.history({})).items[0]!.receipt.id, receipt.id);
		assert.equal(m.f.requests.length, 1, "Reading the failure does not retry it");
	} finally {
		await m.close();
	}
});
