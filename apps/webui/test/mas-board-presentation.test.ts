import { test, type TestContext } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createMas, type Mas } from "@pakka/mas";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { masWorkbenchService } from "../../../packages/mas-devpack/src/backend.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { toggleConversations, settleFrontend } from "./frontend-controls.ts";

type Browser = Awaited<ReturnType<typeof ownedBrowser>>;
type Page = Awaited<ReturnType<Browser["page"]>>;
async function frame(page: Page, name: string) {
	const directory = join(
		process.env.PAKKA_TEST_ARTIFACTS ?? resolve("artifacts/pakka-webui"),
		"board-presentation",
	);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, name + ".png"), await page.screenshot());
}
async function readyStyles(page: Page) {
	await page.wait('[...document.querySelectorAll("link[rel=stylesheet]")].every(link => link.sheet)');
	await page.evaluate(
		"document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))",
	);
	await page.wait(
		'document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).every(animation => animation.playState !== "running")',
	);
}
async function boardFixture(t: TestContext) {
	const m = await runtimeFixture();
	await m.runtime.close();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	let browser: Browser | undefined;
	let mas: Mas | undefined;
	t.after(async () => {
		await browser?.close();
		await app?.close();
		await m.f.close();
	});
	app = await startPocket({
		runtime: { ...m.config, dataDir: join(m.f.root, "board-presentation") },
		owner: "Owner",
		initial: [{ name: "Ordinary draft", profile: "default" }],
		extensions: [{ root: resolve("packages/mas-devpack/dist") }],
		extensionServices: async (context) => {
			mas = await createMas({
				runtime: context.runtime,
				namespace: "board.presentation",
				maxDeliveries: 8,
				maxPending: 4,
			});
			await mas.bootstrap([{ key: "coordinator", owner: context.ownerId }]);
			await mas.activate();
			return { mas: masWorkbenchService({ ...context, mas }) };
		},
	});
	assert.ok(mas);
	assert.ok(app.initialOwner);
	browser = await ownedBrowser(join(m.f.root, "browser"));
	const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
	await page.wait('document.querySelector("[data-action=signin]")');
	await page.click("[data-action=signin]");
	await page.wait('document.querySelector("[data-conversation]")');
	await readyStyles(page);
	await page.click("[data-conversation]");
	await page.wait('document.querySelector("[data-action=send]")?.disabled === false');
	return { m, app, mas, page };
}

// Replacing the sheet with an inline panel must fail: two composers reappear and the Board is unmounted.
for (const viewport of [
	{ width: 1440, height: 900 },
	{ width: 360, height: 600 },
	{ width: 390, height: 650 },
]) {
	test(
		`MAS Agent controls are a separate dismissible sheet at ${viewport.width}x${viewport.height}`,
		{ timeout: 45000 },
		async (t) => {
			const { m, page } = await boardFixture(t);
			await page.type("textarea[name=message]", "RETAIN-UNSENT-CONVERSATION-DRAFT");
			await page.click("[data-interface=mas-devpack-board]");
			await page.wait('document.querySelector("[data-member=coordinator]")');
			await readyStyles(page);
			await page.click("[data-member=coordinator]");
			await page.click("[data-agent-details]");
			await page.resize(viewport);
			await page.evaluate("document.documentElement.style.setProperty('--text-size', '24px')");
			await readyStyles(page);
			await page.click("[data-agent-controls=coordinator]");
			await page.wait('document.querySelector("textarea[name=masMessage]")');
			await readyStyles(page);
			await frame(page, `controls-${viewport.width}`);
			assert.deepEqual(
				await page.evaluate(`(()=>{
			const message=document.querySelector('textarea[name=masMessage]'),dialog=message.closest('[role=dialog]');
			return {modal:dialog?.getAttribute('aria-modal')==='true',inline:!!message.closest('.scroller'),
				boardRetained:!!document.querySelector('[data-member=coordinator][aria-pressed=true]'),
				conversationComposerVisible:!!document.querySelector('.pocket-composer')?.getClientRects().length,
				focusInside:!!dialog?.contains(document.activeElement),overflow:document.documentElement.scrollWidth>innerWidth};
		})()`),
				{
					modal: true,
					inline: false,
					boardRetained: true,
					conversationComposerVisible: false,
					focusInside: true,
					overflow: false,
				},
			);
			await page.type("textarea[name=masMessage]", "UNSENT-CONTROLS-DRAFT");
			await page.click("[data-member-management]");
			await page.evaluate('document.querySelector("[data-mas-retire]").scrollIntoView({block:"end"})');
			assert.deepEqual(
				await page.evaluate(
					`(()=>{const close=document.querySelector('[aria-label="Close Agent controls"]'),r=close.getBoundingClientRect();return {visible:r.top>=0&&r.bottom<=innerHeight,hit:close.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),sized:r.width>=44&&r.height>=44};})()`,
				),
				{ visible: true, hit: true, sized: true },
				"The independent panel keeps its close control reachable while its body scrolls",
			);
			await page.evaluate('document.querySelector("[data-mas-retire]").focus()');
			await page.key("Tab");
			assert.equal(
				await page.evaluate('document.activeElement?.getAttribute("aria-label")'),
				"Close Agent controls",
				"Keyboard focus wraps inside Agent controls",
			);
			await page.key("Escape");
			await page.wait(
				'!document.querySelector("textarea[name=masMessage]") && document.activeElement?.getAttribute("data-agent-controls") === "coordinator"',
			);
			assert.equal(
				await page.evaluate('document.activeElement?.getAttribute("data-agent-controls")'),
				"coordinator",
			);
			assert.equal(
				await page.evaluate('!!document.querySelector("[data-member=coordinator][aria-pressed=true]")'),
				true,
			);
			await page.click("[data-agent-controls=coordinator]");
			await page.wait('document.querySelector("textarea[name=masMessage]")');
			await page.click('[aria-label="Close Agent controls"]');
			await page.wait(
				'!document.querySelector("textarea[name=masMessage]") && document.activeElement?.getAttribute("data-agent-controls") === "coordinator"',
			);
			if (await page.evaluate("innerWidth<768")) await toggleConversations(page);
			await page.click('[data-conversation][aria-current="true"]');
			await settleFrontend(page);
			await page.wait('document.querySelector("textarea[name=message]")');
			assert.equal(
				await page.evaluate('document.querySelector("textarea[name=message]").value'),
				"RETAIN-UNSENT-CONVERSATION-DRAFT",
			);
			assert.equal(m.f.requests.length, 0, "Opening and closing Agent controls never sends either draft");
			assert.deepEqual(m.f.errors, []);
		},
	);
}

