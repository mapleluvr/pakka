import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { workspaceFilesExtensionRoot, workspaceFilesService } from "../src/workflows.ts";
import { settleFrontend, toggleConversations } from "./frontend-controls.ts";
import type { PocketServiceContext } from "@pakka/webui/backend";

type Page = Awaited<ReturnType<Awaited<ReturnType<typeof ownedBrowser>>["page"]>>;
async function click(page: Page, selector: string) {
	await page.wait(
		`(()=>{const n=document.querySelector(${JSON.stringify(selector)});return !!n&&!n.disabled;})()`,
	);
	await page.click(selector);
}
async function openFiles(page: Page) {
	await page.wait('document.querySelector("[data-conversation]")');
	if (await page.evaluate("innerWidth<768")) await toggleConversations(page);
	await click(page, "[data-conversation]");
	if (await page.evaluate("innerWidth<768")) await toggleConversations(page);
	await click(page, "[data-interface=workspace-files-files]");
	await settleFrontend(page);
	await page.wait('document.querySelector("[data-workspace-files]")');
	await page.wait('getComputedStyle(document.querySelector("[data-workspace-files]")).display==="grid"');
	await page.wait(`document.querySelector('[data-file-path="readme.txt"]')`);
}
// Omitting a pre-write hash check loses a real outside edit; hiding buttons alone does not protect RPC.
test(
	"Pocket files browser: real edit conflicts keep drafts while a mobile viewer decodes an image without write authority",
	{ timeout: 25000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await writeFile(join(m.f.cwd, "readme.txt"), "FIRST-VERSION\n");
			const png = new PNG({ width: 1, height: 1 });
			png.data.set([255, 0, 0, 255]);
			const image = PNG.sync.write(png);
			await writeFile(join(m.f.cwd, "pixel.png"), image);
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "bounded-files") },
				owner: "Owner",
				initial: [{ name: "Files", profile: "default" }],
				extensions: [{ root: workspaceFilesExtensionRoot, facets: ["backend", "webui", "client"] }],
				extensionServices: async (context: PocketServiceContext) => ({
					files: await workspaceFilesService(context, {
						namespace: "bounded.files",
						roots: [{ id: "project", path: m.f.cwd, resources: "*", writable: true }],
					}),
				}),
			});
			assert.ok(app.initialOwner);
			const initialActor = await app.people.authenticate(app.initialOwner.token),
				ref = (await app.workspace.bind(initialActor).list())[0]!;
			browser = await ownedBrowser(join(m.f.root, "files-boundaries-browser"));
			const owner = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			await owner.wait('document.querySelector("[data-action=signin]")');
			await click(owner, "[data-action=signin]");
			await openFiles(owner);
			await click(owner, '[data-file-path="readme.txt"]');
			await owner.wait('document.querySelector("[data-file-editor]")?.value.includes("FIRST-VERSION")');
			await owner.evaluate(
				`(()=>{const n=document.querySelector('[data-file-editor]');n.value='LOCAL-UNSAVED-DRAFT';n.dispatchEvent(new Event('input',{bubbles:true}));})()`,
			);
			await writeFile(join(m.f.cwd, "readme.txt"), "EXTERNAL-WINNING-EDIT\n");
			await click(owner, "[data-file-save]");
			await owner.wait('document.querySelector("[data-file-status]")?.textContent.includes("Conflict")');
			assert.equal(
				await owner.evaluate('document.querySelector("[data-file-editor]").value'),
				"LOCAL-UNSAVED-DRAFT",
			);
			assert.equal(await readFile(join(m.f.cwd, "readme.txt"), "utf8"), "EXTERNAL-WINNING-EDIT\n");
			await mkdir("artifacts/pakka-pocket/p5", { recursive: true });
			await writeFile("artifacts/pakka-pocket/p5/files-desktop.png", await owner.screenshot());
			const invitation = await owner.evaluate(
				`(async()=>{const {createPocketClient}=await import('@pakka/client/pocket');return createPocketClient({endpoint:location.origin+'/pocket/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}).request({op:'invite',requestId:'file-viewer',role:'viewer',resources:[${JSON.stringify(ref.conversationId)}],ttlMs:60000});})()`,
			);
			assert.ok(
				invitation &&
					typeof invitation === "object" &&
					"token" in invitation &&
					typeof invitation.token === "string",
			);
			const viewer = await browser.page(app.http.origin + "/#invite=" + invitation.token, {
				width: 390,
				height: 844,
			});
			await viewer.wait('document.querySelector("[data-action=signin]")');
			await viewer.type("input[name=person]", "Read only");
			await click(viewer, "[data-action=signin]");
			await openFiles(viewer);
			await click(viewer, '[data-file-path="pixel.png"]');
			await viewer.wait('document.querySelector(".workspace-file-image")?.naturalWidth===1');
			assert.equal(await viewer.evaluate('document.querySelector(".workspace-file-image").naturalHeight'), 1);
			assert.equal(
				await viewer.evaluate(
					'document.querySelector("[data-file-save]")===null&&document.querySelector("[data-file-upload]")===null',
				),
				true,
			);
			assert.equal(await viewer.evaluate("document.documentElement.scrollWidth<=innerWidth"), true);
			const denied = await viewer.evaluate(
				`(async()=>{const {createExtensionClient}=await import('@pakka/webui/client');const c=createExtensionClient({endpoint:location.origin+'/pocket/extensions/rpc',csrf:()=>/pakka_csrf=([^;]+)/.exec(document.cookie)?.[1]??null}),r=(await c.list(${JSON.stringify(ref)})).find(x=>x.manifest.id==='workspace-files');try{await c.call({extension:r.manifest.id,generation:r.generation,action:'write',requestId:'forged-viewer-write',target:${JSON.stringify(ref)},input:{root:'project',path:'readme.txt',expectedSha256:null,text:'FORBIDDEN'}});return 'unexpected-effect';}catch(error){return {code:error.code,outcome:error.outcome};}})()`,
			);
			assert.deepEqual(denied, { code: "FORBIDDEN", outcome: "denied" });
			assert.equal(await readFile(join(m.f.cwd, "readme.txt"), "utf8"), "EXTERNAL-WINNING-EDIT\n");
			assert.deepEqual(await readFile(join(m.f.cwd, "pixel.png")), image);
			await writeFile("artifacts/pakka-pocket/p5/files-mobile.png", await viewer.screenshot());
			assert.equal(m.f.requests.length, 0);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
