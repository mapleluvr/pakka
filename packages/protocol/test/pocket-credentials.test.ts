import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodePocketRequest, decodePocketResponse } from "../src/pocket.ts";
test("WebUI private configuration protocol: dedicated replace/clear/status never accepts an identity or returns a saved value", () => {
	const input = { requestId: "replacement", expectedVersion: 0, secret: "SYNTHETIC-KEY" };
	for (const command of [
		{ op: "credential.status" },
		{ op: "credential.replace", input },
		{ op: "credential.clear", input: { requestId: "clear", expectedVersion: 1 } },
	])
		assert.deepEqual(decodePocketRequest({ version: 2, requestId: "rpc", command }).command, command);
	const response = {
		version: 2,
		requestId: "rpc",
		serverId: "server",
		result: { kind: "credential", status: { version: 1, configured: true } },
	};
	assert.deepEqual(decodePocketResponse(response, "rpc"), response);
	for (const changed of [
		{ ...input, actorId: "admin" },
		{ ...input, secret: "" },
		{ ...input, secret: "x".repeat(4097) },
		{ ...input, secret: "line\nbreak" },
		{ ...input, expectedVersion: -1 },
	])
		assert.throws(() =>
			decodePocketRequest({
				version: 2,
				requestId: "rpc",
				command: { op: "credential.replace", input: changed },
			}),
		);
	assert.throws(() =>
		decodePocketRequest({ version: 2, requestId: "rpc", command: { op: "credential.clear", input } }),
	);
	assert.throws(() =>
		decodePocketResponse(
			{
				...response,
				result: {
					kind: "credential",
					status: { version: 1, configured: true, secret: "MUST-NOT-ROUNDTRIP" },
				},
			},
			"rpc",
		),
	);
});
