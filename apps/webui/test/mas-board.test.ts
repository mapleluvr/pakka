import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { Mas } from "@pakka/mas";
import type { ConversationRef } from "@pakka/agent";
import { createMas } from "@pakka/mas";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { text } from "../../../packages/agent/test/fixture.ts";
import { createMasProfilePacks } from "@pakka/mas-devpack/agent";
import { masWorkbenchService } from "../../../packages/mas-devpack/src/backend.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

// Replacing the plugin with a hardcoded shell route, a simulated spawn or an unscoped read breaks this installed-facet path.
test(
	"MAS Board: public plugin observes real model-created child and human controls retain its native lifetime/owner",
	{ timeout: 60000 },
	async () => {
		let mas: Mas | undefined, peer: ConversationRef | undefined;
		const pack = createMasProfilePacks(
			{ profiles: { team: ["discover", "spawn", "send", "reply", "steer"] } },
			() => mas,
		).get("team")!;
		const m = await runtimeFixture(
			{
				profiles: [
					{ id: "team", tools: pack.tools, systemPrompt: pack.instructions },
					{ id: "plain", tools: [] },
				],
			},
			undefined,
			(payload) => {
				if (payload.messages.at(-1)?.role === "tool" || text(payload).includes("HUMAN-BOARD-REPLY"))
					return { text: "BOARD-NATIVE-DONE" };
				if (text(payload).includes("SEND-PEER-BOARD"))
					return {
						tool: "mas_send",
						args: { target: peer, requestId: "native-peer", text: "REAL-INCOMING-FOR-REPLY" },
					};
				if (text(payload).includes("CREATE-BOARD-CHILD"))
					return {
						tool: "mas_spawn",
						args: {
							location: "current-session",
							key: "board-child",
							profile: "plain",
							lifetime: "persistent",
						},
					};
				return { text: "BOARD-NATIVE-DONE" };
			},
		);
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "board-product") },
				owner: "Owner",
				initial: [{ name: "Ordinary work", profile: "plain" }],
				profiles: ["plain"],
				extensions: [{ root: resolve("packages/mas-devpack/dist") }],
				extensionServices: async (context) => {
					mas = await createMas({
						runtime: context.runtime,
						namespace: "board.team",
						maxDeliveries: 32,
						maxPending: 8,
					});
					await mas.bootstrap([{ key: "coordinator", owner: context.ownerId, profile: "team" }]);
					await mas.activate();
					return { mas: masWorkbenchService({ ...context, mas }) };
				},
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "board-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-interface=mas-devpack-board]")');
			await page.click("[data-interface=mas-devpack-board]");
			await page.wait('document.querySelector("[data-member=coordinator]")');
			assert.equal(m.f.requests.length, 0, "Activating a MAS member does not start model work");
			assert.deepEqual(
				await page.evaluate(
					`(()=>{const row=document.querySelector('[data-member=coordinator]');return {label:row.getAttribute('aria-label'),tone:row.classList.contains('available')};})()`,
				),
				{ label: "coordinator, Available, persistent", tone: true },
				"An idle active member exposes membership availability rather than running activity",
			);
			await page.click("[data-member=coordinator]");
			await page.wait('document.querySelector("textarea[name=masMessage]")');
			await page.type("textarea[name=masMessage]", "CREATE-BOARD-CHILD");
			await page.click("[data-mas-send]");
			await page.wait('document.querySelector("[data-mas-receipt]")?.textContent.includes("done")');
			assert.ok(mas);
			const child = (await mas.view()).members.find((row) => row.key === "board-child");
			assert.ok(child);
			assert.equal(child.lifetime, "persistent");
			assert.equal(m.f.requests.length, 2);
			assert.ok(
				m.f.requests[0]!.tools?.some(
					(row) =>
						!!row &&
						typeof row === "object" &&
						"function" in row &&
						!!row.function &&
						typeof row.function === "object" &&
						"name" in row.function &&
						row.function.name === "mas_spawn",
				),
			);
			peer = child.ref;
			const previous = await page.evaluate('document.querySelector("[data-mas-receipt]").textContent');
			await page.type("textarea[name=masMessage]", "SEND-PEER-BOARD");
			await page.click("[data-mas-send]");
			await page.wait(
				`document.querySelector("[data-mas-receipt]")?.textContent !== ${JSON.stringify(previous)} && document.querySelector("[data-mas-receipt]")?.textContent.includes("done")`,
			);
			await app.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 5);
			await page.click("[data-interface=mas-devpack-board]");
			await page.wait('document.querySelector("[data-member=board-child]")');
			await page.click("[data-member=board-child]");
			await page.wait('document.querySelector("[data-mas-reply]")');
			await page.type("textarea[name=masMessage]", "HUMAN-BOARD-REPLY");
			await page.click("[data-mas-reply]");
			await page.wait('document.querySelector("[data-mas-receipt]")?.textContent.includes("done")');
			assert.equal(m.f.requests.length, 6);
			await page.wait('document.querySelector("[data-mas-retire]")');
			const hit = await page.evaluate(
				`(()=>{const e=document.querySelector("[data-mas-retire]"),r=e.getBoundingClientRect(),p=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},hit:p?.outerHTML.slice(0,300),animations:document.getAnimations().map(a=>({playState:a.playState,effect:a.effect?.target?.className}))};})()`,
			);
			const evidence = join(
				process.env.PAKKA_TEST_ARTIFACTS ?? resolve("artifacts/pakka-pocket/p4"),
				"board-pointer",
			);
			await mkdir(evidence, { recursive: true });
			await writeFile(join(evidence, "before-retire.json"), JSON.stringify(hit, null, 2));
			await page.click("[data-mas-retire]");
			await page.wait('document.querySelector("[data-member-phase]")?.textContent==="retired"');
			assert.equal((await mas.view()).members.find((row) => row.key === "board-child")!.phase, "retired");
			assert.equal((await mas.view()).members.find((row) => row.key === "coordinator")!.phase, "active");
			assert.equal(m.f.requests.length, 6);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
