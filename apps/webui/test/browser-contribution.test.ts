import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceBrowserExtensionRoot, workspaceBrowserService } from "../src/workflows.ts";
import { browserExecutable, ownedBrowser } from "./browser.ts";
import { toggleConversations } from "./frontend-controls.ts";

test(
	"Pocket browser contribution: actual UI controls owned page, real frame renders, mobile viewer cannot act",
	{ timeout: 30000 },
	async (t) => {
		let effects = 0;
		const target = createServer((req, res) => {
			if (req.url === "/effect") {
				effects++;
				res.end("RECORDED");
				return;
			}
			res.setHeader("content-type", "text/html; charset=utf-8");
			res.end(
				"<!doctype html><title>Local project page</title><h1>REAL-PROJECT-PAGE</h1><input id=\"message\"><button id=\"record\" onclick=\"fetch('/effect').then(()=>document.querySelector('#result').textContent='PAGE-EFFECT:'+document.querySelector('#message').value)\">Record</button><output id=\"result\"></output>",
			);
		});
		await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
		const address = target.address();
		assert.ok(address && typeof address !== "string");
		const origin = "http://127.0.0.1:" + address.port;
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			inspector: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "browser-product") },
				owner: "Owner",
				initial: [{ name: "Project browser", profile: "default" }],
				extensions: [{ root: workspaceBrowserExtensionRoot, facets: ["backend", "webui", "client"] }],
				extensionServices: async (context) => ({
					browser: await workspaceBrowserService(context, {
						namespace: "project.browser",
						origins: [origin],
						executable: await browserExecutable(),
						resources: [context.runtime.view().conversations.at(-1)!.conversationId],
					}),
				}),
			});
			assert.ok(app.initialOwner);
			const actor = await app.people.authenticate(app.initialOwner.token),
				ref = (await app.workspace.bind(actor).navigation())[0]!.ref,
				invite = await app.people.invite(actor, {
					requestId: "viewer",
					role: "viewer",
					resources: [ref.conversationId],
					ttlMs: 60000,
				});
			assert.ok(invite.token);
			const session = await app.people.redeem(invite.token, "Viewer");
			inspector = await ownedBrowser(join(m.f.root, "browser-contribution-inspector"));
			const owner = await inspector.page(app.http.origin + "/#signin=" + app.initialOwner.token),
				viewer = await inspector.page(app.http.origin + "/#signin=" + session.token, {
					width: 390,
					height: 844,
				});
			for (const page of [owner, viewer]) {
				await page.wait('document.querySelector("[data-action=signin]")');
				await page.click("[data-action=signin]");
				await page.wait('document.querySelector("[data-conversation]")');
				if (page === viewer) await toggleConversations(page);
				await page.click("[data-conversation]");
				await page.wait('document.querySelector("[data-interface=workspace-browser-browser]")');
				if (page === viewer) await toggleConversations(page);
				await page.click("[data-interface=workspace-browser-browser]");
				await page.wait('document.querySelector("[data-owned-browser]")');
			}
			await owner.type('[name="browser-url"]', origin);
			await owner.click("[data-browser-go]");
			await owner.wait(
				'document.querySelector("[data-browser-text]")?.textContent.includes("REAL-PROJECT-PAGE")',
			);
			await owner.wait('document.querySelector("[data-browser-frame]")?.naturalWidth>0');
			await owner.type('[name="browser-selector"]', "#message");
			await owner.type('[name="browser-text"]', "FROM-PRODUCT-CONTROLS");
			await owner.click("[data-browser-fill]");
			await owner.wait('document.querySelector("[data-browser-fill]")?.disabled === false');
			await owner.evaluate(
				'(()=>{const field=document.querySelector(\'[name="browser-selector"]\');field.value="";field.dispatchEvent(new Event("input",{bubbles:true}));})()',
			);
			await owner.type('[name="browser-selector"]', "#record");
			await owner.wait('document.querySelector("[data-browser-click]")?.disabled === false');
			await owner.evaluate(
				`(()=>{const original=globalThis.fetch;globalThis.fetch=async(...args)=>{const response=await original(...args);if(typeof args[1]?.body==='string'&&args[1].body.includes('"action":"click"')){globalThis.fetch=original;globalThis.__pakkaTestLostAction=true;await response.arrayBuffer();throw Error('TEST-ONLY LOST VISIBLE ACTION RESPONSE');}return response;};})()`,
			);
			await owner.click("[data-browser-click]");
			await owner.wait(
				'document.querySelector("[data-browser-text]")?.textContent.includes("PAGE-EFFECT:FROM-PRODUCT-CONTROLS")',
			);
			assert.equal(effects, 1);
			assert.equal(await owner.evaluate("globalThis.__pakkaTestLostAction"), true);
			await owner.wait('document.querySelector("[data-browser-reconcile]")');
			assert.equal(await owner.evaluate('document.querySelector("[data-browser-click]").disabled'), true);
			await owner.click("[data-conversation]");
			await owner.wait('!document.querySelector("[data-owned-browser]")');
			await owner.click("[data-interface=workspace-browser-browser]");
			await owner.wait('document.querySelector("[data-browser-reconcile]")');
			await owner.wait(
				'document.querySelector("[data-browser-reconcile]")?.disabled === false && document.querySelector("[data-browser-frame]")?.naturalWidth > 0',
			);
			await owner.click("[data-browser-reconcile]");
			await owner.wait('!document.querySelector("[data-browser-reconcile]")');
			assert.equal(effects, 1, "visible action reconciliation after reopen does not click again");
			const recovered = await owner.evaluate(`(async()=>{
			 const {createExtensionClient}=await import('@pakka/webui/client');
			 const client=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}),registration=(await client.list(${JSON.stringify(ref)})).find(row=>row.manifest.id==='workspace-browser');
			 const command={extension:'workspace-browser',generation:registration.generation,action:'click',requestId:'lost-browser-action',target:${JSON.stringify(ref)},input:{selector:'#record'}},original=globalThis.fetch;
			 let dropped=false,first;
			 globalThis.fetch=async(...args)=>{const response=await original(...args);if(typeof args[1]?.body==='string'&&args[1].body.includes('lost-browser-action')){dropped=true;await response.arrayBuffer();throw Error('TEST-ONLY LOST COMPLETED RESPONSE');}return response;};
			 try{first=await client.call(command).catch(error=>({state:error.outcome,name:error.name}));}finally{globalThis.fetch=original;}
			 return {dropped,first,retry:await client.call(command)};
			})()`);
			assert.ok(
				recovered &&
					typeof recovered === "object" &&
					"first" in recovered &&
					"retry" in recovered &&
					"dropped" in recovered,
			);
			assert.equal(recovered.dropped, true);
			assert.ok(recovered.first && typeof recovered.first === "object" && "state" in recovered.first);
			assert.ok(recovered.retry && typeof recovered.retry === "object" && "state" in recovered.retry);
			assert.equal(recovered.first.state, "unknown");
			assert.ok("name" in recovered.first && recovered.first.name === "PocketRemoteError");
			assert.equal(recovered.retry.state, "done");
			assert.equal(effects, 2, "lost result retry does not click the real page again");
			await viewer.wait('document.querySelector("[data-browser-frame]")?.naturalWidth>0');
			await viewer.wait(
				'document.querySelector("[data-browser-text]")?.textContent.includes("PAGE-EFFECT:FROM-PRODUCT-CONTROLS")',
			);
			assert.equal(
				await viewer.evaluate(
					'document.querySelectorAll("[data-browser-go],[data-browser-fill],[data-browser-click]").length',
				),
				0,
			);
			assert.equal(await viewer.evaluate("document.documentElement.scrollWidth>innerWidth"), false);
			const outcome = await viewer.evaluate(
				`(async()=>{const {createExtensionClient}=await import('@pakka/webui/client');const client=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}),registration=(await client.list(${JSON.stringify(ref)})).find(row=>row.manifest.id==='workspace-browser');return client.call({extension:'workspace-browser',generation:registration.generation,action:'click',requestId:'forged-viewer-click',target:${JSON.stringify(ref)},input:{selector:'#record'}}).catch(error=>({name:error.name,state:error.outcome,code:error.code}));})()`,
			);
			assert.ok(outcome && typeof outcome === "object" && "state" in outcome);
			assert.equal(outcome.state, "denied");
			assert.ok("code" in outcome && outcome.code === "FORBIDDEN");
			assert.ok("name" in outcome && outcome.name === "PocketRemoteError");
			assert.equal(effects, 2);
			assert.equal(m.f.requests.length, 0);
			const artifacts =
				process.env.PAKKA_TEST_ARTIFACTS ?? join(process.cwd(), "artifacts", "pakka-pocket", "p5");
			await mkdir(artifacts, { recursive: true });
			await writeFile(join(artifacts, "browser-panel-desktop.png"), await owner.screenshot());
			await writeFile(join(artifacts, "browser-panel-mobile.png"), await viewer.screenshot());
			await t.test("recorded wrapper cannot resolve an unconfirmed native browser action", async () => {
				await owner.evaluate(
					'(()=>{const field=document.querySelector(\'[name="browser-selector"]\');field.value="";field.dispatchEvent(new Event("input",{bubbles:true}));})()',
				);
				await owner.type('[name="browser-selector"]', "#nonexistent-native-control");
				await owner.click("[data-browser-click]");
				await owner.wait(
					'document.querySelector("[data-browser-pending]") && document.querySelector("[data-browser-reconcile]")?.disabled === false',
				);
				const original = await owner.evaluate(
					`(async()=>{const {createExtensionClient}=await import('@pakka/webui/client');const client=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null});return client.operationByRequest({extension:'workspace-browser',requestId:document.querySelector('[data-browser-pending] code').textContent,target:${JSON.stringify(ref)}});})()`,
				);
				assert.ok(original && typeof original === "object" && "state" in original && "value" in original);
				assert.equal(original.state, "done", "extension handler recorded the native result");
				assert.ok(original.value && typeof original.value === "object" && "state" in original.value);
				assert.equal(original.value.state, "unknown", "native missing-control effect is not claimed as done");
				await owner.click("[data-browser-reconcile]");
				await owner.wait(
					'document.querySelector("[data-owned-browser] output")?.textContent.includes("No action was repeated")',
				);
				assert.equal(
					await owner.evaluate('Boolean(document.querySelector("[data-browser-pending]"))'),
					true,
					"unknown native action remains pending after a recorded outer operation",
				);
				assert.equal(await owner.evaluate('document.querySelector("[data-browser-click]").disabled'), true);
				assert.match(
					String(await owner.evaluate('document.querySelector("[data-owned-browser] output").textContent')),
					/Outcome remains unknown/,
				);
				assert.equal(effects, 2, "read-only reconciliation adds no page effects");
			});
		} finally {
			await inspector?.close();
			await app?.close();
			await m.f.close();
			target.closeAllConnections();
			await new Promise<void>((resolve) => target.close(() => resolve()));
		}
	},
);
