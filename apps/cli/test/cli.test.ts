import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createMas } from "@pakka/mas";
import { createMasServer } from "../../server/src/http-server.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
const credential = "local-cli-connection-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
function cli(args: readonly string[]) {
	return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
		const child = spawn(process.execPath, [resolve("apps/cli/src/main.ts"), ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "",
			stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code) => resolveResult({ code, stdout, stderr }));
	});
}
test(
	"M5 CLI: actual process uses shared authenticated client for snapshot, creation and native message receipt",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture(),
			dir = await mkdtemp(join(process.env.PAKKA_TEST_ARTIFACTS ?? tmpdir(), "cli-"));
		let server: Awaited<ReturnType<typeof createMasServer>> | undefined;
		try {
			const mas = await createMas({ runtime: m.runtime, namespace: "cli", maxDeliveries: 8, maxPending: 2 });
			await mas.bootstrap([{ key: "root", owner: "operator" }]);
			await mas.activate();
			server = await createMasServer({
				mas,
				sessionId: m.runtime.view().sessionId,
				roles: [
					{
						token: credential,
						principal: "operator",
						source: null,
						grants: ["discover", "observe", "spawn", "send", "abort"],
					},
				],
			});
			const connection = join(dir, "connection.json"),
				command = join(dir, "command.json");
			await writeFile(connection, JSON.stringify({ endpoint: server.endpoint, token: credential }));
			const snapshot = await cli(["--connection", connection, "snapshot"]);
			assert.equal(snapshot.code, 0, snapshot.stderr);
			assert.equal(JSON.parse(snapshot.stdout).members.length, 1);
			await writeFile(command, JSON.stringify({ op: "spawn", key: "child", profile: "default" }));
			const created = await cli(["--connection", connection, "call", "--command", command]);
			assert.equal(created.code, 0, created.stderr);
			const member = JSON.parse(created.stdout).member;
			assert.equal(member.key, "child");
			await writeFile(
				command,
				JSON.stringify({
					op: "send",
					target: member.ref,
					input: { requestId: "cli-input", text: "CLI-REAL-HTTP" },
				}),
			);
			const sent = await cli(["--connection", connection, "call", "--command", command]);
			assert.equal(sent.code, 0, sent.stderr);
			const id = JSON.parse(sent.stdout).receipt.id;
			await writeFile(command, JSON.stringify({ op: "wait", id }));
			const waited = await cli(["--connection", connection, "call", "--command", command]);
			assert.equal(waited.code, 0, waited.stderr);
			assert.equal(JSON.parse(waited.stdout).receipt.status, "done");
			assert.equal(m.f.requests.length, 1);
			const foreign = await mas
				.connect({ principal: "peer", source: null, grants: ["spawn"] })
				.spawn({ key: "peer-owned" });
			await writeFile(command, JSON.stringify({ op: "abort", target: foreign.ref }));
			const denied = await cli(["--connection", connection, "call", "--command", command]);
			assert.equal(denied.code, 2, denied.stderr);
			assert.equal(JSON.parse(denied.stderr).outcome, "denied");
			assert.equal(m.f.requests.length, 1);
			assert.doesNotMatch(
				[snapshot, created, sent, waited, denied].map((result) => result.stdout + result.stderr).join(""),
				new RegExp(credential),
			);
		} finally {
			await server?.close();
			await m.close();
			if (!process.env.PAKKA_TEST_ARTIFACTS) await rm(dir, { recursive: true, force: true });
		}
	},
);
