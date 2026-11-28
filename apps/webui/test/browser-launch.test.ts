import { test } from "node:test";
import { strict as assert } from "node:assert";
import { chmod, copyFile, mkdir, mkdtemp, rm, symlink, writeFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { browserExecutable } from "./browser.ts";

// Test-only discovery must not silently replace a broken explicit choice or skip mandatory browsers.
test("Browser discovery: explicit executable is canonical and a broken override never falls back", async () => {
	const root = await mkdtemp(join(tmpdir(), "pakka-browser-discovery-"));
	try {
		await symlink(
			dirname(process.execPath),
			join(root, "native"),
			process.platform === "win32" ? "junction" : "dir",
		);
		assert.equal(
			await browserExecutable({
				PAKKA_TEST_CHROME: join(root, "native", basename(process.execPath)),
				PATH: root,
			}),
			await realpath(process.execPath),
		);
		await assert.rejects(
			browserExecutable({ PAKKA_TEST_CHROME: join(root, "missing"), PATH: root }),
			/PAKKA_TEST_CHROME/,
		);
		await assert.rejects(browserExecutable({ PAKKA_TEST_CHROME: "chromium", PATH: root }), /absolute/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("Browser discovery: PATH finds a real executable and rejects a nonexecutable candidate", async () => {
	const root = await mkdtemp(join(tmpdir(), "pakka-browser-discovery-"));
	try {
		await mkdir(join(root, "chromium"));
		const candidate = join(root, "google-chrome");
		await copyFile(process.execPath, candidate);
		await chmod(candidate, 0o700);
		assert.equal(await browserExecutable({ PATH: root }, "linux"), await realpath(candidate));
		await rm(join(root, "google-chrome"));
		if (process.platform === "win32") await mkdir(join(root, "google-chrome"));
		else {
			await writeFile(join(root, "google-chrome"), "not executable");
			await chmod(join(root, "google-chrome"), 0o600);
		}
		await assert.rejects(browserExecutable({ PATH: root }, "linux"), /PAKKA_TEST_CHROME/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
