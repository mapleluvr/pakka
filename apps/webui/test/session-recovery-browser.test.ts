import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { startPocket } from "../src/bootstrap.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend, type FrontendPage } from "./frontend-controls.ts";

async function settings(page: FrontendPage) {
	await settleFrontend(page);
	await page.click('.sidebar-footer [aria-label="Settings"]');
	await page.wait('document.querySelector("[data-settings-page=appearance]")');
	assert.equal(
		await page.evaluate('Boolean(document.querySelector("[data-settings-page=sessions]"))'),
		true,
		"Session management remains available even with an unopened child",
	);
	await page.click("[data-settings-page=sessions]");
}

for (const delivery of ["observed", "lost", "directory-lost"] as const)
	test(
		`Session recovery UI preserves the original Session and input after ${delivery} response`,
		{ timeout: 45000 },
		async () => {
			const m = await runtimeFixture();
			const config = { ...m.config, dataDir: join(m.f.root, "recovery-browser") };
			let app: Awaited<ReturnType<typeof startPocket>> | undefined;
			let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
			try {
				await m.runtime.close();
				app = await startPocket({ runtime: config, owner: "Owner" });
				assert.ok(app.initialOwner);
				const token = app.initialOwner.token;
				const actor = await app.people.authenticate(token);
				const bad = await app.sessions!.create(actor, {
					requestId: "original",
					name: "Original Session",
					cwd: m.f.cwd,
				});
				const good = await app.sessions!.create(actor, {
					requestId: "healthy",
					name: "Healthy Session",
					cwd: m.f.cwd,
				});
				const client = app.workspace.bind(actor);
				const ref = await client.create({
					sessionId: bad.id,
					requestId: "work",
					name: "Preserved work",
					profile: "default",
				});
				const receipt = await client.submit(ref, {
					requestId: "original-input",
					text: "PRESERVE THIS ORIGINAL INPUT",
					mode: "prompt",
				});
				assert.equal((await client.wait(receipt.id, undefined, bad.id)).status, "done");
				const file = app.sessions!.runtimeFor(ref).view().sessionFile;
				const controlFile = app.runtime.view().sessionFile;
				await app.close();
				app = undefined;
				const preserved = await readFile(file);
				await unlink(file);
				app = await startPocket({ runtime: { ...config, reopenSessionFile: controlFile }, owner: "Owner" });
				browser = await ownedBrowser(join(m.f.root, "browser"));
				const page = await browser.page(app.http.origin + "/#signin=" + token);
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click("[data-action=signin]");
				await page.wait('document.querySelector(".app-shell")');
				await settings(page);
				const badRow = `[data-session-recovery-row="${bad.id}"]`;
				const goodRow = `[data-session-recovery-row="${good.id}"]`;
				await page.wait(
					`document.querySelector(${JSON.stringify(badRow + " [data-session-recovery-status]")})?.textContent === "Unavailable"`,
				);
				assert.equal(
					await page.evaluate(
						`document.querySelector(${JSON.stringify(goodRow + " [data-session-recovery-status]")}).textContent`,
					),
					"Ready",
				);
				assert.equal(
					await page.evaluate(
						`document.querySelector(${JSON.stringify(badRow + " [data-session-reopen]")}).disabled`,
					),
					false,
				);
				await page.evaluate(`(() => {
				const original = globalThis.fetch;
				globalThis.__sessionOpens = 0;
				globalThis.fetch = async (...args) => {
					const body = typeof args[1]?.body === "string" ? JSON.parse(args[1].body) : undefined;
					if (body?.command?.op === "session.reopen") globalThis.__sessionOpens++;
					const response = await original(...args);
					if (${JSON.stringify(delivery)} === "lost" && body?.command?.op === "session.reopen") throw new Error("Controlled response loss after native reopening");
					if (${JSON.stringify(delivery)} === "directory-lost" && body?.command?.op === "session.list" && globalThis.__sessionOpens > 0 && !globalThis.__directoryLost) {
						globalThis.__directoryLost = true;
						throw new Error("Controlled directory loss after a known opening response");
					}
					return response;
				};
			})()`);
				await writeFile(file, preserved);
				await page.click(badRow + " [data-session-reopen]");
				if (delivery === "lost") {
					await page.wait('document.querySelector("[data-session-open-unknown]")');
					const originalRequest = await page.evaluate(
						'document.querySelector("[data-session-open-request]").textContent',
					);
					await page.click(".back-to-app");
					await settings(page);
					assert.equal(
						await page.evaluate('document.querySelector("[data-session-open-request]").textContent'),
						originalRequest,
					);
					assert.equal(
						await page.evaluate(
							`document.querySelector(${JSON.stringify(badRow + " [data-session-reopen]")}).disabled`,
						),
						true,
					);
					await page.click("[data-session-refresh]");
				}
				if (delivery === "directory-lost") {
					await page.wait(
						'document.querySelector(".pocket-session-recovery")?.textContent.includes("could not be read")',
					);
					assert.equal(
						await page.evaluate('Boolean(document.querySelector("[data-session-open-unknown]"))'),
						false,
						"a failed refresh must not overwrite a known opening response",
					);
					assert.equal(
						await page.evaluate(
							`document.querySelector(${JSON.stringify(badRow + " [data-session-reopen]")}).disabled`,
						),
						true,
						"stale availability must be reread before another opening attempt",
					);
					await page.click("[data-session-refresh]");
				}
				await page.wait(
					`document.querySelector(${JSON.stringify(badRow + " [data-session-recovery-status]")})?.textContent === "Ready"`,
				);
				assert.equal(
					await page.evaluate("globalThis.__sessionOpens"),
					1,
					"reading the current directory cannot resubmit an opening request",
				);
				const reopened = app.sessions!.runtimeFor(ref);
				assert.equal(reopened.view().sessionId, bad.id);
				assert.equal(reopened.view().budget.primaryAttempts, 1);
				assert.match(
					JSON.stringify((await reopened.readConversation(ref, () => {})).entries),
					/PRESERVE THIS ORIGINAL INPUT/,
				);
				assert.equal(m.f.requests.length, 1);
				if (delivery === "lost") {
					await page.resize({ width: 360, height: 600 });
					await settleFrontend(page);
					assert.equal(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
					assert.equal(
						await page.evaluate(
							'document.querySelector("[data-session-refresh]").getBoundingClientRect().height >= 44',
						),
						true,
					);
					assert.equal(
						await page.evaluate(
							'Array.from(document.querySelectorAll(".pocket-session-recovery code")).every(node => node.getBoundingClientRect().right <= innerWidth)',
						),
						true,
					);
				}
			} finally {
				await browser?.close();
				await app?.close();
				await m.close();
			}
		},
	);
