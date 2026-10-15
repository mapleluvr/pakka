import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";

// Executable configuration is explicitly trusted local code; refusal/error must never be mistaken for rollback or trigger a retry.
test(
	"Pocket ESM configuration: finite source selection, malformed exports, opaque failures and redacted output",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		try {
			const entry = fileURLToPath(new URL("../dist/main.js", import.meta.url)),
				marker = join(m.f.root, "entered.txt");
			for (const [index, spec] of [
				{ name: "relative.mjs", source: "throw new Error('MUST-NOT-IMPORT');", relative: true },
				{ name: "wrong.js", source: "throw new Error('MUST-NOT-IMPORT');" },
				{ name: "large.mjs", source: " ".repeat(131073) + "throw new Error('MUST-NOT-IMPORT');" },
				{ name: "empty.mjs", source: "export default null;" },
				{ name: "unknown.mjs", source: "export default {owner:'Owner',runtime:{},unknownOption:true};" },
				{
					name: "opaque.mjs",
					source: `import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(marker)},'entry\\n');throw new Error('OPAQUE-SECRET-CANARY');`,
				},
			].entries()) {
				const path = join(m.f.root, spec.name),
					owner = join(m.f.root, "refused-owner-" + index + ".txt");
				await writeFile(path, spec.source);
				const result = spawnSync(
					process.execPath,
					[entry, "--config-module", spec.relative ? spec.name : path, "--owner-file", owner],
					{ encoding: "utf8", timeout: 5000, cwd: m.f.root },
				);
				assert.equal(result.status, 1);
				assert.equal(result.stdout, "");
				assert.match(result.stderr, /unconfirmed/);
				assert.equal(result.stderr.includes("OPAQUE-SECRET-CANARY"), false);
				assert.equal(result.stderr.includes(m.config.apiKey), false);
				await assert.rejects(access(owner), { code: "ENOENT" });
				if (index < 5) await assert.rejects(access(marker), { code: "ENOENT" });
			}
			assert.equal(
				await readFile(marker, "utf8"),
				"entry\n",
				"an opaque import failure does not roll back its effect or automatically re-enter the module",
			);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.f.close();
		}
	},
);
