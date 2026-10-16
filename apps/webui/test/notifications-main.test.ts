import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";

test(
	"Pocket executable notification bounds: malformed push authority is rejected before storage or provider effects",
	{ timeout: 15000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		try {
			for (const [index, notifications] of [
				{ endpointOrigins: ["http://127.0.0.1"] },
				{ endpointOrigins: ["https://fcm.googleapis.com"], actorId: "forged" },
			].entries()) {
				const dataDir = join(m.f.root, `invalid-notification-${index}`);
				const config = join(m.f.root, `invalid-notification-${index}.json`);
				await writeFile(
					config,
					JSON.stringify({ runtime: { ...m.config, dataDir }, owner: "Owner", notifications }),
				);
				const result = spawnSync(
					process.execPath,
					[
						fileURLToPath(new URL("../dist/main.js", import.meta.url)),
						"--config",
						config,
						"--owner-file",
						join(m.f.root, `never-owner-${index}.txt`),
					],
					{ encoding: "utf8", timeout: 5000 },
				);
				assert.equal(result.status, 1, result.stderr);
				assert.equal(result.stdout, "");
				assert.doesNotMatch(result.stderr, new RegExp(m.config.apiKey));
				await assert.rejects(access(dataDir), { code: "ENOENT" });
			}
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);
