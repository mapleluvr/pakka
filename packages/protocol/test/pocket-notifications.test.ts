import { test } from "node:test";
import { strict as assert } from "node:assert";
import { POCKET_VERSION, decodePocketRequest, decodePocketResponse } from "../src/pocket.ts";
import {
	decodeWebUiCommand,
	decodeWebUiResult,
	decodeNotificationWake,
	decodeNotificationEvent,
	notificationIntent,
} from "../src/webui.ts";
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
test("WebUI notification recovery and worker protocol: exact originals and closed private event boundaries", () => {
	const original = {
		op: "notification.preferences" as const,
		target,
		input: { requestId: "preference", preferences: { chat: false } },
	};
	const query = { op: "notification.lookup", original };
	assert.deepEqual(decodeWebUiCommand(query), query);
	const status = { publicKey: subscription.keys.p256dh, preferences: { ...prefs, chat: false }, devices: [] };
	const result = { kind: "notification-operation", actorId: "person", original, status };
	assert.deepEqual(decodeWebUiResult(result), result);
	assert.deepEqual(decodeWebUiResult({ ...result, status: null }), { ...result, status: null });
	assert.throws(() =>
		decodeWebUiCommand({
			...query,
			original: { ...original, input: { ...original.input, actorId: "forged" } },
		}),
	);
	assert.throws(() => decodeWebUiCommand({ ...query, original: { op: "notification.status", target } }));
	assert.throws(() => decodeWebUiResult({ ...result, status: { ...status, preferences: prefs } }));
	assert.throws(() => decodeWebUiResult({ ...result, status: { ...status, privateKey: "PRIVATE" } }));
	assert.equal(
		notificationIntent(original),
		notificationIntent({
			...original,
			target: {
				profile: target.profile,
				incarnation: target.incarnation,
				conversationId: target.conversationId,
				sessionId: target.sessionId,
				key: target.key,
			},
		}),
	);
	const wake = { eventId: "d".repeat(64), deviceId: "device" };
	assert.deepEqual(decodeNotificationWake(wake), wake);
	for (const invalid of [
		{ ...wake, preview: "PRIVATE" },
		{ ...wake, url: "/outside" },
		{ ...wake, eventId: "malformed" },
		{ ...wake, deviceId: "INVALID ID" },
	])
		assert.throws(() => decodeNotificationWake(invalid));
	const event = { id: wake.eventId, kind: "done", preview: "AUTHORIZED-UPDATE", target, createdAt: 1 };
	assert.deepEqual(decodeNotificationEvent(event), event);
	for (const invalid of [
		{ ...event, url: "/outside" },
		{ ...event, preview: "x".repeat(513) },
		{ ...event, kind: "forged" },
		{ ...event, target: { ...target, extra: true } },
		{ ...event, createdAt: -1 },
	])
		assert.throws(() => decodeNotificationEvent(invalid));
});

test("WebUI notification protocol: finite device controls cannot select a person, content or network authority", () => {
	for (const command of [
		{ op: "notification.status", target },
		{ op: "notification.subscribe", target, input: { requestId: "register", subscription } },
		{ op: "notification.unsubscribe", target, input: { requestId: "off", deviceId: "device" } },
		{ op: "notification.preferences", target, input: { requestId: "prefs", preferences: { chat: false } } },
	])
		assert.deepEqual(
			decodePocketRequest({ version: POCKET_VERSION, requestId: "rpc", command }).command,
			command,
		);
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
				version: POCKET_VERSION,
				requestId: "rpc",
				command: { op: "notification.subscribe", target, input },
			}),
		);
	const response = {
		version: POCKET_VERSION,
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
			version: POCKET_VERSION,
			requestId: "rpc",
			command: {
				op: "notification.preferences",
				target,
				input: { requestId: "prefs", preferences: { chat: false, actorId: "forged" } },
			},
		}),
	);
});
