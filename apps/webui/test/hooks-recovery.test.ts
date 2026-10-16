import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceHooksExtensionRoot, workspaceHooksService } from "../src/workflows.ts";
import { ownedBrowser } from "./browser.ts";

async function setup(loseHandler = false) {
	const m = await runtimeFixture();
	await m.runtime.close();
	let calls = 0;
	try {
		const app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "hook-recovery") },
			owner: "Owner",
			initial: [{ name: "Project", profile: "default" }],
			extensions: [{ root: workspaceHooksExtensionRoot, facets: ["backend", "client", "webui"] }],
			extensionServices: async (context) => {
				const service = await workspaceHooksService(context, { namespace: "recovery.hooks" });
				return {
					hooks: {
						...service,
						bind(actor, target, check) {
							const bound = service.bind(actor, target, check);
							return Object.freeze({
								...bound,
								create: async (...args: Parameters<typeof bound.create>) => {
									calls++;
									const result = await bound.create(...args);
									if (loseHandler) throw Error("TEST LOST COMMITTED HOOK HANDLER RESULT");
									return result;
								},
							});
						},
					},
				};
			},
		});
		assert.ok(app.initialOwner);
		return {
			m,
			app,
			calls: () => calls,
			close: async () => {
				await app.close();
				await m.close();
			},
		};
	} catch (error) {
		await m.close();
		throw error;
	}
}
for (const loss of ["response", "handler"] as const)
	test(
		`Pocket hooks recovery: lost ${loss} is checked read-only after panel reopen without creating another hook`,
		{ timeout: 30000 },
		async () => {
			const f = await setup(loss === "handler");
			let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
			try {
				browser = await ownedBrowser(join(f.m.f.root, "recovery-browser"));
				const page = await browser.page(f.app.http.origin + "/#signin=" + f.app.initialOwner!.token);
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click("[data-action=signin]");
				await page.wait('document.querySelector("[data-conversation]")');
				await page.click("[data-conversation]");
				await page.wait('document.querySelector("[data-interface=workspace-hooks-hooks]")');
				await page.click("[data-interface=workspace-hooks-hooks]");
				await page.wait('document.querySelector("[data-hook-name]")?.disabled===false');
				if (loss === "response")
					await page.evaluate(
						`(()=>{const original=globalThis.fetch;globalThis.__restoreHookFetch=()=>{globalThis.fetch=original;};globalThis.__hookWrites=0;globalThis.fetch=async(...args)=>{if(typeof args[1]?.body==='string'&&JSON.parse(args[1].body).command?.call?.action==='create'){globalThis.__hookWrites++;const response=await original(...args);await response.arrayBuffer();throw Error('TEST LOST COMMITTED HOOK RESPONSE');}return original(...args);};})()`,
					);
				await page.type("[data-hook-name]", "Recover original hook");
				await page.type("[data-hook-instructions]", "Report this event.");
				await page.click("[data-hook-create]");
				await page.wait('document.querySelector("[data-hook-reconcile]")?.disabled===false');
				assert.equal(f.calls(), 1);
				assert.equal(f.m.f.requests.length, 0);
				assert.equal(await page.evaluate('document.querySelector("[data-hook-create]").disabled'), true);
				if (loss === "response") await page.evaluate("globalThis.__restoreHookFetch()");
				await page.click("[data-conversation]");
				await page.click("[data-interface=workspace-hooks-hooks]");
				await page.wait('document.querySelector("[data-hook-reconcile]")?.disabled===false');
				await page.click("[data-hook-reconcile]");
				await page.wait(
					'!document.querySelector("[data-hook-reconcile]")&&document.querySelectorAll("[data-hook-row]").length===1',
				);
				assert.equal(f.calls(), 1);
				assert.equal(f.m.f.requests.length, 0);
				if (loss === "response") assert.equal(await page.evaluate("globalThis.__hookWrites"), 1);
				await page.click("[data-hook-setup]");
				await page.wait('document.querySelector("[data-hook-secret]")?.value.length===43');
				const value = await page.evaluate(
					'({id:document.querySelector("[data-hook-row]").dataset.hookRow,secret:document.querySelector("[data-hook-secret]").value})',
				);
				assert.ok(
					value &&
						typeof value === "object" &&
						"id" in value &&
						typeof value.id === "string" &&
						"secret" in value &&
						typeof value.secret === "string",
				);
				const body = Buffer.from('{"ref":"refs/heads/main","message":"AFTER-READ-ONLY-HOOK-RECOVERY"}');
				const response = await fetch(
					f.app.http.origin + "/pocket/ingress/workspace-hooks/hooks/" + value.id,
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							"x-github-event": "push",
							"x-github-delivery": "after-recovery",
							"x-hub-signature-256":
								"sha256=" + createHmac("sha256", value.secret).update(body).digest("hex"),
						},
						body,
					},
				);
				assert.equal(response.status, 202);
				await f.app.runtime.waitForIdle();
				assert.equal(f.m.f.requests.length, 1);
				assert.equal(f.app.runtime.view().budget.primaryAttempts, 1);
				assert.equal(f.calls(), 1);
			} finally {
				await browser?.close();
				await f.close();
			}
		},
	);

