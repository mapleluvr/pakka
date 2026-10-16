import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodePocketRequest, decodePocketResponse } from "../src/pocket.ts";
const target = {
	key: "main",
	sessionId: "session",
	conversationId: "conversation",
	incarnation: "incarnation",
	profile: "default",
};
const subscription = {
	endpoint: "https://fcm.googleapis.com/push/test",
	keys: { p256dh: "B" + "x".repeat(86), auth: "x".repeat(22) },
};
const prefs = { done: true, approval: true, chat: true, mention: true };
test("Pocket notification protocol: finite device controls cannot select a person, content or network authority", () => {
	for (const command of [
		{ op: "notification.status", target },
		{ op: "notification.subscribe", target, input: { requestId: "register", subscription } },
		{ op: "notification.unsubscribe", target, input: { requestId: "off", deviceId: "device" } },
		{ op: "notification.preferences", target, input: { requestId: "prefs", preferences: { chat: false } } },
	])
		assert.deepEqual(decodePocketRequest({ version: 2, requestId: "rpc", command }).command, command);
	for (const input of [
		{ requestId: "register", subscription, actorId: "forged" },
		{ requestId: "register", subscription: { ...subscription, endpoint: "http://127.0.0.1/private" } },
		{
			requestId: "register",
			subscription: { ...subscription, keys: { ...subscription.keys, auth: "short" } },
		},
		{ requestId: "register", subscription, allowedOrigin: "https://forged.invalid" },
	])
		assert.throws(() =>
			decodePocketRequest({
				version: 2,
				requestId: "rpc",
				command: { op: "notification.subscribe", target, input },
			}),
		);
	const response = {
		version: 2,
		requestId: "rpc",
		serverId: "server",
		result: {
			kind: "notification",
			target,
			status: {
				publicKey: subscription.keys.p256dh,
				devices: [{ id: "device", subscriptionKey: "b".repeat(64) }],
				preferences: prefs,
			},
		},
	};
	assert.deepEqual(decodePocketResponse(response, "rpc"), response);
	assert.throws(() =>
		decodePocketResponse(
			{
				...response,
				result: { ...response.result, status: { ...response.result.status, privateKey: "PRIVATE" } },
			},
			"rpc",
		),
	);
	assert.throws(() =>
		decodePocketRequest({
			version: 2,
			requestId: "rpc",
			command: {
				op: "notification.preferences",
				target,
				input: { requestId: "prefs", preferences: { chat: false, actorId: "forged" } },
			},
		}),
	);
});
