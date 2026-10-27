import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceHooksExtensionRoot, workspaceHooksService } from "../src/workflows.ts";
import { ownedBrowser } from "./browser.ts";
import { toggleConversations } from "./frontend-controls.ts";

test(
	"WebUI hooks browser: human setup, signed real HTTP, key rotation, private mobile viewer and removal use ordinary extension slots",
	{ timeout: 40000 },
	async (t) => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "hook-product") },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
				extensions: [{ root: workspaceHooksExtensionRoot, facets: ["backend", "client", "webui"] }],
				extensionServices: async (context) => ({
					hooks: await workspaceHooksService(context, {
						namespace: "browser.hooks",
						githubWriters: ["approved-writer"],
					}),
				}),
			});
			assert.ok(app.initialOwner);
			const ref = app.runtime.view().conversations.at(-1)!,
				admin = await app.people.authenticate(app.initialOwner.token);
			const invitation = await app.people.invite(admin, {
				requestId: "viewer",
				role: "viewer",
				resources: [ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const viewerSession = await app.people.redeem(invitation.token, "Viewer");
			browser = await ownedBrowser(join(m.f.root, "hook-browser"));
			const owner = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token),
				viewer = await browser.page(app.http.origin + "/#signin=" + viewerSession.token, {
					width: 390,
					height: 844,
				});
			for (const page of [owner, viewer]) {
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click("[data-action=signin]");
				await page.wait('document.querySelector("[data-conversation]")');
				if (page === viewer) await toggleConversations(page);
				await page.click("[data-conversation]");
				await page.wait('document.querySelector("[data-interface=workspace-hooks-hooks]")');
				if (page === viewer) await toggleConversations(page);
				await page.click("[data-interface=workspace-hooks-hooks]");
				await page.wait('document.querySelector("[data-workspace-hooks]")');
			}
			assert.equal(
				await viewer.evaluate(
					'document.querySelectorAll("[data-hook-create],[data-hook-secret],[data-hook-row]").length',
				),
				0,
			);
			await owner.wait('document.querySelector("[data-hook-name]")?.disabled===false');
			assert.equal(
				await owner.evaluate('document.querySelector("[data-webhook-help]")?.open'),
				false,
				"connection details are available on demand",
			);
			assert.equal(
				await owner.evaluate(
					'document.querySelectorAll(".workspace-hooks > p:not([data-hook-readonly])").length',
				),
				0,
			);
			await owner.click("[data-webhook-help] summary");
			assert.equal(await owner.evaluate('document.querySelector("[data-webhook-help]").open'), true);
			assert.match(
				String(await owner.evaluate('document.querySelector("[data-webhook-help]").textContent')),
				/5 MiB/,
			);
			await owner.key("Enter");
			assert.equal(await owner.evaluate('document.querySelector("[data-webhook-help]").open'), false);
			assert.equal(m.f.requests.length, 0);
			await owner.type("[data-hook-name]", "Build events");
			await owner.type("[data-hook-instructions]", "Report the build result.");
			await owner.wait('document.querySelector("[data-hook-create]")?.disabled===false');
			await owner.click("[data-hook-create]");
			await owner.wait('document.querySelectorAll("[data-hook-row]").length===1');
			assert.equal(m.f.requests.length, 0);
			const hookId = await owner.evaluate('document.querySelector("[data-hook-row]").dataset.hookRow');
			assert.equal(typeof hookId, "string");
			await owner.click("[data-hook-setup]");
			await owner.wait('document.querySelector("[data-hook-secret]")?.value.length===43');
			const original = await owner.evaluate('document.querySelector("[data-hook-secret]").value');
			assert.equal(typeof original, "string");
			if (typeof original !== "string") throw Error("Missing synthetic hook credential");
			const stored = await owner.evaluate("JSON.stringify({...localStorage,...sessionStorage})");
			assert.equal(typeof stored, "string");
			assert.equal(String(stored).includes(original), false);
			const firstBytes = Buffer.from(
				JSON.stringify({ ref: "refs/heads/main", commits: [{ message: "BROWSER-HOOK-FIRST" }] }),
			);
			const post = async (secret: string, body: Uint8Array, delivery: string) =>
				fetch(app!.http.origin + "/pocket/ingress/workspace-hooks/hooks/" + hookId, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-github-event": "push",
						"x-github-delivery": delivery,
						"x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
					},
					body: new Uint8Array(body),
				});
			assert.equal((await post(original, firstBytes, "first")).status, 202);
			await app.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 1);
			assert.ok(JSON.stringify(m.f.requests[0]).includes("BROWSER-HOOK-FIRST"));
			assert.equal((await post(original, firstBytes, "changed-header")).status, 202);
			assert.equal(m.f.requests.length, 1);
			await owner.wait('document.querySelector("[data-hook-received]")?.textContent.includes("1")');
			await owner.click("[data-hook-rotate]");
			await owner.wait('document.querySelector("[data-hook-confirm]")?.disabled===false');
			await owner.click("[data-hook-confirm]");
			await owner.wait(
				'document.querySelector("[data-hook-row]")?.dataset.version==="2"&&!document.querySelector("[data-hook-secret]")',
			);
			await owner.click("[data-hook-setup]");
			await owner.wait('document.querySelector("[data-hook-secret]")?.value.length===43');
			const current = await owner.evaluate('document.querySelector("[data-hook-secret]").value');
			assert.equal(typeof current, "string");
			if (typeof current !== "string") throw Error("Missing rotated synthetic hook credential");
			assert.notEqual(current, original);
			const secondBytes = Buffer.from(
				JSON.stringify({ ref: "refs/heads/main", commits: [{ message: "BROWSER-HOOK-SECOND" }] }),
			);
			assert.equal((await post(original, secondBytes, "old-key")).status, 404);
			assert.equal((await post(current, secondBytes, "second")).status, 202);
			await app.runtime.waitForIdle();
			assert.equal(m.f.requests.length, 2);
			assert.equal(app.runtime.view().budget.primaryAttempts, 2);
			const extensions = await app.runtime
				.store({ namespace: "pocket.extensions", maxBytes: 1048576 })
				.snapshot();
			for (const secret of [original, current]) {
				assert.equal(JSON.stringify(extensions.data).includes(secret), false);
				assert.equal(JSON.stringify(m.f.requests).includes(secret), false);
			}
			await owner.click("[data-hook-hide-setup]");
			await owner.click("[data-hook-deliveries]");
			await owner.wait('document.querySelectorAll("[data-hook-delivery]").length===2');
			const output = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "hook-screenshots");
			await mkdir(output, { recursive: true });
			for (const page of [owner, viewer])
				await page.wait(
					'(async()=>{await document.fonts.ready;return document.getAnimations().every(animation=>animation.playState!=="running");})()',
				);
			await writeFile(join(output, "desktop.png"), await owner.screenshot());
			await writeFile(join(output, "mobile.png"), await viewer.screenshot());
			t.diagnostic(output);
			assert.equal(
				await viewer.evaluate(
					'document.querySelectorAll("[data-hook-secret],[data-hook-row],[data-hook-create]").length',
				),
				0,
			);
			assert.equal(await viewer.evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
			await owner.click("[data-hook-remove]");
			await owner.wait('document.querySelector("[data-hook-confirm]")?.disabled===false');
			await owner.click("[data-hook-confirm]");
			await owner.wait('!document.querySelector("[data-hook-row]")');
			assert.equal(
				(await post(current, Buffer.from('{"message":"after-removal"}'), "after-removal")).status,
				404,
			);
			assert.equal(m.f.requests.length, 2);
			await owner.click("[data-conversation]");
			await owner.wait('document.querySelector("main").innerText.includes("BROWSER-HOOK-SECOND")');
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
