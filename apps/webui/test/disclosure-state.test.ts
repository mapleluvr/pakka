import { test } from "node:test";
import assert from "node:assert/strict";
import { DisclosureState } from "../web/disclosure-state.js";

const target = {
	sessionId: "s",
	conversationId: "2",
	incarnation: "original",
	key: "catalog",
	profile: "default",
};

test("disclosure state: virtualization may unmount a card while its full resource-scoped expansion survives", () => {
	let personId = "a";
	const state = new DisclosureState({ scope: () => ({ serverId: "server", personId }) });
	state.set(target, "call:source:original", true);
	assert.equal(state.get(target, "call:source:original"), true);
	assert.equal(state.get({ ...target, sessionId: "another" }, "call:source:original"), false);
	assert.equal(state.get({ ...target, incarnation: "replacement" }, "call:source:original"), false);
	personId = "b";
	assert.equal(state.get(target, "call:source:original"), false);
	personId = "a";
	assert.equal(
		state.get(target, "call:source:original"),
		false,
		"scope retirement discards the earlier expansion map",
	);
});

test("disclosure state: metadata is byte-LRU bounded and contains only expansion identity, not body content", () => {
	const state = new DisclosureState({
		scope: () => ({ serverId: "server", personId: "person" }),
		maxBytes: 1024,
	});
	for (let index = 0; index < 1000; index++) state.set(target, "call:" + index, true);
	assert.ok(state.metrics().retainedBytes <= 1024);
	assert.equal(state.get(target, "call:0"), false);
	assert.equal(state.get(target, "call:999"), true);
	state.set(target, "call:999", false);
	assert.equal(state.get(target, "call:999"), false);
	state.clear();
	assert.equal(state.metrics().retainedBytes, 0);
});
