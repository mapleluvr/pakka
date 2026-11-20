import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { decodeExtensionResponse, type ExtensionCommandEnvelope } from "@pakka/protocol/extension-rpc";
import { isRecord, type ExtensionJson } from "@pakka/protocol/extensions";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { workspaceFilesExtensionRoot, workspaceFilesService } from "../src/workflows.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function git(cwd: string, ...args: string[]) {
	return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@invalid.test", ...args], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
	});
}

// The former file-page checks also protected HTTP authority and real disk/Git effects.
// Keep those contracts here; draft preservation, image decoding and layout are checked on the independent UI.
test(
	"WebUI files HTTP: scoped bytes, conflicts, Git effects and exact two-level receipt recovery",
	{ timeout: 30000 },
	async () => {
		const m = await runtimeFixture();
		await m.runtime.close();
		let app: Awaited<ReturnType<typeof startPocket>> | undefined;
		let loseReply = false,
			writes = 0;
		try {
			await writeFile(join(m.f.cwd, "readme.txt"), "BASE\n");
			const png = Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHfoAAAAASUVORK5CYII=",
				"base64",
			);
			await writeFile(join(m.f.cwd, "pixel.png"), png);
			git(m.f.cwd, "init", "-b", "main");
			git(m.f.cwd, "add", "readme.txt", "pixel.png");
			git(m.f.cwd, "commit", "-m", "initial");
			app = await startPocket({
				runtime: { ...m.config, dataDir: join(m.f.root, "files-http") },
				owner: "Owner",
				initial: [
					{ name: "Project", profile: "default" },
					{ name: "Other", profile: "default" },
				],
				extensions: [{ root: workspaceFilesExtensionRoot, facets: ["backend", "client", "webui"] }],
				extensionServices: async (context) => {
					const service = await workspaceFilesService(context, {
						namespace: "http.files",
						roots: [
							{
								id: "project",
								path: m.f.cwd,
								resources: "*",
								writable: true,
								git: true,
								worktreesDir: join(m.f.root, "trees"),
							},
						],
					});
					return {
						files: {
							...service,
							bind(actor, target, check) {
								const bound = service.bind(actor, target, check);
								return {
									...bound,
									async write(input: Parameters<typeof bound.write>[0]) {
										writes++;
										const result = await bound.write(input);
										if (loseReply) {
											loseReply = false;
											throw Error("TEST LOST COMMITTED FILE REPLY");
										}
										return result;
									},
								};
							},
						},
					};
				},
			});
			const product = app;
			assert.ok(product.initialOwner);
			const admin = await product.people.authenticate(product.initialOwner.token);
			const [first, second] = await product.workspace.bind(admin).navigation();
			assert.ok(first && second);
			const ref = first.ref;
			const invitation = await product.people.invite(admin, {
				requestId: "files-viewer",
				role: "viewer",
				resources: [ref.conversationId],
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const viewerToken = (await product.people.redeem(invitation.token, "Viewer")).token;
			async function login(token: string) {
				const response = await fetch(product.http.origin + "/pakka-webui/exchange", {
					method: "POST",
					headers: { Origin: product.http.origin, "Content-Type": "application/json" },
					body: JSON.stringify({ kind: "session", token }),
				});
				assert.equal(response.status, 200);
				const cookie = response.headers
					.getSetCookie()
					.map((value) => value.split(";")[0]!)
					.join("; ");
				const csrf = /pakka_csrf=([^;]+)/.exec(cookie)?.[1],
					session = /pakka_pocket=([^;]+)/.exec(cookie)?.[1];
				assert.ok(csrf && session);
				const actor = await product.people.authenticate(session);
				return {
					Cookie: cookie,
					"X-Pakka-CSRF": csrf,
					"X-Pakka-Person": product.people.current(actor).id,
					"X-Pakka-Server": product.http.serverId,
				};
			}
			const owner = await login(product.initialOwner.token),
				viewer = await login(viewerToken);
			async function rpc(command: ExtensionCommandEnvelope, auth = owner) {
				const requestId = crypto.randomUUID();
				const response = await fetch(product.http.origin + "/pakka-webui/extensions/rpc", {
					method: "POST",
					headers: { Origin: product.http.origin, "Content-Type": "application/json", ...auth },
					body: JSON.stringify({ version: 3, requestId, command }),
				});
				return decodeExtensionResponse(await response.json(), requestId);
			}
			const listed = await rpc({ op: "list", target: ref });
			assert.ok("result" in listed && listed.result.kind === "registrations");
			const backend = listed.result.registrations.find(
				(row) => row.facet === "backend" && row.manifest.id === "workspace-files",
			);
			assert.ok(backend);
			const command = (
				action: string,
				input: ExtensionJson,
				requestId = crypto.randomUUID(),
				target = ref,
			): ExtensionCommandEnvelope => ({
				op: "call",
				call: {
					extension: "workspace-files",
					generation: backend.generation,
					target,
					action,
					input,
					requestId,
				},
			});
			async function call(
				action: string,
				input: ExtensionJson,
				auth = owner,
				requestId = crypto.randomUUID(),
			) {
				const response = await rpc(command(action, input, requestId), auth);
				assert.ok("result" in response && response.result.kind === "operation");
				return response.result.operation;
			}
			async function value(action: string, input: ExtensionJson, auth = owner) {
				const result = await call(action, input, auth);
				assert.equal(result.state, "done");
				assert.ok(isRecord(result.value));
				return result.value;
			}
			assert.deepEqual((await value("roots", {}, viewer)).roots, [
				{ id: "project", writable: false, git: true },
			]);
			assert.equal((await value("read", { root: "project", path: "readme.txt" })).text, "BASE\n");
			const image = await value("read", { root: "project", path: "pixel.png" }, viewer);
			assert.equal(image.type, "image/png");
			assert.equal(typeof image.base64, "string");
			assert.deepEqual(Buffer.from(image.base64 as string, "base64"), png);
			const foreign = await rpc(
				command("read", { root: "project", path: "readme.txt" }, crypto.randomUUID(), second.ref),
				viewer,
			);
			assert.ok("error" in foreign && foreign.error.outcome === "denied");
			const denied = await rpc(
				command("write", {
					root: "project",
					path: "readme.txt",
					expectedSha256: sha("BASE\n"),
					text: "FORGED",
				}),
				viewer,
			);
			assert.ok("error" in denied && denied.error.outcome === "denied");
			assert.equal(writes, 0);
			await writeFile(join(m.f.cwd, "readme.txt"), "OUTSIDE-EDIT\n");
			const conflict = await value("write", {
				root: "project",
				path: "readme.txt",
				expectedSha256: sha("BASE\n"),
				text: "STALE-DRAFT",
			});
			assert.equal(conflict.state, "conflict");
			assert.equal(await readFile(join(m.f.cwd, "readme.txt"), "utf8"), "OUTSIDE-EDIT\n");
			loseReply = true;
			const originalId = crypto.randomUUID(),
				before = writes;
			const lost = await call(
				"write",
				{ root: "project", path: "readme.txt", expectedSha256: sha("OUTSIDE-EDIT\n"), text: "SAVED-ONCE\n" },
				owner,
				originalId,
			);
			assert.equal(lost.state, "unknown");
			assert.equal(await readFile(join(m.f.cwd, "readme.txt"), "utf8"), "SAVED-ONCE\n");
			const query: ExtensionCommandEnvelope = {
				op: "operationByRequest",
				request: { extension: "workspace-files", requestId: originalId, target: ref },
			};
			const outer = await rpc(query);
			assert.ok("result" in outer && outer.result.kind === "operation");
			assert.equal(outer.result.operation.id, lost.id);
			assert.equal((await value("receipt", { root: "project", requestId: lost.id })).state, "done");
			assert.equal(writes, before + 1);
			const ownIdentity = await call("receipt", { root: "project", requestId: originalId });
			assert.equal(ownIdentity.state, "unknown");
			const otherQuery = await rpc(query, viewer);
			assert.ok("error" in otherQuery && otherQuery.error.outcome === "denied");
			assert.equal((await call("receipt", { root: "project", requestId: lost.id }, viewer)).state, "unknown");
			assert.ok(
				JSON.stringify(await value("diff", { root: "project", path: "readme.txt" })).includes("+SAVED-ONCE"),
			);
			assert.equal(
				(await value("switch-branch", { root: "project", name: "blocked", create: true })).state,
				"conflict",
			);
			assert.equal(git(m.f.cwd, "branch", "--show-current").trim(), "main");
			assert.equal(
				(
					await value("write", {
						root: "project",
						path: "readme.txt",
						expectedSha256: sha("SAVED-ONCE\n"),
						text: "BASE\n",
					})
				).state,
				"done",
			);
			assert.equal(
				(await value("switch-branch", { root: "project", name: "http-work", create: true })).state,
				"done",
			);
			assert.equal(git(m.f.cwd, "branch", "--show-current").trim(), "http-work");
			const untrusted = "<script>window.__file_executed=true</script>";
			assert.equal(
				(
					await value("upload", {
						root: "project",
						path: "untrusted.html",
						base64: Buffer.from(untrusted).toString("base64"),
					})
				).state,
				"done",
			);
			assert.equal(await readFile(join(m.f.cwd, "untrusted.html"), "utf8"), untrusted);
			const exported = await value("export", { root: "project", path: "untrusted.html" }, viewer);
			assert.equal(exported.base64, Buffer.from(untrusted).toString("base64"));
			assert.equal(
				(await value("add-worktree", { root: "project", name: "parallel", branch: "http-parallel" })).state,
				"done",
			);
			const tree = join(m.f.root, "trees", "parallel");
			assert.equal(git(tree, "branch", "--show-current").trim(), "http-parallel");
			assert.equal(await readFile(join(tree, "readme.txt"), "utf8"), "BASE\n");
			await writeFile(join(tree, "uncommitted.txt"), "PRESERVE");
			assert.equal(
				(await value("remove-worktree", { root: "project", name: "parallel", force: false })).state,
				"conflict",
			);
			assert.equal(await readFile(join(tree, "uncommitted.txt"), "utf8"), "PRESERVE");
			assert.equal(
				(await value("remove-worktree", { root: "project", name: "parallel", force: true })).state,
				"done",
			);
			assert.deepEqual((await value("worktrees", { root: "project" })).worktrees, []);
			assert.ok(git(m.f.cwd, "branch", "--list", "http-parallel").includes("http-parallel"));
			assert.equal(m.f.requests.length, 0);
			assert.deepEqual(m.f.errors, []);
		} finally {
			await app?.close();
			await m.close();
		}
	},
);
