import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { ownedBrowser } from "./browser.ts";

// The generic executable consumes an operator-owned ESM composition through public exports; it contains no MAS route/import.
test(
	"Pocket executable: trusted ESM root composes the real optional Agent and WebUI facets",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture({}, undefined, (payload) =>
			payload.messages.at(-1)?.role === "tool"
				? { text: "CLI-NATIVE-DONE" }
				: { tool: "mas_spawn", args: { key: "cli-child", profile: "plain", lifetime: "persistent" } },
		);
		await m.runtime.close();
		const config = join(m.f.root, "pocket-config.mjs"),
			owner = join(m.f.root, "owner.txt");
		const source = `import {createMas} from ${JSON.stringify(import.meta.resolve("@pakka/mas"))};\nimport {createMasProfilePacks} from ${JSON.stringify(import.meta.resolve("@pakka/mas-devpack/agent"))};\nimport {masExtensionRoot,masWorkbenchService} from ${JSON.stringify(import.meta.resolve("@pakka/mas-devpack/backend"))};\nlet mas;const pack=createMasProfilePacks({profiles:{team:["spawn"]}},()=>mas).get("team");\nexport default {runtime:{...${JSON.stringify({ ...m.config, dataDir: join(m.f.root, "cli-board-data") })},profiles:[{id:"team",tools:pack.tools,systemPrompt:pack.instructions},{id:"plain",tools:[]}]},owner:"Owner",profiles:["plain"],initial:[{name:"Ordinary",profile:"plain"}],extensions:[{root:masExtensionRoot}],extensionServices:async context=>{mas=await createMas({runtime:context.runtime,namespace:"cli.board",maxDeliveries:16,maxPending:4});await mas.bootstrap([{key:"coordinator",owner:context.ownerId,profile:"team"}]);await mas.activate();return{mas:masWorkbenchService({...context,mas})};}};\n`;
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
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
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
			browser = await ownedBrowser(join(m.f.root, "cli-board-browser"));
			const page = await browser.page(link);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-interface=mas-devpack-board]")');
			await page.click("[data-interface=mas-devpack-board]");
			await page.wait('document.querySelector("[data-member=coordinator]")');
			await page.click("[data-member=coordinator]");
			await page.wait('document.querySelector("textarea[name=masMessage]")');
			await page.type("textarea[name=masMessage]", "CREATE-CLI-CHILD");
			await page.click("[data-mas-send]");
			await page.wait('/done/.test(document.querySelector("[data-mas-receipt]")?.textContent)');
			await page.click("[data-interface=mas-devpack-board]");
			await page.wait('document.querySelector("[data-member=cli-child]")');
			assert.equal(m.f.requests.length, 2);
			assert.match(JSON.stringify(m.f.requests[1]!), /cli-child/);
			assert.equal(stdout.includes(m.config.apiKey), false);
			assert.equal(stderr.includes(m.config.apiKey), false);
			const token = new URLSearchParams(new URL(link).hash.slice(1)).get("signin");
			assert.ok(token);
			assert.equal(stdout.includes(token), false);
			assert.equal(stderr.includes(token), false);
			await browser.close();
			browser = undefined;
			child.stdin.end("stop\n");
			assert.equal(await exited, 0, stderr);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await browser?.close();
			child.kill();
			await exited;
			await m.f.close();
		}
	},
);
