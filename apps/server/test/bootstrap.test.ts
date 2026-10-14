import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createClient } from "@pakka/client";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";

test(
	"M5 server executable: explicit trusted config boots real MAS and returns no model or bearer credentials",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture(),
			dir = await mkdtemp(join(process.env.PAKKA_TEST_ARTIFACTS ?? tmpdir(), "bootstrap-"));
		let child: ReturnType<typeof spawn> | undefined;
		try {
			const token = "local-server-bootstrap-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
			const file = join(dir, "server.json");
			await m.runtime.close();
			await writeFile(
				file,
				JSON.stringify({
					schema: "pakka.server.v1",
					runtime: m.config,
					mas: { namespace: "app", maxDeliveries: 8, maxPending: 2 },
					members: [{ key: "peer", owner: "operator" }],
					roles: [{ token, principal: "operator", sourceKey: null, grants: ["discover", "send", "observe"] }],
					http: { port: 0, origins: [] },
				}),
			);
			child = spawn(
				process.execPath,
				[resolve("apps/server/src/main.ts"), "--config", file, "--control-stdin"],
				{ stdio: ["pipe", "pipe", "pipe"] },
			);
			let stdout = "",
				stderr = "";
			const ready = await new Promise<{ endpoint: string; serverId: string }>((resolveReady, reject) => {
				child!.once("error", reject);
				child!.once("exit", () => reject(new Error("Server stopped before ready: " + stderr)));
				child!.stderr!.on("data", (chunk) => {
					stderr += chunk;
				});
				child!.stdout!.on("data", (chunk) => {
					stdout += chunk;
					if (stdout.includes("\n")) {
						try {
							resolveReady(JSON.parse(stdout.split("\n")[0]!));
						} catch {
							reject(new Error("Invalid ready envelope"));
						}
					}
				});
			});
			assert.equal(typeof ready.endpoint, "string");
			assert.equal(typeof ready.serverId, "string");
			const client = createClient({ endpoint: ready.endpoint, token });
			const snapshot = await client.reconnect();
			assert.equal(snapshot.members.length, 1);
			const admitted = await client.request({
				op: "send",
				target: snapshot.members[0]!.ref,
				input: { requestId: "bootstrap-input", text: "EXECUTABLE-SERVER-REAL-INPUT" },
			});
			if (admitted.kind !== "receipt") assert.fail("No real admission");
			const done = await client.request({ op: "wait", id: admitted.receipt.id });
			if (done.kind !== "receipt") assert.fail("No receipt");
			assert.equal(done.receipt.status, "done");
			assert.equal(m.f.requests.length, 1);
			assert.ok(!stdout.includes(token));
			assert.ok(!stderr.includes(token));
			assert.ok(!stdout.includes("local-only"));
			assert.ok(!stderr.includes("local-only"));
		} finally {
			// Only this owned test process enables the explicit stdin control; no public RPC shutdown.
			if (child && child.exitCode === null) {
				const exit = new Promise<void>((resolveExit) => child!.once("exit", () => resolveExit()));
				child.stdin!.end("stop\n");
				await exit;
				assert.equal(child.exitCode, 0);
			}
			await m.close();
			if (!process.env.PAKKA_TEST_ARTIFACTS) await rm(dir, { recursive: true, force: true });
		}
	},
);
