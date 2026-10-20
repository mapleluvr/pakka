import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { fixture } from "./fixture.ts";
import { createPocketHttp } from "../src/http.ts";
import { ownedBrowser } from "./browser.ts";

// Hashing raw checkout bytes rather than HTML-parsed newlines blocks imports on Windows.
test("Pocket CSP: import maps execute with LF, CRLF and CR source newlines", { timeout: 30000 }, async () => {
	const m = await fixture();
	let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
	try {
		browser = await ownedBrowser(join(m.f.root, "importmap-chrome"));
		for (const newline of ["\n", "\r\n", "\r"]) {
			const html = [
				'<!doctype html><script type="importmap">',
				'{"imports":{"mapped-dependency":"/dep.js"}}',
				'</script><script type="module" src="/consumer.js"></script>',
			].join(newline);
			const http = await createPocketHttp({
				runtime: m.runtime,
				people: m.people,
				workspace: m.workspace,
				assets: new Map([
					["/", { type: "text/html", body: html }],
					["/dep.js", { type: "text/javascript", body: 'export const value = "IMPORT-MAP-LOADED";' }],
					[
						"/consumer.js",
						{
							type: "text/javascript",
							body: 'import { value } from "mapped-dependency"; document.body.textContent = value;',
						},
					],
				]),
			});
			try {
				const page = await browser.page(http.origin);
				await page.wait('document.body?.textContent === "IMPORT-MAP-LOADED"');
				assert.equal(await page.evaluate("document.body.textContent"), "IMPORT-MAP-LOADED");
				const policy = (await fetch(http.origin)).headers.get("content-security-policy");
				assert.ok(policy?.includes("sha256-"));
				assert.equal(policy?.includes("unsafe-inline"), false);
				await page.close();
			} finally {
				await http.close();
			}
		}
		assert.equal(m.f.requests.length, 0);
	} finally {
		await browser?.close();
		await m.close();
	}
});