// Hiding a retired node is presentation-only: its native member, history, log and provider count must survive.
test(
	"MAS retired Agents can be hidden and restored across reload without losing exchanges or history",
	{ timeout: 45000 },
	async (t) => {
		const { m, app, mas, page } = await boardFixture(t);
		const coordinator = (await mas.view()).members[0]!;
		const owner = mas.connect({
			principal: coordinator.owner,
			source: coordinator.ref,
			grants: ["spawn", "send", "observe", "retire"],
		});
		const child = await owner.spawn({ key: "retired-child", lifetime: "persistent" });
		const receipt = await owner.send(child.ref, {
			requestId: "retained-exchange",
			text: "HIDDEN-AGENT-HISTORY-RETAINED",
		});
		assert.equal((await owner.wait(receipt.id)).status, "done");
		await owner.retire(child.ref);
		const before = await mas.view();
		assert.equal(m.f.requests.length, 1);
		await page.click("[data-interface=mas-devpack-board]");
		await page.wait('document.querySelector("[data-member=retired-child]")');
		await readyStyles(page);
		await page.click("[data-member=retired-child]");
		await page.wait('document.querySelector("[data-member=retired-child][aria-pressed=true]")');
		await frame(page, "retired-before-hide");
		assert.equal(
			await page.evaluate('!!document.querySelector("[data-hide-agent=retired-child]")'),
			true,
			"Retired Agent selection needs an explicit hide-from-Board action",
		);
		await page.click("[data-agent-details]");
		await page.click("[data-hide-agent=retired-child]");
		await page.wait('!document.querySelector("[data-member=retired-child]")');
		assert.equal(
			await page.evaluate('document.querySelectorAll(".graph-edge").length'),
			0,
			"No dangling creation or communication edge remains on the canvas",
		);
		assert.equal(await page.evaluate('!!document.querySelector(".graph-selection")'), false);
		await page.click("[data-board-mode=list]");
		assert.equal(
			await page.evaluate('document.querySelectorAll(".graph-agent-list [data-member]").length'),
			1,
		);
		await page.reload();
		await page.wait('document.querySelector("[data-interface=mas-devpack-board]")');
		await readyStyles(page);
		await page.click("[data-interface=mas-devpack-board]");
		await page.wait('document.querySelector(".graph-agent-list [data-member=coordinator]")');
		await readyStyles(page);
		assert.equal(
			await page.evaluate('!!document.querySelector("[data-member=retired-child]")'),
			false,
			"The personal hide preference survives reload",
		);
		await page.click('[data-board-tab="history"]');
		await page.wait(
			'document.querySelector(".graph-history")?.textContent.includes("HIDDEN-AGENT-HISTORY-RETAINED")',
		);
		await page.click(".graph-history-actions button:last-child");
		await page.wait(
			'document.querySelector(".conversation-scroll")?.textContent.includes("HIDDEN-AGENT-HISTORY-RETAINED")',
		);
		await page.click("[data-return-extension]");
		await page.wait('document.querySelector("[data-board-tab=relationships]")');
		await page.click('[data-board-tab="relationships"]');
		await page.click("[data-board-options]");
		await page.click("[data-show-hidden-agents]");
		await page.wait('document.querySelector("[data-member=retired-child]")');
		await page.click("[data-board-options]");
		await page.click("[data-board-mode=canvas]");
		await page.wait(
			'document.querySelector(".graph-edge.creation") && document.querySelector(".graph-edge.communication")',
		);
		await page.resize({ width: 360, height: 600 });
		await page.evaluate("document.documentElement.style.setProperty('--text-size','24px')");
		await readyStyles(page);
		await page.click("[data-member=retired-child]");
		await page.click("[data-agent-details]");
		await page.click("[data-hide-agent=retired-child]");
		await page.wait('!document.querySelector("[data-member=retired-child]")');
		await page.click("[data-board-options]");
		await page.click("[data-show-hidden-agents]");
		await page.wait('document.querySelector("[data-member=retired-child]")');
		assert.equal(await page.evaluate("document.documentElement.scrollWidth>innerWidth"), false);
		assert.deepEqual(
			await mas.view(),
			before,
			"Personal visibility never retires, deletes or reactivates a member",
		);
		assert.equal((await owner.receipt(receipt.id)).status, "done");
		assert.match(
			JSON.stringify((await app.runtime.readConversation(child.ref, () => {})).entries),
			/HIDDEN-AGENT-HISTORY-RETAINED/,
		);
		assert.equal(
			m.f.requests.length,
			1,
			"Hiding, restoring and navigating history never replays provider work",
		);
		assert.deepEqual(m.f.errors, []);
	},
);
