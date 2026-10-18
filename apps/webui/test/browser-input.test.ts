import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownedBrowser } from "./browser.ts";

test(
	"Browser input driver: Enter activates a plain native button, not only synthetic key handlers",
	{ timeout: 15000 },
	async () => {
		const root = await mkdtemp(join(tmpdir(), "pakka-browser-input-")),
			browser = await ownedBrowser(root);
		try {
			const page = await browser.page(
				"data:text/html," +
					encodeURIComponent(
						'<button autofocus onclick="document.body.dataset.activations=Number(document.body.dataset.activations||0)+1">Native button</button>',
					),
			);
			await page.wait('document.activeElement?.tagName==="BUTTON"');
			await page.key("Enter");
			assert.equal(await page.evaluate("document.body.dataset.activations"), "1");
		} finally {
			await browser.close();
			await rm(root, { recursive: true, force: true });
		}
	},
);
