import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { decodePocketResponse } from "@pakka/protocol/pocket";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

test(
	"WebUI recoverable model failure: new admission succeeds while its original receipt and spent attempts remain",
	{ timeout: 15000 },
	async () => {
		const m = await runtimeFixture({}, undefined, (_payload, n) =>
			n === 1 ? { error: 400 } : { text: "EXPLICIT-RECOVERY-ANSWER" },
		);
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "input-http-product") },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			const origin = app.http.origin;
			const exchange = await fetch(origin + "/pocket/exchange", {
				method: "POST",
				headers: { Origin: origin, "Content-Type": "application/json" },
				body: JSON.stringify({ kind: "session", token: app.initialOwner.token }),
			});
			assert.equal(exchange.status, 200);
			const cookies = exchange.headers
				.getSetCookie()
				.map((cookie) => cookie.split(";")[0])
				.join("; ");
			const csrf = /pakka_csrf=([^;]+)/.exec(cookies)![1]!;
			const actor = await app.people.authenticate(/pakka_pocket=([^;]+)/.exec(cookies)![1]!);
			const client = app.workspace.bind(actor);
			const ref = (await client.list())[0]!;
			const rpc = async (command: object) => {
				const requestId = crypto.randomUUID();
				const response = await fetch(origin + "/pocket/rpc", {
					method: "POST",
					headers: {
						Origin: origin,
						Cookie: cookies,
						"X-Pakka-CSRF": csrf,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ version: 2, requestId, command }),
				});
				return { response, decoded: decodePocketResponse(await response.json(), requestId) };
			};
			const input = { requestId: "original", text: "FIRST-FAILED", mode: "prompt" as const };
			const start = await rpc({ op: "submit", target: ref, input });
			assert.ok("result" in start.decoded && start.decoded.result.kind === "receipt");
			const id = start.decoded.result.receipt.id;
			await rpc({ op: "wait", id });
			await (await app.runtime.conversation(ref)).waitForIdle();
			const original = await client.receipt(id);
			assert.equal(original.status, "unanswered");
			assert.equal((await client.configuration(ref)).canConfigure, true);
			assert.equal(m.f.requests.length, 1, "the failure must not trigger an automatic retry");
			const retryOriginal = await rpc({ op: "submit", target: ref, input });
			assert.ok("result" in retryOriginal.decoded && retryOriginal.decoded.result.kind === "receipt");
			assert.deepEqual(retryOriginal.decoded.result.receipt, original);
			assert.equal(m.f.requests.length, 1);
			assert.equal(app.runtime.view().budget.primaryAttempts, 1);
			assert.deepEqual(await client.receipt(id), original);
			const recovery = await rpc({
				op: "submit",
				target: ref,
				input: { ...input, requestId: "new", text: "EXPLICIT-RECOVERY" },
			});
			assert.equal(recovery.response.status, 200);
			assert.ok("result" in recovery.decoded && recovery.decoded.result.kind === "receipt");
			const recoveredId = recovery.decoded.result.receipt.id;
			await rpc({ op: "wait", id: recoveredId });
			assert.equal((await client.receipt(recoveredId)).status, "done");
			assert.deepEqual(await client.receipt(id), original);
			assert.equal(m.f.requests.length, 2);
			assert.equal(app.runtime.view().budget.primaryAttempts, 2);
			assert.equal((await client.list()).length, 1, "recovery does not create a replacement Conversation");
		} finally {
			await app?.close();
			await m.f.close();
		}
	},
);

test(
	"WebUI recoverable model failure browser: an explicit new input continues in the same Conversation without replay",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture({}, undefined, (_payload, n) =>
			n === 1 ? { error: 400 } : { text: "EXPLICIT-RECOVERY-ANSWER" },
		);
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "failed-input-product") },
				owner: "Owner",
				initial: [{ name: "Failed project", profile: "default" }],
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "failed-input-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await page.wait('document.querySelector("[data-action=signin]")');
			await page.click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await page.click("[data-conversation]");
			await page.wait('document.querySelector("[data-action=send]")?.disabled === false');
			await page.type("textarea[name=message]", "FIRST-FAILED");
			await page.click("[data-action=send]");
			await page.wait('document.querySelector(".pocket-receipt")?.textContent.includes("unanswered")');
			const receipt = await page.evaluate('document.querySelector(".pocket-receipt").textContent');
			const presentation = await page.evaluate(
				`(()=>{const badge=document.querySelector(".pocket-receipt [data-receipt-reason]");return {text:badge?.textContent,reason:badge?.dataset.receiptReason}})()`,
			);
			assert.deepEqual(presentation, { text: "not delivered", reason: "model_error" });
			assert.doesNotMatch(String(receipt), /blocked|policy refused/);
			const refs = app.runtime.view().conversations;
			const selectedId = await page.evaluate(
				'document.querySelector("[data-conversation][aria-current=true]").dataset.conversation',
			);
			const target = refs.find((ref) => ref.conversationId === selectedId);
			assert.ok(target);
			const originalEntries = (await app.runtime.readConversation(target, () => {})).entries.map(
				(entry) => entry.id,
			);
			assert.equal(
				await page.evaluate(
					'Array.from(document.querySelectorAll("button")).some(button => button.textContent.includes("Retry original request"))',
				),
				false,
			);
			assert.equal(await page.evaluate('document.querySelector(".pocket-receipt").textContent'), receipt);
			assert.equal(m.f.requests.length, 1);
			assert.equal(app.runtime.view().budget.primaryAttempts, 1);
			await page.wait('document.querySelector("[data-action=send]")?.disabled === false');
			await page.type("textarea[name=message]", "EXPLICIT-RECOVERY-INPUT", { replace: true });
			await page.click("[data-action=send]");
			await page.wait('document.body.innerText.includes("EXPLICIT-RECOVERY-ANSWER")');
			assert.equal(m.f.requests.length, 2);
			assert.equal(app.runtime.view().budget.primaryAttempts, 2);
			assert.deepEqual(app.runtime.view().conversations, refs);
			const entries = (await app.runtime.readConversation(target, () => {})).entries.map((entry) => entry.id);
			assert.deepEqual(
				entries.slice(0, originalEntries.length),
				originalEntries,
				"the original failure history remains",
			);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
