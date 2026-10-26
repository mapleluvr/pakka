import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend, type FrontendPage } from "./frontend-controls.ts";

async function rpc(page: FrontendPage, command: Record<string, unknown>) {
	const response = (await page.evaluate(
		`fetch('/pocket/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Pakka-CSRF':document.cookie.match(/(?:^|; )pakka_csrf=([^;]+)/)[1]},body:JSON.stringify({version:2,requestId:crypto.randomUUID(),command:${JSON.stringify(command)}})}).then(async r=>({status:r.status,body:await r.json()}))`,
	)) as { status: number; body: { result?: unknown } };
	assert.equal(response.status, 200, JSON.stringify(response.body));
	return response.body.result as { [key: string]: any };
}

// Group changes must not reparent same-ID Conversations, misroute their SSE, or submit more model work.
test(
	"Sidebar navigation browser: Session and personal-folder projections preserve real Conversation identity and survive reload",
	{ timeout: 45000 },
	async () => {
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "sidebar") },
				owner: "Owner",
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "sidebar-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector(".app-shell")');
			const refs = [];
			for (const [suffix, message] of [
				["A", "FIRST-SESSION-PRIVATE-MESSAGE"],
				["B", "SECOND-SESSION-PRIVATE-MESSAGE"],
			]) {
				const parent = (
					await rpc(page, {
						op: "session.create",
						requestId: "parent-" + suffix,
						name: "Parent " + suffix,
						cwd: m.f.cwd,
					})
				).session;
				const ref = (
					await rpc(page, {
						op: "create",
						sessionId: parent.id,
						requestId: "child-" + suffix,
						name: "Conversation " + suffix,
						profile: "default",
					})
				).ref;
				const receipt = (
					await rpc(page, {
						op: "submit",
						target: ref,
						input: { requestId: "seed-" + suffix, mode: "prompt", text: message },
					})
				).receipt;
				assert.equal(
					(await rpc(page, { op: "wait", id: receipt.id, sessionId: ref.sessionId })).receipt.status,
					"done",
				);
				refs.push(ref);
			}
			assert.equal(
				refs[0].conversationId,
				refs[1].conversationId,
				"same native ID in different Sessions is the real premise",
			);
			assert.equal(m.f.requests.length, 2);
			await page.reload();
			await page.wait(
				'document.querySelector("[data-navigation-mode]") && !document.querySelector("[data-navigation-mode]").disabled',
			);
			await page.type("[data-navigation-mode]", "");
			await page.key("ArrowDown");
			await page.wait(
				'document.querySelector("[data-navigation-mode]").value==="session" && !document.querySelector("[data-navigation-mode]").disabled && document.querySelectorAll("[data-session-group]").length===2',
			);
			assert.deepEqual(
				await page.evaluate(
					'Array.from(document.querySelectorAll("[data-session-group] > header h3")).map(node=>node.textContent)',
				),
				["Parent A", "Parent B"],
			);
			for (let index = 0; index < refs.length; index++) {
				const ref = refs[index],
					selector = `[data-session=${JSON.stringify(ref.sessionId)}][data-conversation=${JSON.stringify(ref.conversationId)}]`;
				await settleFrontend(page);
				await page.click(selector);
				const expected = index === 0 ? "FIRST-SESSION-PRIVATE-MESSAGE" : "SECOND-SESSION-PRIVATE-MESSAGE",
					other = index === 0 ? "SECOND-SESSION-PRIVATE-MESSAGE" : "FIRST-SESSION-PRIVATE-MESSAGE";
				await page.wait(
					`document.querySelector('.message-list')?.textContent.includes(${JSON.stringify(expected)})`,
				);
				assert.equal(
					await page.evaluate(
						`document.querySelector('.message-list').textContent.includes(${JSON.stringify(other)})`,
					),
					false,
				);
			}
			await page.type("[data-navigation-mode]", "");
			await page.key("ArrowUp");
			await page.wait(
				'document.querySelector("[data-navigation-mode]").value==="default" && !document.querySelector("[data-navigation-mode]").disabled',
			);
			await page.click('[aria-label="New Folder"]');
			await page.wait('document.querySelector("input[name=folderName]")');
			await page.type("input[name=folderName]", "Projects");
			await page.click("[data-folder-confirm]");
			await page.wait(
				'document.querySelector("[data-folder-group]") && !document.querySelector("[role=dialog]")',
			);
			const folderId = await page.evaluate(
				'document.querySelector("[data-folder-group]").dataset.folderGroup',
			);
			for (const ref of refs) {
				await settleFrontend(page);
				await page.click(
					`.sidebar-conversation-row:has([data-session=${JSON.stringify(ref.sessionId)}][data-conversation=${JSON.stringify(ref.conversationId)}]) [data-move-resource]`,
				);
				await page.wait('document.querySelector("[name=folderId]")');
				await page.type("[name=folderId]", "");
				await page.key("ArrowDown");
				await page.click("[data-folder-confirm]");
				await page.wait('!document.querySelector("[role=dialog]")');
			}
			const grouped = `[data-folder-group=${JSON.stringify(folderId)}]`;
			assert.equal(
				await page.evaluate(
					`document.querySelector(${JSON.stringify(grouped)}).querySelectorAll('[data-conversation]').length`,
				),
				2,
			);
			await page.reload();
			await page.wait(
				`document.querySelector(${JSON.stringify(grouped)})?.querySelectorAll('[data-conversation]').length===2`,
			);
			assert.equal(await page.evaluate('document.querySelector("[data-navigation-mode]").value'), "default");
			await settleFrontend(page);
			await page.click(grouped + " [data-delete-folder]");
			await page.wait('document.querySelector("[data-folder-delete-confirm]")');
			await page.click("[data-folder-delete-confirm]");
			await page.wait(
				'!document.querySelector("[data-folder-group]") && document.querySelector("[data-uncategorized]")?.querySelectorAll("[data-conversation]").length===2',
			);
			assert.deepEqual((await rpc(page, { op: "list" })).conversations, refs);
			for (const target of refs)
				assert.equal(
					(await rpc(page, { op: "configuration", target })).configuration.session.budget.primaryAttempts,
					1,
				);
			assert.equal(m.f.requests.length, 2, "navigation does not spend another inference attempt");
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
