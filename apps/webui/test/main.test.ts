import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";

test(
	"Pocket executable: explicit config starts real product and writes its owner link only to the designated private file",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		const config = join(m.f.root, "pocket.json"),
			owner = join(m.f.root, "owner-link.txt");
		await writeFile(
			config,
			JSON.stringify({
				runtime: { ...m.config, dataDir: m.f.dataDir + "/executable" },
				owner: "Operator",
				initial: [{ name: "CLI project", profile: "default" }],
				notifications: {
					endpointOrigins: ["https://fcm.googleapis.com"],
					subject: "mailto:synthetic@example.invalid",
				},
			}),
		);
		const child = spawn(
			process.execPath,
			[
				fileURLToPath(new URL("../dist/main.js", import.meta.url)),
				"--config",
				config,
				"--owner-file",
				owner,
				"--control-stdin",
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		let stdout = "",
			stderr = "";
		child.stdout.on("data", (chunk) => (stdout += String(chunk)));
		child.stderr.on("data", (chunk) => (stderr += String(chunk)));
		const exited = new Promise<number | null>((resolve, reject) => {
			child.once("exit", resolve);
			child.once("error", reject);
		});
		try {
			const deadline = Date.now() + 10000;
			while (!stdout.includes("\n") && child.exitCode === null && Date.now() < deadline)
				await new Promise((r) => setTimeout(r, 30));
			assert.ok(stdout.includes("\n"), stderr);
			const endpoint = JSON.parse(stdout.split("\n")[0]!) as { origin: string; serverId: string };
			const allowed = new URL(endpoint.origin);
			if (
				allowed.protocol !== "http:" ||
				allowed.hostname !== "127.0.0.1" ||
				!allowed.port ||
				allowed.username ||
				allowed.password ||
				allowed.pathname !== "/" ||
				allowed.search ||
				allowed.hash
			)
				throw new Error("Owned Pocket child loopback address required");
			assert.equal(allowed.origin, endpoint.origin);
			const link = new URL((await readFile(owner, "utf8")).trim());
			assert.equal(link.origin, endpoint.origin);
			const token = new URLSearchParams(link.hash.slice(1)).get("signin");
			assert.ok(token);
			assert.equal(stdout.includes(token), false);
			assert.equal(stderr.includes(token), false);
			assert.equal(stdout.includes(m.config.apiKey), false);
			const page = await fetch(allowed);
			assert.equal(page.status, 200);
			assert.match(await page.text(), /Pakka-Pocket/);
			const login = await fetch(endpoint.origin + "/pocket/exchange", {
				method: "POST",
				headers: { Origin: endpoint.origin, "Content-Type": "application/json" },
				body: JSON.stringify({ kind: "session", token }),
			});
			assert.equal(login.status, 200);
			const cookies = login.headers
				.getSetCookie()
				.map((value) => value.split(";")[0])
				.join("; ");
			const requestId = crypto.randomUUID();
			const devices = await fetch(endpoint.origin + "/pocket/rpc", {
				method: "POST",
				headers: {
					Origin: endpoint.origin,
					"Content-Type": "application/json",
					Cookie: cookies,
					"X-Pakka-CSRF": /pakka_csrf=([^;]+)/.exec(cookies)![1]!,
				},
				body: JSON.stringify({ version: 2, requestId, command: { op: "list" } }),
			});
			assert.equal(devices.status, 200);
			child.stdin.end("stop\n");
			assert.equal(await exited, 0, stderr);
			assert.equal(m.f.requests.length, 0);
		} finally {
			child.kill();
			await exited;
			await m.f.close();
		}
	},
);

test(
	"Pocket executable: unknown configuration, unsafe proxy shortcut and existing owner file fail before storage or provider effects",
	{ timeout: 15000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		try {
			for (const [index, extra] of [
				{ unknownSetting: true },
				{ transport: { trustProxy: true } },
				{ owner: "" },
				{},
			].entries()) {
				const dataDir = join(m.f.dataDir, "rejected-" + index),
					config = join(m.f.root, "bad-" + index + ".json"),
					owner = join(m.f.root, "bad-owner-" + index + ".txt");
				await writeFile(
					config,
					JSON.stringify({ runtime: { ...m.config, dataDir }, owner: "Operator", ...extra }),
				);
				if (index === 3) await writeFile(owner, "EXISTING-OWNER-CANARY");
				const result = spawnSync(
					process.execPath,
					[
						fileURLToPath(new URL("../dist/main.js", import.meta.url)),
						"--config",
						config,
						"--owner-file",
						owner,
					],
					{ encoding: "utf8", timeout: 5000 },
				);
				assert.equal(result.status, 1);
				assert.equal(result.stdout, "");
				assert.equal(result.stderr.includes(m.config.apiKey), false);
				await assert.rejects(access(dataDir), { code: "ENOENT" });
				if (index === 3) assert.equal(await readFile(owner, "utf8"), "EXISTING-OWNER-CANARY");
			}
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.f.close();
		}
	},
);
