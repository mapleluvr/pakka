import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

// Opaque bytes exercise metadata selection and integrity, not package installation.
function fixture(t: TestContext) {
	const root = mkdtempSync(join(realpathSync.native(tmpdir()), "pakka-patch-verifier-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const script = join(root, "scripts", "verify-durable-patch.mjs");
	mkdirSync(dirname(script), { recursive: true });
	copyFileSync(fileURLToPath(new URL("../../../scripts/verify-durable-patch.mjs", import.meta.url)), script);
	for (const version of ["1.0.3-pakka.1", "1.4.0-pakka.1"]) {
		const patch = join(root, "patches", "pi-durable", version);
		const vendor = join(root, "packages", "agent", "vendor");
		mkdirSync(patch, { recursive: true });
		mkdirSync(vendor, { recursive: true });
		const filename = `earendil-works-pi-durable-${version}.tgz`;
		const digest = (value: string) => createHash("sha256").update(value).digest("hex");
		writeFileSync(join(vendor, filename), version);
		writeFileSync(join(patch, "source.patch"), "source");
		writeFileSync(join(patch, "build-lock.json"), "lock");
		writeFileSync(
			join(patch, "artifact.json"),
			JSON.stringify({
				filename,
				sha256: digest(version),
				patchedVersion: version,
				sourcePatchSha256: digest("source"),
				buildLockSha256: digest("lock"),
			}),
		);
	}
	return {
		root,
		run: (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" }),
	};
}

test("Durable verifier keeps the production version as its default", (t) => {
	const f = fixture(t);
	const result = f.run();
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Verified pi-durable 1\.0\.3-pakka\.1/);
});

test("Durable verifier selects an explicitly requested patch version", (t) => {
	const result = fixture(t).run("1.4.0-pakka.1");
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Verified pi-durable 1\.4\.0-pakka\.1/);
});

test("Durable verifier detects tampering in the selected version independently", (t) => {
	const f = fixture(t);
	writeFileSync(join(f.root, "patches", "pi-durable", "1.4.0-pakka.1", "source.patch"), "tampered");
	assert.equal(f.run().status, 0);
	const result = f.run("1.4.0-pakka.1");
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /source\.patch does not match/);
});

test("Durable verifier rejects a patch version containing path traversal", (t) => {
	const result = fixture(t).run("../1.4.0-pakka.1");
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Invalid patch version/);
});
