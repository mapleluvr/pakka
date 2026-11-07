import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listenHttp } from "@pakka/server/http-listener";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { ownedBrowser } from "./browser.ts";

// A CDP acknowledgement is not a usable new document: a streamed HTTP body
// leaves parsing unfinished until the fixture explicitly releases its final chunk.
test(
	"owned browser reload waits for the new document body, not only the command acknowledgement",
	{ timeout: 20000 },
	async () => {
		const requested = deferred();
		const release = deferred();
		let documents = 0;
		const server = createServer((request, response) => {
			if (request.url !== "/") {
				if (request.url === "/parsing") requested.resolve();
				response.writeHead(204).end();
				return;
			}
			const document = ++documents;
			void (async () => {
				response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
				response.write("<html><body>");
				if (document === 2) {
					response.write("<script>fetch('/parsing')</script>");
					await release.promise;
				}
				response.end(`<p>DOCUMENT-${document}</p></body></html>`);
			})().catch((error) => response.destroy(error));
		});
		const address = await listenHttp(server, { host: "127.0.0.1" });
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		let reload: Promise<void> | undefined;
		try {
			browser = await ownedBrowser(await mkdtemp(join(tmpdir(), "pakka-browser-reload-")));
			const page = await browser.page(`http://127.0.0.1:${address.port}/`);
			await page.wait('document.querySelector("p")?.textContent === "DOCUMENT-1"');
			let finished = false;
			reload = page.reload().then(() => {
				finished = true;
			});
			await requested.promise;
			assert.equal(await page.evaluate("document.readyState"), "loading");
			assert.equal(finished, false, "the reload command acknowledgement must not complete navigation");
			release.resolve();
			await reload;
			assert.equal(await page.evaluate('document.querySelector("p")?.textContent'), "DOCUMENT-2");
			assert.equal(documents, 2);
		} finally {
			release.resolve();
			await reload;
			await browser?.close();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	},
);