test(
	"Pocket hooks mobile operator: generic setup fits the real phone view without persisting its secret address or triggering a model",
	{ timeout: 30000 },
	async (t) => {
		const f = await setup();
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			browser = await ownedBrowser(join(f.m.f.root, "mobile-hook-browser"));
			const page = await browser.page(f.app.http.origin + "/#signin=" + f.app.initialOwner!.token, {
				width: 390,
				height: 844,
			});
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click('[aria-label="Toggle conversations"]');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-interface=workspace-hooks-hooks]")');
			await page.click('[aria-label="Toggle conversations"]');
			await page.click("[data-interface=workspace-hooks-hooks]");
			await page.wait('document.querySelector("[data-hook-name]")?.disabled===false');
			await page.type("[data-hook-name]", "Mobile deploys");
			await page.type("[data-hook-instructions]", "Explain deploy events. " + "LongInstruction".repeat(40));
			await page.click("[data-hook-signed]");
			await page.click("[data-hook-create]");
			await page.wait('document.querySelectorAll("[data-hook-row]").length===1');
			await page.click("[data-hook-setup]");
			await page.wait(
				'document.querySelector("[data-hook-address]")?.value.includes("/pocket/ingress/workspace-hooks/hooks/")',
			);
			const address = await page.evaluate('document.querySelector("[data-hook-address]").value');
			assert.equal(typeof address, "string");
			if (typeof address !== "string") throw Error("Missing synthetic setup address");
			const secret = new URL(address).pathname.split("/").at(-1)!;
			assert.equal(secret.length, 43);
			assert.equal(
				await page
					.evaluate("JSON.stringify({...localStorage,...sessionStorage})")
					.then((value) => String(value).includes(secret)),
				false,
			);
			assert.equal(
				await page.evaluate(
					'document.documentElement.scrollWidth<=innerWidth&&document.querySelector("[data-workspace-hooks]").scrollWidth<=innerWidth',
				),
				true,
			);
			assert.equal(f.m.f.requests.length, 0);
			assert.deepEqual(
				await page.evaluate(
					`Array.from(document.querySelectorAll('.pocket-topbar button')).filter(button=>{const r=button.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight||!button.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2));}).map(button=>button.dataset.action||button.getAttribute('aria-label')||button.textContent)`,
				),
				[],
				"Every mobile toolbar control must be visible and hit-testable",
			);
			await page.click("[data-hook-hide-setup]");
			await page.wait(
				'(async()=>{await document.fonts.ready;return document.getAnimations().every(animation=>animation.playState!=="running");})()',
			);
			const output = join(process.env.PAKKA_TEST_ARTIFACTS ?? f.m.f.root, "hook-screenshots");
			await mkdir(output, { recursive: true });
			await writeFile(join(output, "mobile-operator.png"), await page.screenshot());
			t.diagnostic(output);
			await page.click('[data-action="people"]');
			await page.wait("document.querySelector('[aria-label=\"Close people\"]')");
			assert.equal(f.m.f.requests.length, 0);
		} finally {
			await browser?.close();
			await f.close();
		}
	},
);
