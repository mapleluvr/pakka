import { test } from "node:test";
import { strict as assert } from "node:assert";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { conversationAction, toggleConversations, openConversationMenu } from "./frontend-controls.ts";

// This fails if the adopted collaboration controls are decorative, if driver changes stop only the UI,
// or if side chat/notes are promoted to model input. All actions traverse actual Cookie/RPC/SSE.
test(
	"Pocket collaboration browser: attributed human work, driver handoff and scoped mobile live updates",
	{ timeout: 45000 },
	async () => {
		const m = await runtimeFixture({}, undefined, () => ({ text: "EXPLICIT-AGENT-ANSWER" }));
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "shared-data") },
				owner: "Alice",
				initial: [
					{ name: "Shared project", profile: "default" },
					{ name: "Private project", profile: "default" },
				],
			});
			assert.ok(app.initialOwner);
			const actor = await app.people.authenticate(app.initialOwner.token),
				refs = await app.workspace.bind(actor).list(),
				ref = refs[0]!;
			browser = await ownedBrowser(join(m.f.root, "shared-browser"));
			const owner = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await owner.wait('document.querySelector("[data-action=signin]")');
			await owner.click("[data-action=signin]");
			await owner.wait('document.querySelector("[data-conversation]")');
			await owner.click(`[data-conversation="${ref.conversationId}"]`);
			await owner.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await conversationAction(owner, "collaboration");
			await owner.wait('document.querySelector("textarea[name=teamChat]")');
			await owner.type("textarea[name=teamChat]", "SIDE-CHAT-DO-NOT-MODEL");
			await owner.click("[data-action=post-chat]");
			await owner.wait('document.querySelector("[data-chat-message]")?.innerText.includes("Alice")');
			const invitation = await owner.evaluate(
				`(async()=>{const {createPocketClient}=await import('@pakka/client/pocket');return createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request({op:'invite',requestId:'collaboration-driver',role:'driver',resources:[${JSON.stringify(ref.conversationId)}],ttlMs:60000});})()`,
			);
			assert.ok(
				invitation &&
					typeof invitation === "object" &&
					"token" in invitation &&
					typeof invitation.token === "string",
			);
			const guest = await browser.page(app.http.origin + "/#invite=" + invitation.token, {
				width: 390,
				height: 844,
			});
			await guest.wait('document.querySelector("[data-action=signin]")');
			await guest.type("input[name=person]", "Bob");
			await guest.click("[data-action=signin]");
			await guest.wait('document.querySelector("[data-conversation]")');
			await toggleConversations(guest);
			await guest.click("[data-conversation]");
			await openConversationMenu(guest);
			await conversationAction(guest, "collaboration");
			await guest.wait(
				'document.querySelector("[data-chat-message]")?.innerText.includes("SIDE-CHAT-DO-NOT-MODEL")',
			);
			assert.equal(await guest.evaluate('document.querySelectorAll("[data-conversation]").length'), 1);
			await guest.type("textarea[name=teamChat]", "BOB-HUMAN-DRAFT");
			await owner.wait('document.querySelector("[data-presence]")?.innerText.includes("Bob is typing")');
			await guest.click("[data-action=react-chat]");
			await owner.wait('document.querySelector("[data-action=react-chat]")?.textContent.trim() === "1"');
			await owner.click("[data-action=pin-chat]");
			await guest.wait('document.querySelector("[data-chat-message]").innerText.includes("Pinned")');
			await owner.type("textarea[name=sharedNote]", "SHARED-NOTE-DO-NOT-MODEL");
			await owner.click("[data-action=save-note]");
			await guest.wait(
				'document.querySelector("textarea[name=sharedNote]")?.value==="SHARED-NOTE-DO-NOT-MODEL"',
			);
			await guest.type("textarea[name=sharedNote]", "LOCAL-UNSAVED-EDIT");
			await owner.evaluate('document.querySelector("textarea[name=sharedNote]").select()');
			await owner.type("textarea[name=sharedNote]", "WINNING-SECOND-NOTE");
			await owner.click("[data-action=save-note]");
			await guest.wait(
				`document.querySelector('[aria-label="Shared notes"]')?.innerText.includes("Changed by another person")`,
			);
			await guest.click("[data-action=save-note]");
			await guest.wait('document.querySelector("[role=alert]")?.innerText.includes("changed")');
			const unsaved = await guest.evaluate('document.querySelector("textarea[name=sharedNote]").value');
			assert.ok(typeof unsaved === "string" && unsaved.includes("LOCAL-UNSAVED-EDIT"));
			const storedNote = await owner.evaluate(
				`(async()=>{const {createPocketClient}=await import('@pakka/client/pocket');const r=await createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request({op:'collaboration.read',target:${JSON.stringify(ref)}});return {version:r.snapshot.note.version,text:r.snapshot.note.text};})()`,
			);
			assert.deepEqual(storedNote, { version: 2, text: "WINNING-SECOND-NOTE" });
			await owner.click("[data-action=claim-driver]");
			await guest.wait(
				'document.querySelector("[data-driver-status]")?.innerText.includes("Another driver")',
			);
			await owner.click('[aria-label="Close collaboration"]');
			await guest.click('[aria-label="Close collaboration"]');
			const refused = await guest.evaluate(
				`(async()=>{const {createPocketClient}=await import('@pakka/client/pocket');try{await createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request({op:'submit',target:${JSON.stringify(ref)},input:{requestId:'not-driver',text:'FORBIDDEN-DRIVER-WORK',mode:'prompt'}});return 'accepted';}catch(e){return e.outcome;}})()`,
			);
			assert.equal(refused, "denied");
			assert.equal(m.f.requests.length, 0);
			await conversationAction(owner, "collaboration");
			await owner.wait('document.querySelector("[data-action=release-driver]")?.disabled===false');
			await owner.click("[data-action=release-driver]");
			await conversationAction(guest, "collaboration");
			await guest.wait('document.querySelector("[data-action=claim-driver]")?.disabled===false');
			await guest.click("[data-action=claim-driver]");
			await guest.wait(
				'document.querySelector("[data-driver-status]")?.innerText.includes("You are driving")',
			);
			const evidence = join(m.f.root, "collaboration-evidence");
			await mkdir(evidence);
			await writeFile(join(evidence, "desktop.png"), await owner.screenshot());
			await writeFile(join(evidence, "mobile.png"), await guest.screenshot());
			assert.equal(await guest.evaluate("document.documentElement.scrollWidth>innerWidth"), false);
			await guest.click('[aria-label="Close collaboration"]');
			await guest.type("textarea[name=message]", "EXPLICIT-AGENT-WORK");
			await guest.wait('document.querySelector("[data-action=send]")?.disabled===false');
			await guest.click("[data-action=send]");
			await guest.wait('document.querySelector("main").innerText.includes("EXPLICIT-AGENT-ANSWER")');
			assert.equal(m.f.requests.length, 1);
			assert.doesNotMatch(
				JSON.stringify(m.f.requests),
				/SIDE-CHAT-DO-NOT-MODEL|SHARED-NOTE-DO-NOT-MODEL|FORBIDDEN-DRIVER-WORK/,
			);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
