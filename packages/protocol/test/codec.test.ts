/// <reference types="node" />
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodeRequest, decodeResponse } from "../src/index.ts";

const ref = {
	key: "peer",
	sessionId: "session-one",
	conversationId: "conversation-one",
	incarnation: "incarnation-one",
	profile: "default",
};
const send = {
	version: 1,
	requestId: "rpc-1",
	command: { op: "send", target: ref, input: { requestId: "delivery-1", text: "HELLO", mode: "prompt" } },
};

test("M5 protocol: accepted wire data is detached/frozen and cannot mutate source identity", () => {
	const decoded = decodeRequest(send);
	assert.deepEqual(decoded, send);
	assert.notEqual(decoded, send);
	assert.ok(Object.isFrozen(decoded));
	send.command.input.text = "MUTATED";
	assert.equal(decoded.command.op, "send");
	if (decoded.command.op === "send") assert.equal(decoded.command.input.text, "HELLO");
	send.command.input.text = "HELLO";
});
test("M5 protocol: version, extra authority fields, malformed references and nonfinite input are refused", () => {
	for (const value of [
		{ ...send, version: 2 },
		{ ...send, principal: "operator" },
		{ ...send, command: { ...send.command, owner: "operator" } },
		{ ...send, command: { ...send.command, input: { ...send.command.input, source: ref } } },
		{ ...send, command: { ...send.command, target: { ...ref, incarnation: "" } } },
		{ ...send, command: { op: "spawn", key: "agent", profile: "default", lifetime: "temporary" } },
		{
			...send,
			command: { op: "configure", target: ref, profile: "default", endpoint: "https://unapproved.invalid" },
		},
		{ ...send, requestId: Infinity },
		JSON.parse('{"version":1,"requestId":"rpc","command":{"op":"hello","__proto__":{}}}'),
	])
		assert.throws(() => decodeRequest(value), /protocol|request|schema|version|invalid/i);
});
test("M5 protocol: response correlates request ID and validates nested receipts before claiming success", () => {
	const reply = {
		version: 1,
		requestId: "rpc-1",
		serverId: "server-one",
		result: {
			kind: "receipt",
			receipt: {
				id: "receipt-one",
				requestId: "delivery-1",
				principal: "alice",
				source: null,
				target: ref,
				status: "done",
				entryId: "12",
			},
		},
	};
	assert.deepEqual(decodeResponse(reply, "rpc-1"), reply);
	assert.throws(() => decodeResponse(reply, "rpc-foreign"), /identity|request|protocol/i);
	for (const receipt of [
		{ ...reply.result.receipt, status: "pending" },
		{ ...reply.result.receipt, target: { ...ref, sessionId: "" } },
		{ ...reply.result.receipt, entryId: { forged: true } },
		{ ...reply.result.receipt, apiKey: "NEVER-EXPOSE-SECRET" },
	])
		assert.throws(
			() => decodeResponse({ ...reply, result: { kind: "receipt", receipt } }, "rpc-1"),
			/protocol|schema|invalid|receipt/i,
		);
});
test("M5 protocol: logical member key remains separate from opaque catalog reference key", () => {
	const reply = {
		version: 1,
		requestId: "snapshot",
		serverId: "server-one",
		result: {
			kind: "snapshot",
			sessionId: "session-one",
			namespace: "members",
			version: 5,
			phase: "active",
			members: [
				{
					key: "peer",
					ref: { ...ref, key: "catalog-controlled-ref" },
					owner: "bob",
					lifetime: "persistent",
					phase: "active",
				},
			],
		},
	};
	assert.deepEqual(decodeResponse(reply, "snapshot"), reply);
});
test("M5 protocol: text/body/depth bounds refuse before routing rather than truncating input", () => {
	assert.throws(
		() =>
			decodeRequest({
				...send,
				command: { ...send.command, input: { ...send.command.input, text: "x".repeat(65537) } },
			}),
		/invalid|limit|size|protocol/i,
	);
	assert.throws(
		() =>
			decodeRequest({
				...send,
				command: { ...send.command, input: { ...send.command.input, text: "界".repeat(65536) } },
			}),
		/limit|size|protocol/i,
	);
	let deep: unknown = {};
	for (let i = 0; i < 40; i++) deep = { nested: deep };
	assert.throws(() => decodeRequest(deep), /depth|limit|invalid|protocol/i);
});
