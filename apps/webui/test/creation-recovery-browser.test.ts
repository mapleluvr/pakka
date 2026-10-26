import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { settleFrontend, type FrontendPage } from "./frontend-controls.ts";
import { decodePocketResponse, type PocketCommand } from "@pakka/protocol/pocket";

async function inspect(page: FrontendPage, command: PocketCommand) {
	const requestId = crypto.randomUUID();
	const body = await page.evaluate(
		`fetch("/pocket/rpc",{method:"POST",headers:{"Content-Type":"application/json","X-Pakka-CSRF":document.cookie.match(/(?:^|; )pakka_csrf=([^;]+)/)[1]},body:JSON.stringify({version:2,requestId:${JSON.stringify(requestId)},command:${JSON.stringify(command)}})}).then(r=>r.json())`,
	);
	const result = decodePocketResponse(body, requestId);
	if (!("result" in result)) throw Error(JSON.stringify(result.error));
	return result.result;
}

for (const lost of ["before-send", "after-commit"]) {
	test(
		`Conversation dialog lost ${lost}: navigation and reconciliation never replace an uncertain admission`,
		{ timeout: 30000 },
		async () => {
			const m = await runtimeFixture();
			let app: Awaited<ReturnType<typeof startPocket>> | undefined,
				browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
			try {
				await m.runtime.close();
				app = await startPocket({
					runtime: { ...m.config, dataDir: join(m.f.root, "creation") },
					owner: "Owner",
					initial: [{ name: "Original", profile: "default" }],
				});
				assert.ok(app.initialOwner);
				browser = await ownedBrowser(join(m.f.root, "creation-browser"));
				const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click('[data-action="signin"]');
				await page.wait('document.querySelector(".primary-nav [data-action=new-conversation]")');
				await settleFrontend(page);
				await page.click('.primary-nav [data-action="new-conversation"]');
				await page.wait('document.querySelector("[data-creation-form] input[name=name]")');
				await page.evaluate(
					`(()=>{const real=window.fetch;let lose=true;window.qaRequests=[];window.fetch=async(input,init)=>{let command;try{command=JSON.parse(init?.body).command;}catch{}if(command)window.qaRequests.push(command);if(lose&&command?.op==='create'){lose=false;if(${JSON.stringify(lost)}==='after-commit'){const response=await real(input,init);await response.text();}throw new TypeError('simulated lost create response');}return real(input,init);};})()`,
				);
				await page.type('input[name="name"]', "Uncertain creation");
				await page.click("[data-create-confirm]");
				await page.wait('document.querySelector("[data-action=check-creation]")');
				assert.equal(
					await page.evaluate('document.querySelector("[data-create-confirm]").disabled'),
					true,
					"unknown creation must not allow a replacement request",
				);
				await page.click('[aria-label="Close creation"]');
				await settleFrontend(page);
				await page.click("[data-conversation]");
				await page.wait('document.querySelector("[data-action=model]")?.disabled===false');
				await page.click('.primary-nav [data-action="new-conversation"]');
				await page.wait('document.querySelector("[data-action=check-creation]")');
				assert.equal(await page.evaluate('document.querySelector("[data-create-confirm]").disabled'), true);
				await page.click('[data-action="check-creation"]');
				if (lost === "after-commit") {
					await page.wait(
						'!document.querySelector("[role=dialog]") && document.querySelector("[data-conversation][aria-current=true]")?.textContent.includes("Uncertain creation")',
					);
					assert.equal(await page.evaluate('document.querySelectorAll("[data-conversation]").length'), 2);
				} else {
					await page.wait(
						'document.querySelector("[data-creation-message]")?.textContent.includes("Nothing was replayed")',
					);
					assert.equal(await page.evaluate('document.querySelector("[data-create-confirm]").disabled'), true);
					assert.equal(await page.evaluate('document.querySelectorAll("[data-conversation]").length'), 1);
				}
				const requests = (await page.evaluate("window.qaRequests")) as { op: string }[];
				assert.equal(requests.filter((row) => row.op === "session.create").length, 0);
				assert.equal(requests.filter((row) => row.op === "create").length, 1);
				assert.equal(requests.filter((row) => row.op === "conversation.lookup").length, 1);
				assert.equal(m.f.requests.length, 0);
			} finally {
				await browser?.close();
				await app?.close();
				await m.close();
			}
		},
	);
}

