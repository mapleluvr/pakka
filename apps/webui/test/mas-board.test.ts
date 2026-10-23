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
			await page.wait('document.querySelector("[data-agent=coordinator] [data-activity-state=idle]")');
			assert.equal(m.f.requests.length, 0, "Activating a MAS member does not start model work");
			assert.deepEqual(
				await page.evaluate(
					`(()=>{const row=document.querySelector('[data-member=coordinator]');return {label:row.getAttribute('aria-label'),tone:row.closest('.graph-agent').classList.contains('available')};})()`,
				),
				{ label: "coordinator, Available, No activity yet", tone: true },
				"An idle active member exposes membership availability rather than running activity",
			);
			await page.click("[data-member=coordinator]");
			await page.click("[data-agent-details]");
			await page.click('[data-agent-controls="coordinator"]');
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
			await page.click('[aria-label="Close Agent controls"]');
			await page.wait(
				'!document.querySelector("textarea[name=masMessage]") && document.activeElement?.getAttribute("data-agent-controls") === "coordinator"',
			);
			await page.wait('document.querySelector("[data-member=board-child]")');
			await page.wait(
				'document.querySelector(".graph-edge.creation") && document.querySelector(".graph-edge.communication")',
			);
			assert.deepEqual(
				await page.evaluate(
					'({creation:document.querySelectorAll(".graph-edge.creation").length,communication:document.querySelectorAll(".graph-edge.communication").length})',
				),
				{ creation: 1, communication: 1 },
			);
			await page.click("[data-board-options]");
			await page.click('[data-board-layer="creation"]');
			await page.wait('document.querySelector(".graph-edge.creation") === null');
			await page.click('[data-board-layer="creation"]');
			await page.click(".graph-edge.communication .edge-count-button");
			await page.wait(
				'document.querySelector(".graph-history")?.textContent.includes("REAL-INCOMING-FOR-REPLY")',
			);
			await page.click("[data-hide-connection]");
			await page.click('[data-board-tab="relationships"]');
			await page.wait('document.querySelector(".graph-edge.communication") === null');
			await page.click("[data-board-options]");
			await page.click("[data-show-hidden-links]");
			await page.wait('document.querySelector(".graph-edge.communication") !== null');
			await page.click('[data-board-tab="history"]');
			await page.wait(
				'document.querySelector(".graph-history")?.textContent.includes("REAL-INCOMING-FOR-REPLY")',
			);
			await page.click('[data-board-tab="relationships"]');
			await page.click("[data-member=board-child]");
			await page.click("[data-agent-details]");
			await page.click('[data-hide-member-links="board-child"]');
			assert.equal(await page.evaluate('document.querySelectorAll(".graph-edge.communication").length'), 0);
			assert.equal(
				await page.evaluate('document.querySelectorAll(".graph-edge.creation").length'),
				1,
				"Hiding Agent communications retains proven creation lineage",
			);
			await page.click("[data-board-options]");
			await page.click("[data-show-hidden-links]");
			await page.wait('document.querySelector(".graph-edge.communication")');
			await page.click("[data-board-options]");
			await page.click('[data-agent-controls="board-child"]');
			await page.wait('document.querySelector("[data-mas-reply]")');
			await page.type("textarea[name=masMessage]", "HUMAN-BOARD-REPLY");
			await page.click("[data-mas-reply]");
			await page.wait('document.querySelector("[data-mas-receipt]")?.textContent.includes("done")');
			assert.equal(m.f.requests.length, 6);
			await page.click("[data-member-management]");
			await page.wait('document.querySelector("[data-mas-retire]")');
			const hit = await page.evaluate(
				`(()=>{const e=document.querySelector("[data-mas-retire]"),r=e.getBoundingClientRect(),p=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},hit:p?.outerHTML.slice(0,300),animations:document.getAnimations().map(a=>({playState:a.playState,effect:a.effect?.target?.className}))};})()`,
			);
			const evidence = join(
				process.env.PAKKA_TEST_ARTIFACTS ?? resolve("artifacts/pakka-webui/p4"),
				"board-pointer",
			);
			await mkdir(evidence, { recursive: true });
			await writeFile(join(evidence, "before-retire.json"), JSON.stringify(hit, null, 2));
			await page.click("[data-mas-retire]");
			await page.wait('document.querySelector("[data-mas-confirm-retire]")');
			assert.equal((await mas.view()).members.find((row) => row.key === "board-child")?.phase, "active");
			await page.click("[data-mas-confirm-retire]");
			await page.wait('document.querySelector("[data-member-phase]")?.textContent==="retired"');
			assert.equal((await mas.view()).members.find((row) => row.key === "board-child")!.phase, "retired");
			assert.equal((await mas.view()).members.find((row) => row.key === "coordinator")!.phase, "active");
			assert.equal(m.f.requests.length, 6);
			await page.click('[aria-label="Close Agent controls"]');
			await page.wait(
				'!document.querySelector("textarea[name=masMessage]") && document.activeElement?.getAttribute("data-agent-controls") === "board-child"',
			);
			await page.wait('document.querySelector("[data-member=board-child]")');
			await page.click("[data-member=board-child]");
			await page.click('[data-open-conversation="board-child"]');
			const childConversation = JSON.stringify(child.ref.conversationId);
			await page.wait(
				`Array.from(document.querySelectorAll("[data-conversation]")).some(row => row.dataset.conversation === ${childConversation} && row.getAttribute("aria-current") === "true")`,
			);
			await page.wait('document.querySelector("textarea[name=message]")');
			assert.equal(m.f.requests.length, 6, "Opening a MAS Conversation does not replay model work");
			await page.click("[data-return-extension]");
			await page.wait('document.querySelector("[data-member=board-child][aria-pressed=true]")');
			const beforeMove = await page.evaluate(
				'parseFloat(document.querySelector("[data-agent=board-child]").style.left)',
			);
			await page.evaluate('document.querySelector("[data-agent-move=board-child]").focus()');
			await page.key("ArrowRight");
			assert.equal(
				await page.evaluate('parseFloat(document.querySelector("[data-agent=board-child]").style.left)'),
				Number(beforeMove) + 20,
			);
			await page.click("[data-board-mode=list]");
			await page.wait(
				'document.querySelector(".graph-agent-list [data-member=board-child][aria-pressed=true]")',
			);
			await page.click("[data-board-mode=canvas]");
			assert.equal(
				await page.evaluate('parseFloat(document.querySelector("[data-agent=board-child]").style.left)'),
				Number(beforeMove) + 20,
			);
			assert.equal(m.f.requests.length, 6, "Adjusting presentation does not replay model work");
			for (const viewport of [
				{ width: 360, height: 600 },
				{ width: 390, height: 650 },
			]) {
				const mobile = page;
				await mobile.resize(viewport);
				// The adopted drawer transitions offscreen after this breakpoint change.
				// Wait for a real pointer hit; do not remove the reference motion or force drawer state.
				await mobile.wait(
					`(()=>{const e=document.querySelector("[data-board-mode=canvas]"),r=e?.getBoundingClientRect();return Boolean(r && e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))})()`,
				);
				await mobile.click("[data-board-mode=canvas]");
				await mobile.wait('document.querySelector("[data-member=coordinator]")');
				await mobile.evaluate("document.documentElement.style.setProperty('--text-size','24px')");
				await mobile.evaluate(
					"document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))",
				);
				await mobile.click("[data-member=coordinator]");
				await mobile.evaluate(
					'document.querySelector("[data-open-conversation=coordinator]").scrollIntoView({block:"nearest"})',
				);
				const geometry: unknown = await mobile.evaluate(
					`(()=>{const canvas=document.querySelector('.graph-scroll'),open=document.querySelector('[data-open-conversation=coordinator]').getBoundingClientRect(),text=document.querySelector('.graph-agent-activity');return {overflow:document.documentElement.scrollWidth>innerWidth,canvasHeight:canvas.clientHeight,openVisible:open.top>=0&&open.bottom<=innerHeight,font:parseFloat(getComputedStyle(text).fontSize)};})()`,
				);
				assert.ok(
					geometry &&
						typeof geometry === "object" &&
						"canvasHeight" in geometry &&
						"overflow" in geometry &&
						"openVisible" in geometry &&
						"font" in geometry,
				);
				assert.equal(geometry.overflow, false);
				assert.equal(geometry.openVisible, true);
				assert.ok(Number(geometry.font) >= 21, "Activity preview inherits the large Appearance font");
				assert.ok(Number(geometry.canvasHeight) >= 100, "Short-screen controls preserve usable canvas space");
				try {
					await mobile.click("[data-board-mode=list]");
				} catch (failure) {
					await writeFile(join(evidence, `mobile-${viewport.width}-blocked.png`), await mobile.screenshot());
					console.error(
						"MOBILE HIT",
						await mobile.evaluate(
							`(()=>{const selectors=['.graph-board','.board-head','.board-tabs','.graph-view-mode','.graph-scroll','.graph-selection','[data-board-mode=list]'];return selectors.map(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {selector,rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:hit?.outerHTML.slice(0,500)};});})()`,
						),
					);
					throw failure;
				}
				await mobile.wait('document.querySelector(".graph-agent-list [data-member=coordinator]")');
			}
			assert.equal(m.f.requests.length, 6, "Mobile observation never starts a model request");
			assert.deepEqual(m.f.errors, []);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
