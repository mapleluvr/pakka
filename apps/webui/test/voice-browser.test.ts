import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { controlledSpeech } from "./voice-fixture.ts";
import { conversationAction, organizationAction, settleFrontend } from "./frontend-controls.ts";

type Browser = Awaited<ReturnType<typeof ownedBrowser>>;

test(
	"WebUI browser dictation: caret and final text reach only the draft until a real explicit Send",
	{ timeout: 25000 },
	async () => {
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined, browser: Browser | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "voice-product") },
				owner: "Owner",
				profiles: ["default"],
				initial: [{ name: "Voice project", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			const target = app.runtime.view().conversations.find((ref) => ref.key !== "root")!;
			browser = await ownedBrowser(join(m.f.root, "voice-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.evaluate(controlledSpeech);
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click('[data-conversation="' + target.conversationId + '"]');
			await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await page.wait('document.querySelector("[data-dictate]")?.disabled===false');
			assert.equal(await page.evaluate("globalThis.__voiceTest.instances.length"), 0);
			assert.match(
				String(await page.evaluate('document.querySelector("[data-dictation-help]").textContent')),
				/speech recognition.*browser/i,
			);
			await page.type("textarea[name=message]", "Start end");
			await page.evaluate(
				'(()=>{const e=document.querySelector("textarea[name=message]");e.focus();e.setSelectionRange(6,6);})()',
			);
			await page.click("[data-dictate]");
			await page.wait('document.querySelector("[data-dictate]").getAttribute("aria-pressed")==="true"');
			await page.evaluate('globalThis.__voiceTest.instances[0].emit([["temporary words",false]])');
			await page.wait('document.querySelector("textarea[name=message]").value==="Start temporary words end"');
			await page.evaluate(
				'globalThis.__voiceTest.instances[0].emit([["settled words",true],["more",false]])',
			);
			await page.wait(
				'document.querySelector("textarea[name=message]").value==="Start settled words more end"',
			);
			await page.evaluate(
				'globalThis.__voiceTest.instances[0].emit([["settled words",true],["final",true]])',
			);
			await page.wait(
				'document.querySelector("textarea[name=message]").value==="Start settled words final end"',
			);
			assert.equal(m.f.requests.length, 0);
			assert.equal(app.runtime.view().budget.primaryAttempts, 0);
			await page.click("[data-dictate]");
			await page.wait('document.querySelector("[data-dictate]").getAttribute("aria-pressed")==="false"');
			await page.evaluate('globalThis.__voiceTest.instances[0].emit([["LATE-STOPPED-RESULT",true]],true)');
			assert.equal(
				await page.evaluate('document.querySelector("textarea[name=message]").value'),
				"Start settled words final end",
			);
			await page.click("[data-action=send]");
			await page.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
			await app.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 1);
			assert.match(JSON.stringify(m.f.requests[0]?.messages), /Start settled words final end/);
			assert.ok(!JSON.stringify(m.f.requests).includes("LATE-STOPPED-RESULT"));
			assert.equal(await page.evaluate('document.querySelector("textarea[name=message]").value'), "");
			const screenshots = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "voice-screenshots");
			await mkdir(screenshots, { recursive: true });
			await page.wait(
				'(async()=>{await document.fonts.ready;return document.getAnimations().every(each=>each.playState!=="running");})()',
			);
			await writeFile(join(screenshots, "desktop.png"), await page.screenshot());
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);

test(
	"WebUI browser dictation: resource and sheet replacement, errors and logout discard old callbacks without dispatch",
	{ timeout: 25000 },
	async () => {
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined, browser: Browser | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "voice-lifecycle") },
				owner: "Owner",
				profiles: ["default"],
				initial: [
					{ name: "First", profile: "default" },
					{ name: "Second", profile: "default" },
				],
			});
			assert.ok(app.initialOwner);
			const refs = app.runtime.view().conversations.filter((ref) => ref.key !== "root");
			browser = await ownedBrowser(join(m.f.root, "lifecycle-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.evaluate(controlledSpeech);
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click('[data-conversation="' + refs[0]!.conversationId + '"]');
			await page.wait('document.querySelector("[data-dictate]")');
			await page.click("[data-dictate]");
			await page.wait("globalThis.__voiceTest.instances.length===1");
			await page.click('[data-conversation="' + refs[1]!.conversationId + '"]');
			await page.wait(
				'document.querySelector(".pocket-title").textContent==="Second"&&document.querySelector("[data-dictate]")',
			);
			assert.equal(await page.evaluate("globalThis.__voiceTest.instances[0].aborts"), 1);
			await page.evaluate('globalThis.__voiceTest.instances[0].emit([["OLD-RESOURCE-RESULT",true]],true)');
			assert.equal(await page.evaluate('document.querySelector("textarea[name=message]").value'), "");
			await page.click("[data-dictate]");
			await page.wait("globalThis.__voiceTest.instances.length===2");
			await conversationAction(page, "settings");
			await page.wait('document.querySelector("[data-cost]")');
			await settleFrontend(page);
			assert.equal(await page.evaluate("globalThis.__voiceTest.instances[1].aborts"), 1);
			await page.evaluate('globalThis.__voiceTest.instances[1].emit([["LATE-BEHIND-SETTINGS",true]],true)');
			assert.equal(await page.evaluate('document.querySelector("textarea[name=message]").value'), "");
			await page.click('[aria-label="Close settings"]');
			await page.wait('document.querySelector("[data-dictate]")');
			await page.click("[data-dictate]");
			await page.wait("globalThis.__voiceTest.instances.length===3");
			await page.evaluate('globalThis.__voiceTest.instances[2].emit([["incoming words",false]])');
			await page.wait('document.querySelector("textarea[name=message]").value==="Incoming words"');
			await page.evaluate('document.querySelector("textarea[name=message]").select()');
			await page.type("textarea[name=message]", "Human corrected draft");
			await page.evaluate('globalThis.__voiceTest.instances[2].emit([["old recognition revised",true]])');
			assert.equal(
				await page.evaluate('document.querySelector("textarea[name=message]").value'),
				"Human corrected draft",
			);
			await page.evaluate(
				'globalThis.__voiceTest.instances[2].emit([["old recognition revised",true],["next",true]])',
			);
			await page.wait(
				'document.querySelector("textarea[name=message]").value==="Human corrected draft next"',
			);
			await page.evaluate('globalThis.__voiceTest.instances[2].onerror({error:"not-allowed"})');
			await page.wait('document.querySelector("[role=alert]")?.innerText.includes("microphone is blocked")');
			assert.equal(await page.evaluate("globalThis.__voiceTest.instances[2].aborts"), 1);
			assert.equal(
				await page.evaluate('document.querySelector("[data-dictate]").getAttribute("aria-pressed")'),
				"false",
			);
			assert.equal(await page.evaluate("globalThis.__voiceTest.instances.length"), 3);
			await page.click('[aria-label="Dismiss notice"]');
			await page.click("[data-dictate]");
			await page.wait("globalThis.__voiceTest.instances.length===4");
			await page.evaluate('globalThis.__voiceTest.instances[3].emit([["x".repeat(8193),true]])');
			await page.wait('document.querySelector("[role=alert]")?.innerText.includes("message limit")');
			assert.equal(
				await page.evaluate('document.querySelector("textarea[name=message]").value'),
				"Human corrected draft next",
			);
			assert.equal(await page.evaluate("globalThis.__voiceTest.instances[3].aborts"), 1);
			await page.click('[aria-label="Dismiss notice"]');
			await page.click("[data-dictate]");
			await page.wait("globalThis.__voiceTest.instances.length===5");
			await organizationAction(page, "logout");
			await page.wait('document.querySelector("[data-action=signin]")');
			assert.equal(await page.evaluate("globalThis.__voiceTest.instances[4].aborts"), 1);
			await page.evaluate('globalThis.__voiceTest.instances[4].emit([["AFTER-LOGOUT-RESULT",true]],true)');
			assert.equal(await page.evaluate('document.querySelector("textarea[name=message]")'), null);
			assert.equal(m.f.requests.length, 0);
			assert.equal(app.runtime.view().budget.primaryAttempts, 0);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);

test(
	"WebUI browser dictation: absent speech support retains real typed input and a mobile viewer has no model dictation",
	{ timeout: 25000 },
	async () => {
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined, browser: Browser | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "voice-fallback") },
				owner: "Owner",
				profiles: ["default"],
				initial: [{ name: "Fallback", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			const target = app.runtime.view().conversations.find((ref) => ref.key !== "root")!;
			const owner = await app.people.authenticate(app.initialOwner.token);
			const invite = await app.people.invite(owner, {
				requestId: "voice-viewer",
				role: "viewer",
				resources: [target.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invite.token);
			const writerInvite = await app.people.invite(owner, {
				requestId: "voice-phone-writer",
				role: "sender",
				resources: [target.conversationId],
				ttlMs: 60000,
			});
			assert.ok(writerInvite.token);
			browser = await ownedBrowser(join(m.f.root, "fallback-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.evaluate(
				"globalThis.SpeechRecognition=undefined;globalThis.webkitSpeechRecognition=undefined",
			);
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click('[data-conversation="' + target.conversationId + '"]');
			await page.wait('document.querySelector("[data-action=send]")?.disabled===false');
			assert.equal(await page.evaluate('Boolean(document.querySelector("[data-dictate]"))'), false);
			await page.type("textarea[name=message]", "TYPED-WITHOUT-BROWSER-SPEECH");
			await page.click("[data-action=send]");
			await page.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
			await app.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 1);
			assert.match(JSON.stringify(m.f.requests[0]?.messages), /TYPED-WITHOUT-BROWSER-SPEECH/);
			const viewer = await browser.page(app.http.origin + "/#invite=" + invite.token, {
				width: 390,
				height: 844,
			});
			await viewer.wait('document.querySelector("[data-action=signin]")');
			await viewer.evaluate(controlledSpeech);
			await viewer.type("input[name=person]", "Reader");
			await viewer.click("[data-action=signin]");
			await viewer.wait('document.querySelector("[data-conversation]")');
			await viewer.click('[aria-label="Toggle conversations"]');
			await settleFrontend(viewer);
			await viewer.click('[data-conversation="' + target.conversationId + '"]');
			await viewer.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
			assert.equal(await viewer.evaluate('Boolean(document.querySelector("[data-dictate]"))'), false);
			assert.equal(await viewer.evaluate("globalThis.__voiceTest.instances.length"), 0);
			assert.equal(await viewer.evaluate('document.querySelector("[data-action=send]").disabled'), true);
			const screenshots = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "voice-screenshots");
			await mkdir(screenshots, { recursive: true });
			await viewer.wait(
				'(async()=>{await document.fonts.ready;return document.getAnimations().every(each=>each.playState!=="running");})()',
			);
			await writeFile(join(screenshots, "mobile-viewer.png"), await viewer.screenshot());
			const writer = await browser.page(app.http.origin + "/#invite=" + writerInvite.token, {
				width: 390,
				height: 844,
			});
			await writer.wait('document.querySelector("[data-action=signin]")');
			await writer.evaluate(controlledSpeech);
			await writer.type("input[name=person]", "Phone writer");
			await writer.click("[data-action=signin]");
			await writer.wait('document.querySelector("[data-conversation]")');
			await writer.click('[aria-label="Toggle conversations"]');
			await settleFrontend(writer);
			await writer.click('[data-conversation="' + target.conversationId + '"]');
			await writer.wait('document.querySelector("[data-dictate]")');
			await writer.wait(
				'(async()=>{await document.fonts.ready;return document.getAnimations().every(each=>each.playState!=="running");})()',
			);
			await writer.click("[data-dictate]");
			await writer.wait("globalThis.__voiceTest.instances.length===1");
			await writer.evaluate('globalThis.__voiceTest.instances[0].emit([["mobile dictation draft",true]])');
			await writer.wait('document.querySelector("textarea[name=message]").value==="Mobile dictation draft"');
			assert.equal(await writer.evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
			await writeFile(join(screenshots, "mobile-writer.png"), await writer.screenshot());
			assert.equal(m.f.requests.length, 1);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
