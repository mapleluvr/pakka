import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMas } from "../src/index.ts";
import type { MasClient } from "../src/index.ts";
import { text } from "../../agent/test/fixture.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";

test("M2 MAS: native client invocation rejects copied, foreign and ended scopes", async () => {
	let a!: MasClient, b!: MasClient, late!: MasClient;
	let calls = 0;
	const m = await runtimeFixture(
		{
			tools: [
				{
					name: "mas_probe",
					description: "check MAS invocation",
					parameters: { type: "object", properties: {} },
					execute: async (_args, _signal, scope) => {
						calls++;
						assert.throws(() => b.forInvocation(scope), /scope|invocation/i);
						assert.throws(() => a.forInvocation({ ...scope }), /scope|invocation/i);
						late = a.forInvocation(scope);
						const [_, target] = late.discover();
						const delivered = await late.send(target!.ref, { requestId: "valid", text: "AUTH-CHECK-B" });
						assert.ok(["placed", "done"].includes(delivered.status));
						return "AUTHORIZED-TOOL";
					},
				},
			],
		},
		undefined,
		(payload) =>
			text(payload).includes("NATIVE-A") && !payload.messages.some((message) => message.role === "tool")
				? { tool: "mas_probe" }
				: { text: "finished" },
	);
	try {
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "invocation",
			maxDeliveries: 8,
			maxPending: 2,
		});
		await mas.bootstrap([
			{ key: "a", owner: "operator" },
			{ key: "b", owner: "operator" },
		]);
		await mas.activate();
		const [ra, rb] = (await mas.view()).members;
		a = mas.connect({ principal: "a", source: ra!.ref, grants: ["discover", "send"] });
		b = mas.connect({ principal: "b", source: rb!.ref, grants: ["send"] });
		const admin = mas.connect({ principal: "operator", source: null, grants: ["send"] });
		const start = await admin.send(ra!.ref, { requestId: "native", text: "NATIVE-A" });
		await admin.wait(start.id);
		await m.runtime.waitForIdle();
		assert.equal(calls, 1);
		assert.equal(m.f.requests.length, 3);
		await assert.rejects(
			late.send(rb!.ref, { requestId: "late", text: "OLD-TOOL-SCOPE" }),
			/scope|invocation/i,
		);
		assert.equal(m.f.requests.length, 3);
	} finally {
		await m.close();
	}
});

test("M2 MAS: JavaScript extra arguments cannot select an internal permission action", async () => {
	const m = await runtimeFixture();
	try {
		const mas = await createMas({
			runtime: m.runtime,
			namespace: "hidden-action",
			maxDeliveries: 8,
			maxPending: 2,
		});
		await mas.bootstrap([
			{ key: "a", owner: "operator" },
			{ key: "b", owner: "operator" },
		]);
		await mas.activate();
		const [a, b] = (await mas.view()).members;
		const replyOnly = mas.connect({ principal: "a", source: a!.ref, grants: ["reply"] });
		await assert.rejects(
			Reflect.apply(replyOnly.send, replyOnly, [
				b!.ref,
				{ requestId: "bypass", text: "UNSOLICITED-REPLY" },
				"reply",
			]),
			/send grant/,
		);
		await m.runtime.waitForIdle();
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});
