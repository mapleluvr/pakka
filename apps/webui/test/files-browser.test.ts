import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";
import { workspaceFilesExtensionRoot, workspaceFilesService } from "../src/workflows.ts";
import type { PocketServiceContext } from "@pakka/webui/backend";
function git(path: string, ...args: string[]) {
	return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@invalid.test", ...args], {
		cwd: path,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}
test(
	"Pocket files browser: public extension performs actual edits upload diff branch/worktree effects without hidden model input",
	{ timeout: 25000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined,
			browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
		try {
			await writeFile(join(m.f.cwd, "readme.txt"), "BASE\n");
			git(m.f.cwd, "init", "-b", "main");
			git(m.f.cwd, "add", "readme.txt");
			git(m.f.cwd, "commit", "-m", "initial");
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "files-ui-data") },
				owner: "Owner",
				initial: [{ name: "Project", profile: "default" }],
				extensions: [{ root: workspaceFilesExtensionRoot, facets: ["backend", "webui", "client"] }],
				extensionServices: async (context: PocketServiceContext) => ({
					files: await workspaceFilesService(context, {
						namespace: "browser.files",
						roots: [
							{
								id: "project",
								path: m.f.cwd,
								resources: "*",
								writable: true,
								git: true,
								worktreesDir: join(m.f.root, "parallel"),
							},
						],
					}),
				}),
			});
			assert.ok(app.initialOwner);
			browser = await ownedBrowser(join(m.f.root, "files-browser"));
			const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
			async function click(selector: string) {
				await page.wait(
					`(()=>{const node=document.querySelector(${JSON.stringify(selector)});return !!node&&!node.disabled;})()`,
				);
				await page.click(selector);
			}

			await page.wait('document.querySelector("[data-action=signin]")');
			await click("[data-action=signin]");
			await page.wait('document.querySelector("[data-conversation]")');
			await click("[data-conversation]");
			await page.wait('document.querySelector("[data-interface=workspace-files-files]")');
			await click("[data-interface=workspace-files-files]");
			await page.wait(
				`document.querySelector('[data-workspace-files]') && document.querySelector('[data-file-path="readme.txt"]')`,
			);
			await click("[data-files-git]");
			await page.wait('document.querySelector("[data-current-branch]")?.textContent.includes("main")');
			await page.evaluate(
				`(()=>{const n=document.querySelector('[name="branch"]');n.value='ui-work';n.dispatchEvent(new Event('input',{bubbles:true}));})()`,
			);
			await click("[data-branch-create]");
			await page.wait('document.querySelector("[data-current-branch]")?.textContent.includes("ui-work")');
			assert.equal(git(m.f.cwd, "branch", "--show-current").trim(), "ui-work");
			await click("[data-files-tree]");
			await page.wait(`document.querySelector('[data-file-path="readme.txt"]')`);
			await click('[data-file-path="readme.txt"]');
			await page.wait('document.querySelector("[data-file-editor]")?.value==="BASE\\n"');
			async function edit(text: string) {
				await page.evaluate(
					`(()=>{const n=document.querySelector('[data-file-editor]');n.value=${JSON.stringify(text)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`,
				);
				await click("[data-file-save]");
				await page.wait('document.querySelector("[data-file-status]")?.textContent.includes("Saved")');
			}
			await edit("HUMAN-EDIT-CANARY\n");
			assert.equal(await readFile(join(m.f.cwd, "readme.txt"), "utf8"), "HUMAN-EDIT-CANARY\n");
			await click("[data-files-git]");
			await page.wait(`document.querySelector('[data-change-path="readme.txt"]')`);
			await click('[data-change-path="readme.txt"]');
			await page.wait(
				'document.querySelector("[data-file-diff]")?.textContent.includes("+HUMAN-EDIT-CANARY")',
			);
			await click("[data-files-tree]");
			await click('[data-file-path="readme.txt"]');
			await page.wait('document.querySelector("[data-file-editor]")?.value.includes("HUMAN-EDIT-CANARY")');
			await edit("BASE\n");
			const uploadText = "<script>window.__file_executed=true</script>";
			await page.evaluate(
				`(()=>{const d=new DataTransfer();d.items.add(new File([${JSON.stringify(uploadText)}],'untrusted.html',{type:'text/html'}));const n=document.querySelector('[data-file-upload]');n.files=d.files;n.dispatchEvent(new Event('change',{bubbles:true}));})()`,
			);
			await page.wait(`document.querySelector('[data-file-path="untrusted.html"]')`);
			assert.equal(await readFile(join(m.f.cwd, "untrusted.html"), "utf8"), uploadText);
			await click('[data-file-path="untrusted.html"]');
			await page.wait('document.querySelector("[data-file-editor]")?.value.includes("<script>")');
			assert.equal(await page.evaluate("window.__file_executed===undefined"), true);
			await click("[data-files-git]");
			await page.wait('document.querySelector("[name=worktree]")');
			await page.evaluate(
				`(()=>{for(const [name,value]of[['worktree','parallel'],['worktree-branch','ui-parallel']]){const n=document.querySelector('[name="'+name+'"]');n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));}})()`,
			);
			await click("[data-worktree-create]");
			await page.wait('document.querySelector("[data-worktree-name=parallel]")');
			assert.equal(
				git(join(m.f.root, "parallel", "parallel"), "branch", "--show-current").trim(),
				"ui-parallel",
			);
			assert.equal(await readFile(join(m.f.root, "parallel", "parallel", "readme.txt"), "utf8"), "BASE\n");
			await click('[data-worktree-remove="parallel"]');
			await page.wait('!document.querySelector("[data-worktree-name=parallel]")');
			assert.ok(git(m.f.cwd, "branch", "--list", "ui-parallel").includes("ui-parallel"));
			assert.equal(m.f.requests.length, 0);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await browser?.close();
			await app?.close();
			await m.f.close();
		}
	},
);
