import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend, toggleConversations } from "./frontend-controls.ts";

// Catches fixed-pixel settings text, zoom-triggering mobile fields and an
// editor that removes its outline without a visible group replacement.
test("WebUI typography and input accessibility", { timeout: 90000 }, async (t) => {
	const m = await runtimeFixture();
	await m.runtime.close();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
	try {
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "typography-accessibility") },
			owner: "Owner",
			initial: [{ name: "Readable configuration", profile: "default" }],
		});
		assert.ok(app.initialOwner);
		browser = await ownedBrowser(join(m.f.root, "chrome"));
		const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
		await page.wait('document.querySelector("[data-action=signin]")');
		await page.click("[data-action=signin]");
		await page.wait('document.querySelector("[data-conversation]")');
		await settleFrontend(page);
		await page.click("[data-conversation]");
		await page.wait('document.querySelector(".pocket-status")?.textContent === "Ready"');
		await page.type("textarea[name=message]", "UNSENT ACCESSIBLE DRAFT");
		await page.click("[data-action=open-settings]");
		await page.wait('document.querySelector("[aria-label=Theme]")');

		await t.test("configuration text follows a larger root font", async () => {
			try {
				await page.evaluate('document.documentElement.style.fontSize="20px"');
				assert.deepEqual(
					await page.evaluate(`({
						body: getComputedStyle(document.body).fontSize,
						title: getComputedStyle(document.querySelector('.settings-page h1')).fontSize,
						label: getComputedStyle(document.querySelector('.card-row-label')).fontSize,
						field: getComputedStyle(document.querySelector('[aria-label=Theme]')).fontSize,
						group: getComputedStyle(document.querySelector('.settings-group-label')).fontSize
					})`),
					{ body: "17.5px", title: "22.5px", label: "16.25px", field: "16.25px", group: "13.75px" },
					"a controlled 16→20px root increase scales the default text roles by 1.25",
				);
			} finally {
				await page.evaluate('document.documentElement.style.removeProperty("font-size")');
			}
		});

		await t.test("mobile configuration fields have readable type and touch targets", async () => {
			await page.resize({ width: 360, height: 600 });
			await settleFrontend(page);
			const controls =
				(await page.evaluate(`Array.from(document.querySelectorAll('.appearance-fields select,.settings-nav-row:not(:disabled)')).map(node => ({
				name: node.getAttribute('aria-label') ?? node.textContent.trim(),
				font: parseFloat(getComputedStyle(node).fontSize),
				height: node.getBoundingClientRect().height,
				field: node.tagName === 'SELECT'
			}))`)) as { name: string; font: number; height: number; field: boolean }[];
			assert.ok(
				controls.filter((control) => control.field).length >= 3,
				"inspect all three actual configuration fields",
			);
			for (const control of controls) {
				if (control.field) assert.ok(control.font >= 16, `${control.name}: ${control.font}px type`);
				assert.ok(control.height >= 44, `${control.name}: ${control.height}px touch target`);
			}
			assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
			try {
				await page.evaluate('document.documentElement.style.fontSize="12px"');
				assert.ok(
					Number(
						await page.evaluate(
							'parseFloat(getComputedStyle(document.querySelector("[aria-label=Theme]")).fontSize)',
						),
					) >= 16,
					"mobile text fields keep the 16px minimum even with a smaller browser default",
				);
			} finally {
				await page.evaluate('document.documentElement.style.removeProperty("font-size")');
			}
		});

		await t.test("message input keeps readable mobile type", async () => {
			await page.click(".back-to-app");
			await page.wait('!document.querySelector(".settings-view")');
			await settleFrontend(page);
			if (await page.evaluate('Boolean(document.querySelector(".sidebar.mobile-open"))'))
				await toggleConversations(page);
			const font = Number(
				await page.evaluate(
					'parseFloat(getComputedStyle(document.querySelector("textarea[name=message]")).fontSize)',
				),
			);
			assert.ok(font >= 16, `message input: ${font}px type`);
		});

		await t.test("message input has a visible keyboard focus indicator", async () => {
			await page.resize({ width: 1440, height: 900 });
			await settleFrontend(page);
			await page.evaluate(`document.querySelector('[aria-label="Find in conversation"]').focus()`);
			for (let count = 0; count < 30; count++) {
				await page.key("Tab");
				if (await page.evaluate('document.activeElement?.id === "replyInput"')) break;
			}
			assert.equal(await page.evaluate("document.activeElement?.id"), "replyInput");
			assert.equal(
				await page.evaluate(`(() => {
				const field=document.activeElement;
				return field.matches(':focus-visible') && [field,field.closest('.composer-card')].some(node => {
					const style=getComputedStyle(node);
					return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
				});
			})()`),
				true,
				"keyboard focus must remain visibly indicated after the editor removes its own outline",
			);
		});
		assert.equal(
			await page.evaluate('document.querySelector("textarea[name=message]")?.value'),
			"UNSENT ACCESSIBLE DRAFT",
		);
		assert.equal(m.f.requests.length, 0, "typography and focus never send the retained draft");
		assert.equal(m.f.errors.length, 0);
	} finally {
		await browser?.close();
		await app?.close();
		await m.f.close();
	}
});
