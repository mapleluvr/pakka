import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodePocketRequest, decodePocketResponse } from "../src/pocket.ts";
const ref = { key: "work", sessionId: "s", conversationId: "c", incarnation: "i", profile: "default" };
const view = {
	ref,
	choices: [{ id: "default", model: "local-model" }],
	canConfigure: false,
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: null },
	session: null,
};
const envelope = {
	version: 2,
	serverId: "server",
	requestId: "settings",
	result: { kind: "configuration", configuration: view },
};
test("Pocket settings protocol: exact scoped metadata and unknown cost are accepted; secret fields and malformed quotas fail closed", () => {
	const request = { version: 2, requestId: "settings", command: { op: "configuration", target: ref } };
	assert.deepEqual(decodePocketRequest(request), request);
	assert.deepEqual(decodePocketResponse(envelope, "settings"), envelope);
	for (const configuration of [
		{ ...view, apiKey: "PRIVATE" },
		{ ...view, choices: [{ id: "default", model: "local", endpoint: "http://private" }] },
		{ ...view, choices: [...view.choices, ...view.choices] },
		{ ...view, usage: { ...view.usage, cost: Infinity } },
		{
			...view,
			session: {
				limits: { maxConversations: 1, maxPrimaryAttempts: 0, maxAuxiliaryAttempts: 1 },
				budget: { primaryAttempts: 0, auxiliaryAttempts: 0 },
			},
		},
		{
			...view,
			session: {
				limits: { maxConversations: 1, maxPrimaryAttempts: 1, maxAuxiliaryAttempts: 1 },
				budget: { primaryAttempts: -1, auxiliaryAttempts: 0 },
			},
		},
	])
		assert.throws(() =>
			decodePocketResponse({ ...envelope, result: { kind: "configuration", configuration } }, "settings"),
		);
	assert.throws(() => decodePocketRequest({ ...request, command: { ...request.command, actorId: "admin" } }));
});
