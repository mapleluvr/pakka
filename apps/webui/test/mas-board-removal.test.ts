import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { createMas, type Mas } from "@pakka/mas";
import { masExtensionRoot, masWorkbenchService } from "@pakka/mas-devpack/backend";
import type { PocketProductOptions } from "@pakka/webui";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

// The shell cannot retain a hidden MAS page, and plugin removal cannot cancel native work or reveal a peer through live updates.
test(
	"MAS Board: server-filtered mobile reader; removing UI preserves admitted work, members, history and normal reopen",
	{ timeout: 60000 },
	async (t) => {
		const release = deferred();
		let first = true,
			mas: Mas | undefined;
		const m = await runtimeFixture({}, undefined, async () => {
			if (first) {
				first = false;
				await release.promise;
			}
			return { text: "WORK-SURVIVED-BOARD-REMOVAL" };
		});
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		const options: PocketProductOptions = {
			runtime: { ...m.config, dataDir: join(m.f.root, "removed-board-data") },
			owner: "Owner",
			initial: [{ name: "Ordinary", profile: "default" }],
			extensionServices: async (context) => {
				mas = await createMas({
					runtime: context.runtime,
					namespace: "removed.board",
					maxDeliveries: 16,
					maxPending: 4,
				});
				await mas.bootstrap([
					{ key: "visible", owner: context.ownerId },
					{ key: "PRIVATE-TEAM-CANARY", owner: context.ownerId },
				]);
				await mas.activate();
				return { mas: masWorkbenchService({ ...context, mas }) };
			},
		};
		try {
			app = await startPocket({ ...options, extensions: [{ root: masExtensionRoot }] });
			assert.ok(app.initialOwner);
			assert.ok(mas);
			const before = (await mas.view()).members,
				visible = before.find((row) => row.key === "visible")!,
				hidden = before.find((row) => row.key === "PRIVATE-TEAM-CANARY")!;
			const actor = await app.people.authenticate(app.initialOwner.token),
				invite = await app.people.invite(actor, {
					requestId: "reader",
					role: "viewer",
					resources: [visible.ref.conversationId],
					ttlMs: 60000,
				});
			assert.ok(invite.token);
			browser = await ownedBrowser(join(m.f.root, "removed-board-browser"));
			const owner = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await owner.wait('document.querySelector("[data-action=signin]")');
			await owner.click("[data-action=signin]");
			await owner.wait('document.querySelector("[data-interface=mas-devpack-board]")');
			await owner.click("[data-interface=mas-devpack-board]");
			await owner.wait('document.querySelector("[data-member=visible]")');
			const viewer = await browser.page(app.http.origin + "/#invite=" + invite.token, {
				width: 390,
				height: 844,
			});
			await viewer.wait('document.querySelector("[data-action=signin]")');
			await viewer.evaluate(
				'(()=>{globalThis.boardResponses=[];globalThis.captureFailed=false;const original=globalThis.fetch;globalThis.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).includes("/pocket/extensions/rpc")){try{const value=await response.clone().json();globalThis.boardResponses.push(value);if(globalThis.boardResponses.length>64)globalThis.boardResponses.shift();}catch{globalThis.captureFailed=true;}}return response;};})()',
			);
			await viewer.type("input[name=person]", "Viewer");
			await viewer.click("[data-action=signin]");
			await viewer.wait('document.querySelector("[data-interface=mas-devpack-board]")');
			await viewer.click('[aria-label="Toggle conversations"]');
			await viewer.click("[data-interface=mas-devpack-board]");
			await viewer.wait('document.querySelector("[data-member=visible]")');
			assert.equal(await viewer.evaluate('document.body.innerText.includes("PRIVATE-TEAM-CANARY")'), false);
			assert.equal(await viewer.evaluate('document.querySelectorAll("[data-member]").length'), 1);
			assert.equal(await viewer.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
			await viewer.click("[data-member=visible]");
			await viewer.click("[data-agent-details]");
			await viewer.click("[data-agent-controls=visible]");
			await viewer.wait('document.querySelector("[data-member-phase]")');
			assert.equal(
				await viewer.evaluate(
					'Boolean(document.querySelector("[data-mas-send],[data-mas-abort],[data-mas-retire]"))',
				),
				false,
			);
			await owner.click("[data-member=visible]");
			await owner.click("[data-agent-details]");
			await owner.click("[data-agent-controls=visible]");
			await owner.wait('document.querySelector("textarea[name=masMessage]")');
			await owner.type("textarea[name=masMessage]", "HOLD-WHILE-BOARD-REMOVED");
			await owner.click("[data-mas-send]");
			await owner.wait('/placed/.test(document.querySelector("[data-mas-receipt]")?.textContent)');
			await t.waitFor(() => assert.equal(m.f.requests.length, 1), { timeout: 5000, interval: 10 });
			assert.equal(m.f.requests.length, 1);
			const receiptId = String(
					await owner.evaluate(
						'document.querySelector("[data-mas-receipt]").getAttribute("data-mas-receipt")',
					),
				),
				catalog = app.runtime.catalog({ namespace: "removed.board", maxDeliveries: 16, maxPending: 4 });
			assert.equal((await catalog.receipt(receiptId, () => {})).status, "placed");
			await viewer.wait("globalThis.boardResponses.length >= 4");
			assert.equal(await viewer.evaluate("globalThis.captureFailed"), false);
			const wire = String(await viewer.evaluate("JSON.stringify(globalThis.boardResponses)"));
			assert.equal(wire.includes("PRIVATE-TEAM-CANARY"), false);
			assert.equal(wire.includes('"conversationId":"' + hidden.ref.conversationId + '"'), false);
			await owner.click('[aria-label="Close Agent controls"]');
			await owner.wait(
				'!document.querySelector("textarea[name=masMessage]") && document.activeElement?.getAttribute("data-agent-controls") === "visible"',
			);
			await owner.click("[data-action=commands]");
			await owner.wait('document.querySelector(".pocket-extension-registration button")');
			await owner.click(".pocket-extension-registration button");
			await owner.wait('!document.querySelector("[data-interface=mas-devpack-board],[data-member-phase]")');
			await viewer.wait('!document.querySelector("[data-interface=mas-devpack-board],[data-member-phase]")');
			assert.equal((await catalog.receipt(receiptId, () => {})).status, "placed");
			assert.equal((await app.runtime.readConversation(visible.ref, () => {})).live.busy, true);
			assert.deepEqual((await mas.view()).members, before);
			assert.equal(m.f.requests.length, 1);
			release.resolve();
			assert.equal((await catalog.wait(receiptId, () => {})).status, "done");
			const history = await app.runtime.readConversation(visible.ref, () => {});
			assert.match(JSON.stringify(history.entries), /WORK-SURVIVED-BOARD-REMOVAL/);
			const sessionFile = app.runtime.view().sessionFile,
				sessionId = app.runtime.view().sessionId;
			await app.close();
			app = await startPocket({
				...options,
				runtime: { ...options.runtime, reopenSessionFile: sessionFile },
				extensions: [],
			});
			assert.equal(app.runtime.view().sessionId, sessionId);
			assert.equal(app.initialOwner, null);
			assert.deepEqual((await mas.view()).members, before);
			assert.equal(
				(
					await app.runtime
						.catalog({ namespace: "removed.board", maxDeliveries: 16, maxPending: 4 })
						.receipt(receiptId, () => {})
				).status,
				"done",
			);
			await owner.navigate(app.http.origin + "/");
			await owner.wait('document.querySelector("[data-conversation]")');
			assert.equal(
				await owner.evaluate('Boolean(document.querySelector("[data-interface=mas-devpack-board]"))'),
				false,
			);
			await owner.click("[data-conversation]");
			await owner.wait('document.querySelector("[data-action=send]")?.disabled === false');
			await owner.type("textarea[name=message]", "ORDINARY-WORK-AFTER-BOARD-REMOVAL");
			await owner.click("[data-action=send]");
			await owner.wait('document.querySelector("main").innerText.includes("WORK-SURVIVED-BOARD-REMOVAL")');
			assert.equal(m.f.requests.length, 2);
			assert.deepEqual(m.f.errors, []);
		} finally {
			release.resolve();
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
