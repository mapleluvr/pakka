import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodePocketRequest, decodePocketResponse } from "../src/pocket.ts";
const ref = { key: "work", sessionId: "s", conversationId: "c", incarnation: "i", profile: "default" };

test("Independent configuration protocol: only explicit model/cwd changes and bounded directory navigation are accepted", () => {
	const wrap = (command: unknown) => ({ version: 2, requestId: "independent", command });
	for (const command of [
		{ op: "configure.agent", target: ref, change: { model: "local-model" } },
		{ op: "configure.agent", target: ref, change: { cwd: "/approved/project" } },
		{ op: "directory.list", target: ref, path: "/approved", places: ["/approved/project"] },
		{ op: "create", requestId: "new", name: "New", profile: "default", inherit: ref },
	])
		assert.deepEqual(decodePocketRequest(wrap(command)), wrap(command));
	for (const command of [
		{ op: "configure.agent", target: ref, change: {} },
		{ op: "configure.agent", target: ref, change: { model: "local", tools: [] } },
		{ op: "configure.agent", target: ref, change: { cwd: "/tmp\u0000escape" } },
		{ op: "directory.list", target: ref, places: Array(33).fill("/approved") },
		{ op: "directory.list", target: ref, actorId: "owner" },
	])
		assert.throws(() => decodePocketRequest(wrap(command)));
	const response = {
		version: 2,
		serverId: "server",
		requestId: "independent",
		result: {
			kind: "directories",
			target: ref,
			view: {
				path: "/approved",
				parent: null,
				roots: ["/approved"],
				directories: ["/approved/project"],
				places: [],
				truncated: false,
			},
		},
	};
	assert.deepEqual(decodePocketResponse(response, "independent"), response);
	assert.throws(() =>
		decodePocketResponse(
			{ ...response, result: { ...response.result, view: { ...response.result.view, apiKey: "PRIVATE" } } },
			"independent",
		),
	);
});
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
test("WebUI settings protocol: exact scoped metadata and unknown cost are accepted; secret fields and malformed quotas fail closed", () => {
	const request = { version: 2, requestId: "settings", command: { op: "configuration", target: ref } };
	assert.deepEqual(decodePocketRequest(request), request);
	assert.deepEqual(decodePocketResponse(envelope, "settings"), envelope);
	const project = {
		...envelope,
		result: {
			kind: "configuration",
			configuration: {
				...view,
				choices: [{ id: "default", model: "local-model", cwd: "/approved/project" }],
			},
		},
	};
	assert.deepEqual(decodePocketResponse(project, "settings"), project);
	for (const configuration of [
		{ ...view, apiKey: "PRIVATE" },
		{ ...view, choices: [{ id: "default", model: "local", endpoint: "http://private" }] },
		{ ...view, choices: [...view.choices, ...view.choices] },
		...[null, 42, "", "project\u0000private", "x".repeat(8193)].map((cwd) => ({
			...view,
			choices: [{ id: "default", model: "local", cwd }],
		})),
		{ ...view, choices: [{ id: "default", model: "local", cwd: "/approved/project", apiKey: "PRIVATE" }] },
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
