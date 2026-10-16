import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import type { ConversationRef } from "@pakka/agent";
import {
	approvalTool,
	createPocketApprovals,
	type PocketApprovals,
} from "../../server/src/pocket-approvals.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceApprovalsExtensionRoot, workspaceApprovalsService } from "../src/workflows.ts";
import { ownedBrowser } from "./browser.ts";

test(
	"Pocket approval panel: actual browser decisions release or deny original native effects and viewer cannot decide",
	{ timeout: 30000 },
	async (t) => {
		let approvals!: PocketApprovals,
			target!: ConversationRef,
			effects = 0;
		const tool = approvalTool(
			{
				name: "human_approved_write",
				description: "Local file effect requiring approval",
				parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
				execute: async (args: Record<string, unknown>) => {
					effects++;
					await writeFile(join(m.f.cwd, "human-effect.txt"), String(args.text));
					return "HUMAN-APPROVED-TOOL-DONE";
				},
			},
			() => ({ approvals, target }),
		);
		const m = await runtimeFixture({ tools: [tool] }, undefined, (payload) =>
			payload.messages.at(-1)?.role === "tool"
				? { text: "APPROVAL-WORK-FINISHED" }
				: { tool: "human_approved_write", args: { text: "ORIGINAL-TOOL-PAYLOAD" } },
		);
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "approval-product") },
				owner: "Owner",
				initial: [{ name: "Approved work", profile: "default" }],
				extensions: [{ root: workspaceApprovalsExtensionRoot, facets: ["backend", "webui", "client"] }],
				extensionServices: async (context) => {
					approvals = await createPocketApprovals({
						runtime: context.runtime,
						people: context.people,
						notifications: context.notifications,
						namespace: "browser.approvals",
						timeoutMs: 20000,
					});
					assert.equal(context.runtime.view().conversations.length, 2);
					target = context.runtime.view().conversations.at(-1)!;
					return { approvals: workspaceApprovalsService(approvals) };
				},
			});
		} catch (error) {
			await m.f.close();
			throw error;
		}
		try {
			assert.ok(app.initialOwner);
			const admin = await app.people.authenticate(app.initialOwner.token),
				invite = await app.people.invite(admin, {
					requestId: "read-only",
					role: "viewer",
					resources: [target.conversationId],
					ttlMs: 60000,
				});
			assert.ok(invite.token);
			const session = await app.people.redeem(invite.token, "Viewer");
			browser = await ownedBrowser(join(m.f.root, "approval-inspection"));
			const owner = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token),
				viewer = await browser.page(app.http.origin + "/#signin=" + session.token, {
					width: 390,
					height: 844,
				});
			for (const page of [owner, viewer]) {
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click("[data-action=signin]");
				await page.wait('document.querySelector("[data-conversation]")');
				if (page === viewer) await page.click('[aria-label="Toggle conversations"]');
				await page.click("[data-conversation]");
				await page.wait('document.querySelector("[data-interface=workspace-approvals-approvals]")');
			}
			const submit = async (text: string) => {
				await owner.click("[data-conversation]");
				await owner.wait('document.querySelector("textarea[name=message]")');
				await owner.type("textarea[name=message]", text);
				await owner.wait('document.querySelector("[data-action=send]")?.disabled===false');
				await owner.click("[data-action=send]");
				await owner.click("[data-interface=workspace-approvals-approvals]");
				await owner.wait('document.querySelector("[data-approval-allow]")');
			};
			await submit("ASK-FIRST-PERMISSION");
			await t.waitFor(
				async () => {
					const stored = await app!.runtime
						.store({ namespace: "pocket.notifications", maxBytes: 1048576 })
						.snapshot();
					assert.ok(
						Array.isArray(stored.data.events) &&
							stored.data.events.some(
								(row) => row && typeof row === "object" && !Array.isArray(row) && row.kind === "approval",
							),
					);
				},
				{ timeout: 4000 },
			);
			assert.equal(effects, 0);
			await assert.rejects(readFile(join(m.f.cwd, "human-effect.txt")), { code: "ENOENT" });
			await viewer.click('[aria-label="Toggle conversations"]');
			await viewer.click("[data-interface=workspace-approvals-approvals]");
			await viewer.wait('document.querySelector("[data-approval-state]")?.textContent.includes("pending")');
			assert.equal(
				await viewer.evaluate(
					'document.querySelectorAll("[data-approval-allow],[data-approval-deny]").length',
				),
				0,
			);
			await owner.click("[data-approval-allow]");
			await owner.wait('document.querySelector("[data-approval-state]")?.textContent.includes("done")');
			assert.equal(effects, 1);
			assert.equal(await readFile(join(m.f.cwd, "human-effect.txt"), "utf8"), "ORIGINAL-TOOL-PAYLOAD");
			await submit("ASK-SECOND-PERMISSION");
			await owner.click("[data-approval-deny]");
			await owner.wait(
				'[...document.querySelectorAll("[data-approval-state]")].some(node=>node.textContent.includes("denied"))',
			);
			assert.equal(effects, 1);
			await owner.click("[data-conversation]");
			await owner.wait('document.querySelector("main").innerText.includes("APPROVAL-DENIED")');
			await t.waitFor(() => assert.equal(m.f.requests.length, 4));
			assert.deepEqual(m.f.errors, []);
			await writeFile(join(m.f.root, "approvals-desktop.png"), await owner.screenshot());
			await writeFile(join(m.f.root, "approvals-mobile.png"), await viewer.screenshot());
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
