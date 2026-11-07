import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePocketRequest, decodePocketResponse } from "../src/pocket.ts";

test("Session reopen protocol names only an existing identity, never a replacement store or recovery override", () => {
	const request = {
		version: 2,
		requestId: "open-original",
		command: { op: "session.reopen", sessionId: "original-session" },
	};
	assert.deepEqual(decodePocketRequest(request), request);
	for (const extra of [
		{ path: "/other.sqlite" },
		{ clearWriter: true },
		{ create: true },
		{ force: true },
		{ actorId: "owner" },
	])
		assert.throws(() => decodePocketRequest({ ...request, command: { ...request.command, ...extra } }));
});

test("Session recovery diagnostics are finite DTOs, not error bodies or promises to reopen unknown work", () => {
	const session = {
		id: "original-session",
		name: "Original",
		status: "unavailable",
		problem: { kind: "open-failed", canReopen: true },
	};
	const response = {
		version: 2,
		requestId: "open-original",
		serverId: "server",
		result: { kind: "session.state", session },
	};
	assert.deepEqual(decodePocketResponse(response, response.requestId), response);
	for (const kind of ["runtime-unavailable", "cleanup-unconfirmed"])
		assert.doesNotThrow(() =>
			decodePocketResponse(
				{
					...response,
					result: { ...response.result, session: { ...session, problem: { kind, canReopen: false } } },
				},
				response.requestId,
			),
		);
	for (const bad of [
		Object.assign([], session),
		{ ...session, problem: Object.assign([], session.problem) },
		{ ...session, problem: { ...session.problem, error: "private error body" } },
		{ ...session, status: "unknown" },
		{ ...session, status: "ready" },
		{ ...session, problem: { kind: "cleanup-unconfirmed", canReopen: true } },
		{ ...session, problem: { kind: "unknown", canReopen: true } },
	])
		assert.throws(() =>
			decodePocketResponse({ ...response, result: { ...response.result, session: bad } }, response.requestId),
		);
});
