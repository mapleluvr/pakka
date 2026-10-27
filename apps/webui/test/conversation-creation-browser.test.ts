import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend } from "./frontend-controls.ts";
import type { PocketCommand, PocketResult } from "@pakka/protocol/pocket";

async function rpc(
	page: Awaited<ReturnType<Awaited<ReturnType<typeof ownedBrowser>>["page"]>>,
	command: PocketCommand,
): Promise<PocketResult> {
	const response = (await page.evaluate(
		`fetch('/pocket/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Pakka-CSRF':document.cookie.match(/(?:^|; )pakka_csrf=([^;]+)/)[1]},body:JSON.stringify({version:2,requestId:crypto.randomUUID(),command:${JSON.stringify(command)}})}).then(async r=>({status:r.status,body:await r.json()}))`,
	)) as { status: number; body: { result: PocketResult } };
	assert.equal(response.status, 200, JSON.stringify(response.body));
	return response.body.result;
}

// A draft must not create its parent or consume model quota, and its confirmed initial configuration must actually be used.
test(
	"Conversation creation browser: the dedicated form creates its explicit parent and uses the chosen initial model and directory only after confirmation",
	{ timeout: 45000 },
	async () => {
		const m = await runtimeFixture({ profiles: [{ id: "alternate", model: "alternate-local-model" }] });
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			const chosenDirectory = join(m.f.cwd, "chosen-in-dialog");
			await mkdir(chosenDirectory);
			await m.runtime.close();
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "creation-form") },
				owner: "Owner",
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "creation-form-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector(".app-shell")');
			await settleFrontend(page);
			await page.click('.primary-nav [data-action="new-conversation"]');
			await page.wait('document.querySelector("[role=dialog] input[name=sessionName]")');
			assert.equal(
				await page.evaluate('document.querySelector("[role=dialog] input[name=sessionName]").value'),
				"New Session",
			);
			assert.equal(
				await page.evaluate('document.querySelectorAll(".creation-body p.pocket-secondary").length'),
				0,
				"explicit creation controls do not repeat implementation guidance",
			);
			await page.type("input[name=sessionName]", "Dialog Parent", { replace: true });
			await page.type("input[name=name]", "Configured in Dialog", { replace: true });
			await page.click('[data-action="creation-model"]');
			await page.wait('document.querySelector("[data-model-search]")');
			await page.type("[data-model-search]", "alternate local");
			await page.key("Enter");
			await page.wait('!document.querySelector("[data-model-search]")');
			await page.click('[data-action="creation-directory"]');
			const directorySelector = `[data-directory=${JSON.stringify(chosenDirectory)}]`;
			await page.wait(`document.querySelector(${JSON.stringify(directorySelector)})`);
			await page.click(directorySelector);
			await page.wait(
				`document.querySelector('[data-directory-path]').value===${JSON.stringify(chosenDirectory)}`,
			);
			await page.click("[data-use-directory]");
			await page.wait('!document.querySelector("[data-use-directory]")');
			const before = await rpc(page, { op: "session.list" });
			assert.equal(before.kind, "sessions");
			if (before.kind !== "sessions") throw Error("Session result required");
			assert.deepEqual(before.sessions, []);
			assert.equal(m.f.requests.length, 0);
			assert.equal(
				await page.evaluate('Boolean(document.querySelector(".home-view textarea, [data-home-create]"))'),
				false,
			);
			await page.click("[data-create-confirm]");
			await page.wait('document.body.dataset.view==="conversation" && document.querySelector("#replyInput")');
			const list = await rpc(page, { op: "list" });
			assert.equal(list.kind, "list");
			if (list.kind !== "list") throw Error("Navigation result required");
			assert.equal(list.conversations.length, 1);
			assert.equal(list.navigation?.[0]?.name, "Configured in Dialog");
			const target = list.conversations[0]!;
			const configuration = await rpc(page, { op: "configuration", target });
			assert.equal(configuration.kind, "configuration");
			if (configuration.kind !== "configuration") throw Error("Configuration result required");
			assert.deepEqual(configuration.configuration.current, {
				model: "alternate-local-model",
				cwd: chosenDirectory,
			});
			assert.ok(configuration.configuration.session);
			assert.equal(configuration.configuration.session.budget.primaryAttempts, 0);
			assert.equal(m.f.requests.length, 0, "confirming resource creation is not Send");
			const sessions = await rpc(page, { op: "session.list" });
			assert.equal(sessions.kind, "sessions");
			if (sessions.kind !== "sessions") throw Error("Session result required");
			assert.deepEqual(
				sessions.sessions.map((row) => ({ id: row.id, name: row.name, status: row.status })),
				[{ id: target.sessionId, name: "Dialog Parent", status: "ready" }],
			);
			await page.wait(
				'document.querySelector("#replyInput") && !document.querySelector("#replyInput").disabled',
			);
			await page.type("#replyInput", "EXPLICIT-SEND-AFTER-CREATION");
			await page.click('[data-action="send"]');
			await page.wait('document.querySelector("[data-receipt-status=done]")');
			assert.equal(m.f.requests.length, 1);
			assert.equal(m.f.requests[0]?.model, "alternate-local-model");
		} finally {
			await browser?.close();
			await app?.close();
			await m.close();
		}
	},
);
