import { test } from "node:test";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { decodePocketProduct } from "../src/main.ts";

const config = {
	owner: "Owner",
	runtime: {
		cwd: resolve("."),
		dataDir: resolve("artifacts/config-example"),
		endpoint: "http://127.0.0.1:1/v1",
		model: "local",
		apiKey: "local-test-only",
		limits: { maxConversations: 2, maxPrimaryAttempts: 2, maxAuxiliaryAttempts: 1 },
	},
};
test("Extension product config: explicit trusted roots/facets survive finite decoding; arbitrary runtime/service injection is refused", () => {
	const root = resolve("apps/webui/examples/hello");
	assert.deepEqual(decodePocketProduct({ ...config, extensions: [{ root, facets: ["webui"] }] }).extensions, [
		{ root, facets: ["webui"] },
	]);
	for (const extensions of [
		[{ root: "../relative" }],
		[{ root, services: {} }],
		[{ root, facets: ["unknown"] }],
		[{ root, facets: ["webui", "webui"] }],
		Array.from({ length: 65 }, () => ({ root })),
	])
		assert.throws(() => decodePocketProduct({ ...config, extensions }));
	assert.throws(() => decodePocketProduct({ ...config, extensionServices: {} }));
});
