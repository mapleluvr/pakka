import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodeManifest, decodeValue } from "../src/extension.ts";

const empty = { type: "object", properties: {}, required: [] } as const;
export const manifest = {
	api: 1,
	id: "sample",
	version: "1.0.0",
	title: "Sample",
	facets: { backend: "backend.mjs", webui: { entry: "index.js", publicDir: "web" } },
	actions: [
		{
			id: "status",
			version: 1,
			scope: "app",
			permission: "read",
			effect: "read",
			timeoutMs: 1000,
			input: empty,
			output: {
				type: "object",
				properties: { text: { type: "string", maxLength: 128 } },
				required: ["text"],
			},
		},
	],
	commands: [{ id: "status", title: "Sample status", slash: "sample", action: "status" }],
	interfaces: [
		{
			id: "settings",
			title: "Sample settings",
			slot: "settings",
			scope: "app",
			export: "Settings",
			navigation: true,
		},
	],
} as const;

test("Extension contract: GUI-only registration is inert, closed and frozen without backend/model requirements", () => {
	const value = decodeManifest({
		api: 1,
		id: "clock",
		version: "1.0.0",
		title: "Clock",
		facets: { webui: { entry: "clock.js", publicDir: "web" } },
		interfaces: [
			{ id: "clock", title: "Clock", slot: "page", scope: "app", export: "Clock", navigation: true },
		],
		actions: [],
		commands: [{ id: "open", title: "Open clock", slash: "clock", interface: "clock" }],
	});
	assert.equal(value.id, "clock");
	assert.equal(Object.isFrozen(value.interfaces), true);
	assert.equal(value.facets.backend, undefined);
	assert.equal(value.commands[0]?.interface, "clock");
	assert.throws(() =>
		decodeManifest({ ...value, commands: [{ ...value.commands[0], interface: "absent" }] }),
	);
	assert.throws(() => decodeManifest({ ...value, runtime: {} }));
});

test("Extension contract: unsafe paths, unbounded schemas and missing command handlers cannot become registrations", () => {
	assert.equal(decodeManifest(manifest).commands[0]?.action, "status");
	for (const changed of [
		{ ...manifest, api: 99 },
		{ ...manifest, id: "../outside" },
		{ ...manifest, facets: { webui: { entry: "../private.js", publicDir: "web" } } },
		{ ...manifest, commands: [{ ...manifest.commands[0], action: "absent" }] },
		{ ...manifest, commands: [...manifest.commands, manifest.commands[0]] },
		{ ...manifest, actions: [{ ...manifest.actions[0], input: { type: "string" } }] },
		{ ...manifest, actions: [{ ...manifest.actions[0], timeoutMs: 0 }] },
		{ ...manifest, interfaces: [{ ...manifest.interfaces[0], slot: "global-store" }] },
	])
		assert.throws(() => decodeManifest(changed));
});

test("Extension contract: per-action finite input rejects unknown fields and oversized/nested non-JSON values", () => {
	const schema = {
		type: "object",
		properties: {
			count: { type: "integer", minimum: 0, maximum: 3 },
			labels: { type: "array", maxItems: 2, items: { type: "string", maxLength: 8 } },
		},
		required: ["count"],
	} as const;
	assert.deepEqual(decodeValue(schema, { count: 2, labels: ["a"] }), { count: 2, labels: ["a"] });
	for (const value of [
		{ count: 4 },
		{ count: 0.5 },
		{ count: NaN },
		{ count: 1, grant: "admin" },
		{ count: 1, labels: ["123456789"] },
		{ count: 1, labels: ["a", "b", "c"] },
		Object.assign(Object.create({ count: 1 }), { labels: [] }),
	])
		assert.throws(() => decodeValue(schema, value));
});
