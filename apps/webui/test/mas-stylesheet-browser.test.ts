import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { createMas } from "@pakka/mas";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { masWorkbenchService } from "../../../packages/mas-devpack/src/backend.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend } from "./frontend-controls.ts";

// A removed readiness boundary must expose clickable, unstyled Team controls
// while the real board.css response is held, or expose controls after a CSS error.
for (const outcome of ["loaded", "failed"] as const) {
	test(
		`Team waits for its stylesheet and fails closed when it is ${outcome}`,
		{ timeout: 45000 },
		async () => {
			const m = await runtimeFixture();
			await m.runtime.close();
			let app: Awaited<ReturnType<typeof startPocket>> | undefined;
			let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
			let release = () => {};
			let requested = () => {};
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const seen = new Promise<void>((resolve) => {
				requested = resolve;
			});
			let upstream: URL | undefined;
			const proxy = createServer(async (req, res) => {
				if (!upstream) {
					res.writeHead(503).end();
					return;
				}
				if (req.url?.endsWith("/board.css")) {
					requested();
					await held;
					if (res.destroyed) return;
					if (outcome === "failed") {
						res.writeHead(503, { "Content-Type": "text/plain" }).end("Unavailable");
						return;
					}
				}
				// Preserve the real backend's host/origin checks across this owned test proxy.
				const forward = request(
					new URL(req.url ?? "/", upstream),
					{
						method: req.method,
						headers: {
							...req.headers,
							host: upstream.host,
							...(req.headers.origin ? { origin: upstream.origin } : {}),
						},
					},
					(response) => {
						res.writeHead(response.statusCode ?? 502, { ...response.headers, "cache-control": "no-store" });
						response.pipe(res);
					},
				);
				forward.on("error", () => {
					if (!res.headersSent) res.writeHead(502);
					res.end();
				});
				req.pipe(forward);
			});
			try {
				proxy.listen(0, "127.0.0.1");
				await once(proxy, "listening");
				const address = proxy.address();
				assert.ok(address && typeof address !== "string");
				app = await startPocket({
					runtime: { ...m.config, dataDir: join(m.f.root, "stylesheet") },
					owner: "Owner",
					extensions: [{ root: resolve("packages/mas-devpack/dist") }],
					extensionServices: async (context) => {
						const mas = await createMas({
							runtime: context.runtime,
							namespace: "stylesheet.team",
							maxDeliveries: 8,
							maxPending: 4,
						});
						await mas.bootstrap([{ key: "coordinator", owner: context.ownerId }]);
						await mas.activate();
						return { mas: masWorkbenchService({ ...context, mas }) };
					},
				});
				upstream = new URL(app.http.origin);
				assert.ok(app.initialOwner);
				browser = await ownedBrowser(join(m.f.root, "chrome"));
				const page = await browser.page(`http://127.0.0.1:${address.port}/#signin=${app.initialOwner.token}`);
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click("[data-action=signin]");
				await page.wait('document.querySelector("[data-interface=mas-devpack-board]")');
				await settleFrontend(page);
				await page.click("[data-interface=mas-devpack-board]");
				await seen;
				// The member in the sidebar is not evidence that Team has rendered.
				// Observe either its actual member control or the explicit loading boundary.
				await page.wait(
					`Boolean(document.querySelector('.graph-board [data-member=coordinator]')) || [...document.querySelectorAll('[role=status]')].some(e => e.textContent.includes('Loading team appearance'))`,
				);
				const pendingStyles = await page.evaluate(
					`[...document.querySelectorAll('link[rel=stylesheet]')].filter(e => e.href.endsWith('/board.css') && !e.sheet).length`,
				);
				assert.ok(Number(pendingStyles) > 0, "The real board.css response is still held");
				const heldControls = await page.evaluate(
					'[...document.querySelectorAll(".graph-board button")].filter(e=>!e.disabled && e.getBoundingClientRect().width && e.getBoundingClientRect().height).map(e=>e.textContent)',
				);
				const evidence = join(process.env.PAKKA_TEST_ARTIFACTS ?? m.f.root, "mas-stylesheet");
				await mkdir(evidence, { recursive: true });
				await writeFile(
					join(evidence, `${outcome}-held.json`),
					JSON.stringify({ pendingStyles, heldControls }, null, 2),
				);
				if (outcome === "loaded")
					assert.deepEqual(
						heldControls,
						[],
						"Team must not expose clickable controls before board.css loads",
					);
				release();
				if (outcome === "failed") {
					await page.wait(
						'document.querySelector("[role=alert]")?.textContent.includes("Team appearance could not load")',
					);
					assert.equal(await page.evaluate('document.querySelectorAll("[data-board-tab]").length'), 0);
				} else {
					await page.wait('document.querySelector("[data-member=coordinator]")');
					await page.click("[data-board-mode=list]");
					await page.wait('document.querySelector(".graph-agent-list")');
					await page.click("[data-member=coordinator]");
					await page.click("[data-open-conversation=coordinator]");
					await page.wait('document.querySelector("[data-return-extension]")');
					await page.click("[data-return-extension]");
					await page.wait('document.querySelector("[data-member=coordinator]")');
					await page.click("[data-board-tab=history]");
					await page.wait('document.querySelector(".graph-history")');
					await page.resize({ width: 360, height: 600 });
					await settleFrontend(page);
					await page.click("[data-board-mode=list]");
					await page.wait('document.querySelector(".graph-agent-list")');
				}
				assert.equal(m.f.requests.length, 0, "loading and navigating styles never submits model work");
			} finally {
				release();
				await browser?.close();
				proxy.closeAllConnections();
				await new Promise<void>((resolve) => proxy.close(() => resolve()));
				await app?.close();
				await m.f.close();
			}
		},
	);
}
