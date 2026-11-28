import { test } from "node:test";
import { strict as assert } from "node:assert";
import { decodeWebUiAssetManifest } from "../src/webui-assets.ts";

const hash = "fe2dbe555b76aa8561d0083d396c3273de7ddc3099798180bfa4a58aa55b85e6";
const manifest = {
	schema: 2,
	requires: { services: 3, workbench: 2, extensions: 3 },
	runtime: { id: "shared-ui", sdk: "0.1.0", packages: { react: "19.3.1" } },
	entry: "/",
	imports: {},
	styles: [],
	inlineStyleHashes: [hash],
	workers: [],
	files: [{ path: "index.html", url: "/", type: "text/html; charset=utf-8", sha256: "a".repeat(64) }],
};

test("frontend artifact carries only bounded exact inline-style hashes, not arbitrary CSP sources", () => {
	assert.deepEqual(decodeWebUiAssetManifest(manifest), manifest);
	assert.deepEqual(decodeWebUiAssetManifest({ ...manifest, inlineStyleHashes: [] }), {
		...manifest,
		inlineStyleHashes: [],
	});
	for (const inlineStyleHashes of [
		["'unsafe-inline'"],
		["https://styles.invalid"],
		[hash + "; script-src *"],
		[hash.toUpperCase()],
		[hash.slice(1)],
		[null],
		[hash, hash],
		Array.from({ length: 17 }, (_, i) => i.toString(16).padStart(64, "0")),
		{ source: hash },
	])
		assert.throws(() => decodeWebUiAssetManifest({ ...manifest, inlineStyleHashes }));
	assert.throws(() => decodeWebUiAssetManifest({ ...manifest, policy: "style-src *" }));
});

test("unsupported artifact versions cannot silently omit the required style policy", () => {
	const { inlineStyleHashes: _inlineStyleHashes, ...previous } = manifest;
	assert.throws(() => decodeWebUiAssetManifest({ ...previous, schema: 1 }));
	assert.throws(() => decodeWebUiAssetManifest({ ...manifest, schema: 3 }));
	assert.throws(() => decodeWebUiAssetManifest(previous));
});
