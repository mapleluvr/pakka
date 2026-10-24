import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { createPocketMemory } from "../../server/src/pocket-memory.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceMemoryExtensionRoot, workspaceMemoryService } from "../src/workflows.ts";
import { ownedBrowser } from "./browser.ts";
import { toggleConversations } from "./frontend-controls.ts";

test(
	"WebUI memory browser: real sender proposal, owner approval, preserved conflict draft, current provider context and mobile read-only view",
	{ timeout: 40000 },
	async (t) => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			const prepared = createPocketMemory({
				namespace: "browser.memory",
				profiles: ["default"],
				projects: [{ id: "all", name: "Approved workspace", resources: "*" }],
			});
			app = await startPocket({
				runtime: {
					...m.config,
					dataDir: join(m.f.root, "memory-product"),
					contextSources: [prepared.source],
				},
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
				extensions: [{ root: workspaceMemoryExtensionRoot, facets: ["backend", "client", "webui"] }],
				extensionServices: async (context) => ({ memory: await workspaceMemoryService(context, prepared) }),
			});
			assert.ok(app.initialOwner);
			const ref = app.runtime.view().conversations.at(-1)!,
				admin = await app.people.authenticate(app.initialOwner.token);
			const tokens: string[] = [];
			for (const [name, role, resources] of [
				["Sender", "sender", [ref.conversationId]],
				["Viewer", "viewer", [ref.conversationId]],
				["Other admin", "admin", "*"],
				["Other writer", "sender", [ref.conversationId]],
			] as const) {
				const invitation = await app.people.invite(admin, {
					requestId: name.replaceAll(" ", "-"),
					role,
					resources,
					ttlMs: 60000,
				});
				assert.ok(invitation.token);
				tokens.push((await app.people.redeem(invitation.token, name)).token);
			}
			const otherAdmin = await app.people.authenticate(tokens[2]!),
				otherWriter = await app.people.authenticate(tokens[3]!),
				memory = await prepared.attach({ runtime: app.runtime, people: app.people });
			browser = await ownedBrowser(join(m.f.root, "memory-browser"));
			const owner = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token),
				sender = await browser.page(app.http.origin + "/#signin=" + tokens[0]),
				viewer = await browser.page(app.http.origin + "/#signin=" + tokens[1], { width: 390, height: 844 });
			for (const page of [owner, sender, viewer]) {
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click("[data-action=signin]");
				await page.wait('document.querySelector("[data-conversation]")');
				if (page === viewer) await toggleConversations(page);
				await page.click("[data-conversation]");
				await page.wait('document.querySelector("[data-interface=workspace-memory-memory]")');
			}
			for (const page of [owner, sender]) {
				await page.click("[data-interface=workspace-memory-memory]");
				await page.wait('document.querySelector("[data-memory-add]")?.disabled===true');
			}
			assert.deepEqual(
				await owner.evaluate(`(()=>{
					const select=document.querySelector('[data-memory-scope]'), range=document.createRange();
					range.selectNodeContents(select.closest('label').firstChild);
					const label=range.getBoundingClientRect(), field=select.getBoundingClientRect(), button=document.querySelector('[data-memory-add]');
					return {scopeGap:field.x-label.right>=6||field.y-label.bottom>=6,buttonPadding:parseFloat(getComputedStyle(button).paddingInlineStart)>=8,buttonHeight:button.getBoundingClientRect().height>=36};
				})()`),
				{ scopeGap: true, buttonPadding: true, buttonHeight: true },
				"the public contribution separates its scope label and exposes a styled action",
			);
			await sender.type("[data-memory-text]", "APPROVED-BROWSER-MEMORY-CANARY");
			await sender.wait('document.querySelector("[data-memory-add]")?.disabled===false');
			await sender.click("[data-memory-add]");
			await sender.wait('document.querySelector("[data-memory-pending]")');
			await owner.wait('document.querySelector("[data-memory-approve]")?.disabled===false');
			assert.equal(m.f.requests.length, 0);
			await toggleConversations(viewer);
			await viewer.click("[data-interface=workspace-memory-memory]");
			await viewer.wait('document.querySelector("[data-workspace-memory]")');
			assert.equal(
				await viewer.evaluate(
					'document.querySelectorAll("[data-memory-add],[data-memory-approve],[data-memory-pending]").length',
				),
				0,
			);
			await owner.click("[data-memory-approve]");
			await owner.wait(
				'!document.querySelector("[data-memory-pending]")&&document.querySelectorAll("[data-memory-lesson]").length===1',
			);
			await viewer.wait(
				'document.querySelector("[data-memory-lesson]")?.textContent.includes("APPROVED-BROWSER-MEMORY-CANARY")',
			);
			await owner.click("[data-conversation]");
			await owner.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await owner.type("textarea[name=message]", "ACTUAL-WORK-WITH-MEMORY");
			await owner.click("[data-action=send]");
			await owner.wait('document.querySelector("main").innerText.includes("LOCAL-ANSWER")');
			assert.equal(m.f.requests.length, 1);
			assert.ok(JSON.stringify(m.f.requests[0]).includes("APPROVED-BROWSER-MEMORY-CANARY"));
			await owner.click("[data-interface=workspace-memory-memory]");
			await owner.wait('document.querySelector("[data-memory-edit]")?.disabled===false');
			await owner.click("[data-memory-edit]");
			await owner.wait('document.querySelector("[data-memory-draft]")');
			await owner.evaluate('document.querySelector("[data-memory-draft]").value=""');
			await owner.type("[data-memory-draft]", "LOCAL-UNSAVED-MEMORY-DRAFT");
			const winning = (await memory.bind(otherAdmin, ref).read()).lessons[0]!;
			const proposal = await memory.bind(otherWriter, ref).change({
				requestId: "move-to-pending",
				id: winning.id,
				expectedVersion: winning.version,
				action: "edit",
				text: "OTHER-WRITER-PROPOSAL",
			});
			assert.ok(proposal.lesson);
			await owner.wait('document.querySelector("[data-memory-pending]")');
			assert.equal(
				await owner.evaluate('document.querySelector("[data-memory-draft]")?.value'),
				"LOCAL-UNSAVED-MEMORY-DRAFT",
			);
			const approved = await memory.bind(otherAdmin, ref).change({
				requestId: "move-back-approved",
				id: winning.id,
				expectedVersion: proposal.lesson.version,
				action: "approve",
			});
			assert.ok(approved.lesson);
			await owner.wait('!document.querySelector("[data-memory-pending]")');
			assert.equal(
				await owner.evaluate('document.querySelector("[data-memory-draft]")?.value'),
				"LOCAL-UNSAVED-MEMORY-DRAFT",
			);
			await memory.bind(otherAdmin, ref).change({
				requestId: "external-winner",
				id: winning.id,
				expectedVersion: approved.lesson.version,
				action: "edit",
				text: "REAL-OTHER-ADMIN-WINNER",
			});
			await owner.click("[data-memory-save]");
			await owner.wait('document.querySelector("[data-memory-conflict]")');
			assert.equal(
				await owner.evaluate('document.querySelector("[data-memory-draft]").value'),
				"LOCAL-UNSAVED-MEMORY-DRAFT",
			);
			assert.equal((await memory.bind(otherAdmin, ref).read()).lessons[0]!.text, "REAL-OTHER-ADMIN-WINNER");
			await owner.click("[data-memory-enabled]");
			await owner.wait(
				'document.querySelector("[data-memory-enabled]")?.getAttribute("aria-pressed")==="false"',
			);
			await owner.click("[data-conversation]");
			await owner.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await owner.type("textarea[name=message]", "ACTUAL-WORK-WITH-MEMORY-DISABLED");
			await owner.click("[data-action=send]");
			await app.runtime.waitForIdle();
			await owner.wait('document.querySelector("main").innerText.split("LOCAL-ANSWER").length===3');
			await t.waitFor(() => assert.equal(m.f.requests.length, 2), { timeout: 5000 });
			assert.ok(!JSON.stringify(m.f.requests[1]).includes("REAL-OTHER-ADMIN-WINNER"));
			assert.ok(!JSON.stringify(m.f.requests[1]).includes("APPROVED-BROWSER-MEMORY-CANARY"));
			await owner.click("[data-interface=workspace-memory-memory]");
			await owner.wait('document.querySelector("[data-workspace-memory]")');
			await viewer.wait(
				'document.querySelector("[data-memory-lesson]")?.textContent.includes("REAL-OTHER-ADMIN-WINNER")',
			);
			assert.equal(
				await viewer.evaluate(
					'document.querySelectorAll("[data-memory-add],[data-memory-edit],[data-memory-approve],[data-memory-enabled]").length',
				),
				0,
			);
			assert.equal(
				await viewer.evaluate(
					'(()=>{const e=document.querySelector("[data-workspace-memory]");return e.getBoundingClientRect().right<=innerWidth+1&&e.scrollWidth<=e.clientWidth+1;})()',
				),
				true,
			);
			for (const page of [owner, viewer])
				await page.wait(
					'(async()=>{await document.fonts.ready;return document.getAnimations().every(animation=>animation.playState!=="running");})()',
				);
			const output = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "memory-screenshots");
			await mkdir(output, { recursive: true });
			await writeFile(join(output, "desktop.png"), await owner.screenshot());
			await writeFile(join(output, "mobile.png"), await viewer.screenshot());
			t.diagnostic(output);
			assert.equal(app.runtime.view().budget.primaryAttempts, 2);
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
