import { strict as assert } from "node:assert";
import { test } from "node:test";
import { createRuntime } from "../src/index.ts";
import { runtimeFixture } from "./runtime-fixture.ts";
import { readNativeDocument } from "./native-storage.ts";

const allow = () => {};

test("delivery history: a legacy retention setting does not limit completed work", async () => {
	const m = await runtimeFixture();
	try {
		const catalog = m.runtime.catalog({ namespace: "long-lived", maxDeliveries: 2, maxPending: 2 });
		const [member] = await catalog.enroll([{ key: "worker", data: { phase: "active" } }], allow);
		for (let n = 0; n < 3; n++) {
			const receipt = await catalog.deliver(
				{
					requestId: `input-${n}`,
					principal: "owner",
					source: null,
					target: member!.ref,
					text: `input ${n}`,
					mode: "prompt",
				},
				allow,
			);
			assert.equal((await catalog.wait(receipt.id, allow)).status, "done");
		}
		assert.equal(m.f.requests.length, 3);
	} finally {
		await m.close();
	}
});

test(
	"delivery history: crosses 512, reopens the same Session and reconciles the original without replay",
	{ timeout: 240000 },
	async () => {
		const m = await runtimeFixture(
			{},
			{ maxConversations: 4, maxPrimaryAttempts: 600, maxAuxiliaryAttempts: 8 },
		);
		let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
		try {
			const options = { namespace: "long-running", maxDeliveries: 512, maxPending: 2 };
			const catalog = m.runtime.catalog(options);
			const members = await catalog.enroll(
				[
					{ key: "a", data: { phase: "active" } },
					{ key: "b", data: { phase: "active" } },
				],
				allow,
			);
			const firstSpec = {
				requestId: "input-0",
				principal: "owner",
				source: null,
				target: members[0]!.ref,
				text: "input 0",
				mode: "prompt" as const,
			};
			const ids: string[] = [];
			for (let n = 0; n < 520; n++) {
				const spec = {
					...firstSpec,
					requestId: `input-${n}`,
					target: members[n % 2]!.ref,
					text: `input ${n}`,
				};
				const receipt = await catalog.deliver(spec, allow);
				ids.push(receipt.id);
				assert.equal((await catalog.wait(receipt.id, allow)).status, "done");
			}
			assert.equal(m.f.requests.length, 520);
			const session = m.runtime.view();
			const hot = await readNativeDocument(session.sessionFile, "pakka.catalog", options.namespace);
			assert.ok(
				Buffer.byteLength(JSON.stringify(hot.value)) < 16384,
				"completed payloads do not grow the admission document",
			);
			assert.equal(hot.value.deliveries, undefined);
			const archived = await readNativeDocument(session.sessionFile, "pakka.catalog-delivery", ids[0]);
			assert.equal(
				archived.value.record &&
					typeof archived.value.record === "object" &&
					!Array.isArray(archived.value.record) &&
					archived.value.record.id,
				ids[0],
			);
			const scoped = await catalog.history(
				{ limit: 2 },
				allow,
				(spec) => spec.target.conversationId === members[0]!.ref.conversationId,
			);
			assert.deepEqual(
				scoped.items.map((item) => item.receipt.id),
				[ids[518], ids[516]],
			);
			await assert.rejects(
				catalog.history(
					{ cursor: ids[519] },
					allow,
					(spec) => spec.target.conversationId === members[0]!.ref.conversationId,
				),
				/cursor/,
			);
			await m.runtime.close();
			reopened = await createRuntime({ ...m.config, reopenSessionFile: session.sessionFile });
			assert.equal(reopened.view().sessionId, session.sessionId);
			// A former storage identity parameter must not strand existing histories.
			const restored = reopened.catalog({ ...options, maxDeliveries: 1 });
			assert.equal((await restored.deliver(firstSpec, allow)).id, ids[0]);
			assert.equal((await restored.lookupReceipt(ids[0]!, allow))?.status, "done");
			await assert.rejects(restored.deliver({ ...firstSpec, text: "different" }, allow), /conflict/);
			const observed: string[] = [];
			let cursor: string | undefined;
			do {
				const page = await restored.history({ limit: 64, ...(cursor ? { cursor } : {}) }, allow);
				observed.push(...page.items.map((item) => item.receipt.id));
				cursor = page.nextCursor;
			} while (cursor);
			assert.deepEqual(observed, [...ids].reverse());
			assert.equal(m.f.requests.length, 520);
			const last = await restored.deliver(
				{ ...firstSpec, requestId: "after-reopen", text: "continue" },
				allow,
			);
			assert.equal((await restored.wait(last.id, allow)).status, "done");
			assert.equal(m.f.requests.length, 521);
			assert.deepEqual(
				await readNativeDocument(session.sessionFile, "pakka.catalog-delivery", ids[0]),
				archived,
				"new admissions leave archived receipt bytes/version unchanged",
			);
		} finally {
			await reopened?.close();
			await m.close();
		}
	},
);
