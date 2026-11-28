import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { decodeTarget } from "@pakka/protocol/extension-rpc";
import { isRecord, type ExtensionJson } from "@pakka/protocol/extensions";
import type { AgentRef } from "@pakka/protocol/pocket";
import { loginHttpSession } from "./fixtures/http-session.ts";
import { defaultWebUiArtifact } from "../src/default-frontend.ts";

// The generic executable consumes an operator-owned ESM composition through public exports; it contains no MAS route/import.
test(
	"WebUI executable: trusted ESM root composes the real optional Agent and WebUI facets",
	{ timeout: 30000 },
	async (t) => {
		const m = await runtimeFixture({}, undefined, (payload) =>
			payload.messages.at(-1)?.role === "tool"
				? { text: "CLI-NATIVE-DONE" }
				: { tool: "mas_spawn", args: { key: "cli-child", profile: "plain", lifetime: "persistent" } },
		);
		await m.runtime.close();
		const config = join(m.f.root, "pocket-config.mjs"),
			owner = join(m.f.root, "owner.txt");
		const source = `import {openProductModels} from ${JSON.stringify(import.meta.resolve("@pakka/webui"))};\nconst modelConfiguration=await openProductModels(${JSON.stringify({ cwd: m.f.cwd, agentDir: join(m.f.root, "empty-pi") })});\nimport {createMas} from ${JSON.stringify(import.meta.resolve("@pakka/mas"))};\nimport {createMasProfilePacks} from ${JSON.stringify(import.meta.resolve("@pakka/mas-devpack/agent"))};\nimport {masExtensionRoot,masWorkbenchService} from ${JSON.stringify(import.meta.resolve("@pakka/mas-devpack/backend"))};\nlet mas;const pack=createMasProfilePacks({profiles:{team:["spawn"]}},()=>mas).get("team");\nexport default {modelConfiguration,frontend:${JSON.stringify(defaultWebUiArtifact())},runtime:{...${JSON.stringify({ ...m.config, dataDir: join(m.f.root, "cli-board-data") })},profiles:[{id:"team",tools:pack.tools,systemPrompt:pack.instructions},{id:"plain",tools:[]}]},owner:"Owner",profiles:["plain"],initial:[{name:"Ordinary",profile:"plain"}],extensions:[{root:masExtensionRoot}],extensionServices:async context=>{mas=await createMas({runtime:context.runtime,namespace:"cli.board",maxDeliveries:16,maxPending:4});await mas.bootstrap([{key:"coordinator",owner:context.ownerId,profile:"team"}]);await mas.activate();return{mas:masWorkbenchService({...context,mas})};}};\n`;
		await writeFile(config, source);
		const child = spawn(
			process.execPath,
			[
				fileURLToPath(new URL("../dist/main.js", import.meta.url)),
				"--config-module",
				config,
				"--owner-file",
				owner,
				"--control-stdin",
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		let stdout = "",
			stderr = "";
		child.stdout.on("data", (part) => {
			stdout += String(part);
		});
		child.stderr.on("data", (part) => {
			stderr += String(part);
		});
		const exited = new Promise<number | null>((resolve, reject) => {
			child.once("exit", resolve);
			child.once("error", reject);
		});
		try {
			const deadline = Date.now() + 10000;
			while (!stdout.includes("\n") && child.exitCode === null && Date.now() < deadline)
				await new Promise((resolve) => setTimeout(resolve, 30));
			assert.ok(stdout.includes("\n"), stderr);
			let address: unknown;
			try {
				address = JSON.parse(stdout.split("\n")[0]!);
			} catch {
				throw new Error("Invalid owned child address");
			}
			assert.ok(
				address && typeof address === "object" && "origin" in address && typeof address.origin === "string",
			);
			const origin = new URL(address.origin);
			assert.equal(origin.protocol, "http:");
			assert.equal(origin.hostname, "127.0.0.1");
			assert.ok(origin.port);
			assert.equal(origin.origin, address.origin);
			const link = (await readFile(owner, "utf8")).trim();
			assert.equal(new URL(link).origin, origin.origin);
			const token = new URLSearchParams(new URL(link).hash.slice(1)).get("session");
			assert.ok(token);
			const client = await loginHttpSession(origin.origin, token);
			const listed = (await client.extensions({ op: "list" })).decoded;
			assert.ok("result" in listed && listed.result.kind === "registrations");
			const backend = listed.result.registrations.find(
				(row) => row.manifest.id === "mas-devpack" && row.facet === "backend",
			);
			const ui = listed.result.registrations.find(
				(row) => row.manifest.id === "mas-devpack" && row.facet === "webui",
			);
			assert.ok(backend && ui);
			assert.equal(ui.manifest.facets.webui?.runtime, "react19-astryx0.7.15");
			async function call(action: string, input: ExtensionJson, target?: AgentRef) {
				const reply = (
					await client.extensions({
						op: "call",
						call: {
							extension: "mas-devpack",
							generation: backend!.generation,
							action,
							input,
							target,
							requestId: crypto.randomUUID(),
						},
					})
				).decoded;
				assert.ok("result" in reply && reply.result.kind === "operation");
				assert.equal(reply.result.operation.state, "done");
				assert.ok(isRecord(reply.result.operation.value));
				return reply.result.operation.value;
			}
			const board = await call("view", {});
			assert.ok(Array.isArray(board.members));
			const coordinator = board.members.find((row) => isRecord(row) && row.key === "coordinator");
			assert.ok(isRecord(coordinator));
			const ref = decodeTarget(coordinator.ref);
			const sent = await call("send", { text: "CREATE-CLI-CHILD" }, ref);
			assert.equal(typeof sent.id, "string");
			await t.waitFor(
				async () => assert.equal((await call("receipt", { id: sent.id }, ref)).status, "done"),
				{ timeout: 10000, interval: 20 },
			);
			const after = await call("view", {});
			assert.ok(
				Array.isArray(after.members) && after.members.some((row) => isRecord(row) && row.key === "cli-child"),
			);
			assert.equal(m.f.requests.length, 2);
			assert.match(JSON.stringify(m.f.requests[1]!), /cli-child/);
			assert.equal(stdout.includes(m.config.apiKey), false);
			assert.equal(stderr.includes(m.config.apiKey), false);
			assert.equal(stdout.includes(token), false);
			assert.equal(stderr.includes(token), false);
			child.stdin.end("stop\n");
			assert.equal(await exited, 0, stderr);
			assert.deepEqual(m.f.errors, []);
		} finally {
			child.kill();
			await exited;
			await m.f.close();
		}
	},
);