for (const lostStage of ["session.create", "create"]) {
	test(
		`Two-step creation loses ${lostStage} response: the native parent survives and is never created twice`,
		{ timeout: 30000 },
		async () => {
			const m = await runtimeFixture();
			let app: Awaited<ReturnType<typeof startPocket>> | undefined,
				browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
			try {
				await m.runtime.close();
				app = await startPocket({
					runtime: { ...m.config, dataDir: join(m.f.root, "two-step") },
					owner: "Owner",
				});
				assert.ok(app.initialOwner);
				browser = await ownedBrowser(join(m.f.root, "two-step-browser"));
				const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click('[data-action="signin"]');
				await page.wait('document.querySelector(".primary-nav [data-action=new-conversation]")');
				await settleFrontend(page);
				await page.click('.primary-nav [data-action="new-conversation"]');
				await page.wait('document.querySelector("[data-creation-form] input[name=sessionName]")');
				await page.type('input[name="sessionName"]', "Kept Parent", { replace: true });
				await page.type('input[name="name"]', "Recovered Child");
				await page.evaluate(
					`(()=>{const real=window.fetch;let lose=true;window.qaRequests=[];window.fetch=async(input,init)=>{let command;try{command=JSON.parse(init?.body).command;}catch{}if(command)window.qaRequests.push(command);if(lose&&command?.op===${JSON.stringify(lostStage)}){lose=false;const response=await real(input,init);await response.text();throw new TypeError('simulated lost committed creation response');}return real(input,init);};})()`,
				);
				await page.click("[data-create-confirm]");
				await page.wait('document.querySelector("[data-action=check-creation]")');
				assert.equal(await page.evaluate('document.querySelector("[data-create-confirm]").disabled'), true);
				const listed = await inspect(page, { op: "session.list" });
				if (listed.kind !== "sessions") throw Error("Session list required");
				const parents = listed.sessions;
				assert.equal(parents.length, 1);
				assert.equal(parents[0]?.name, "Kept Parent");
				const parentId = parents[0]!.id;
				await page.click('[aria-label="Close creation"]');
				await page.wait('document.querySelector("[data-action=review-creation]")');
				await page.click('[data-action="review-creation"]');
				await page.wait('document.querySelector("[data-action=check-creation]")');
				await page.click('[data-action="check-creation"]');
				if (lostStage === "session.create") {
					await page.wait(
						'document.querySelector("[data-creation-message]")?.textContent.includes("The original Session is ready")',
					);
					assert.equal(
						((await page.evaluate("window.qaRequests")) as { op: string }[]).filter(
							(row) => row.op === "create",
						).length,
						0,
						"a recovered parent never auto-submits the child step",
					);
					await page.click("[data-create-confirm]");
				}
				await page.wait(
					'!document.querySelector("[role=dialog]") && document.querySelector("[data-conversation][aria-current=true]")?.textContent.includes("Recovered Child")',
				);
				const listing = await inspect(page, { op: "list" });
				if (listing.kind !== "list") throw Error("Conversation list required");
				const refs = listing.conversations;
				assert.equal(refs.length, 1);
				assert.equal(refs[0]?.sessionId, parentId);
				const confirmed = await inspect(page, { op: "session.list" });
				if (confirmed.kind !== "sessions") throw Error("Session list required");
				assert.equal(confirmed.sessions.length, 1);
				assert.equal(app.sessions!.runtimeFor({ sessionId: parentId }).view().sessionId, parentId);
				const requests = (await page.evaluate("window.qaRequests")) as { op: string }[];
				assert.equal(requests.filter((row) => row.op === "session.create").length, 1);
				assert.equal(requests.filter((row) => row.op === "create").length, 1);
				assert.equal(
					requests.filter(
						(row) => row.op === (lostStage === "session.create" ? "session.lookup" : "conversation.lookup"),
					).length,
					1,
				);
				assert.equal(m.f.requests.length, 0);
			} finally {
				await browser?.close();
				await app?.close();
				await m.close();
			}
		},
	);
}
