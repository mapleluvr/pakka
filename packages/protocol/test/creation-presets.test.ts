import { test } from "node:test";
import assert from "node:assert/strict";
import { decodePocketResponse } from "../src/pocket.ts";

// A model directory is not an execution-preset allowlist; old responses still decode.
test("creation defaults carry a bounded distinct preset list independently of model choices", () => {
	const defaults = { profile: "default", model: "", cwd: "/workspace", choices: [] };
	const response = (value: object) => ({
		version: 2,
		requestId: "defaults",
		serverId: "server-a",
		result: { kind: "sessions", sessions: [], canCreate: true, defaults: value },
	});
	for (const value of [defaults, { ...defaults, presets: ["default", "read-only"] }]) {
		const message = response(value);
		assert.deepEqual(decodePocketResponse(message, "defaults"), message);
	}
	for (const presets of [
		null,
		"default",
		[],
		["read-only"],
		["default", "default"],
		["default", {}],
		["default", ...Array.from({ length: 64 }, (_, n) => `preset-${n}`)],
	])
		assert.throws(() => decodePocketResponse(response({ ...defaults, presets }), "defaults"));
});
