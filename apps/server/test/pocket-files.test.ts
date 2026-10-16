import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, writeFile, readFile, symlink, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { createRuntime } from "@pakka/agent";
import { createPocketPeople } from "../src/pocket-people.ts";
import { createPocketWorkspace } from "../src/pocket-workspace.ts";
import { createPocketFiles, PocketFileConflict } from "../src/pocket-files.ts";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function git(root: string, ...args: string[]) {
	return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@invalid.test", ...args], {
		cwd: root,
		encoding: "utf8",
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		stdio: ["ignore", "pipe", "pipe"],
	});
}
async function setup(respond?: Parameters<typeof runtimeFixture>[2]) {
	const m = await runtimeFixture({}, undefined, respond);
	try {
		const people = await createPocketPeople({ runtime: m.runtime, namespace: "files.people" }),
			session = await people.initializeOwner("Owner"),
			actor = await people.authenticate(session.token),
			workspace = createPocketWorkspace({
				runtime: m.runtime,
				people,
				catalog: { namespace: "files.workspace", maxDeliveries: 8, maxPending: 2 },
				profileCeiling: () => ["default"],
			});
		const ref = await workspace
				.bind(actor)
				.create({ requestId: "project", name: "Project", profile: "default" }),
			hidden = await workspace
				.bind(actor)
				.create({ requestId: "other", name: "Private", profile: "default" }),
			root = join(m.f.root, "project"),
			other = join(m.f.root, "private"),
			worktrees = join(m.f.root, "worktrees");
		await mkdir(root);
		await mkdir(other);
		await writeFile(join(root, "readme.txt"), "BASE\n");
		await writeFile(join(other, "secret.txt"), "OUTSIDE-SECRET");
		git(root, "init", "-b", "main");
		git(root, "add", "readme.txt");
		git(root, "commit", "-m", "initial");
		const roots = [
			{
				id: "project",
				path: root,
				resources: [ref.conversationId],
				writable: true,
				git: true,
				worktreesDir: worktrees,
			},
			{ id: "private", path: other, resources: [hidden.conversationId], writable: true },
		];
		const files = await createPocketFiles({
			runtime: m.runtime,
			people,
			namespace: "files.operations",
			roots,
		});
		return {
			m,
			workspace,
			people,
			session,
			actor,
			ref,
			hidden,
			root,
			other,
			roots,
			worktrees,
			files,
			client: files.bind(actor),
		};
	} catch (error) {
		await m.close();
		throw error;
	}
}
// Ignoring approved roots/current identity, failing hash checks or replaying writes would change real bytes.
test("Pocket files: approved scoped reads and CAS edits have real byte/receipt evidence without model work", async () => {
	const f = await setup();
	try {
		const roots = await f.client.roots(f.ref);
		assert.deepEqual(
			roots.map((row) => row.id),
			["project"],
		);
		assert.equal(Object.isFrozen(roots), true);
		const listing = await f.client.list(f.ref, { root: "project", path: "" });
		assert.ok(listing.entries.some((row) => row.name === "readme.txt"));
		assert.ok(!listing.entries.some((row) => row.name === ".git"));
		const before = await f.client.read(f.ref, { root: "project", path: "readme.txt" });
		assert.equal(before.text, "BASE\n");
		assert.equal(before.sha256, sha("BASE\n"));
		const edit = {
			root: "project",
			path: "readme.txt",
			requestId: "edit",
			expectedSha256: before.sha256,
			text: "HUMAN-EDIT\n",
		};
		const changed = await f.client.write(f.ref, edit);
		assert.equal(changed.state, "done");
		assert.equal(await readFile(join(f.root, "readme.txt"), "utf8"), "HUMAN-EDIT\n");
		assert.deepEqual(await f.client.write(f.ref, edit), changed);
		await assert.rejects(f.client.write(f.ref, { ...edit, requestId: "stale", text: "LOST" }), /conflict/i);
		await assert.rejects(f.client.write(f.ref, { ...edit, text: "changed request" }), /conflict/i);
		const invitation = await f.people.invite(f.actor, {
			requestId: "viewer",
			role: "viewer",
			resources: [f.ref.conversationId],
			ttlMs: 60000,
		});
		assert.ok(invitation.token);
		const viewer = await f.people.authenticate((await f.people.redeem(invitation.token, "Viewer")).token),
			readOnly = f.files.bind(viewer);
		assert.equal((await readOnly.read(f.ref, { root: "project", path: "readme.txt" })).text, "HUMAN-EDIT\n");
		await assert.rejects(
			readOnly.write(f.ref, { ...edit, requestId: "viewer", expectedSha256: sha("HUMAN-EDIT\n") }),
			/denied|authority/i,
		);
		await assert.rejects(readOnly.read(f.hidden, { root: "private", path: "secret.txt" }), /denied|scope/i);
		await assert.rejects(readOnly.read(f.ref, { root: "private", path: "secret.txt" }), /denied|scope/i);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});
// Lexical path checks alone miss directory junctions and hard links; all probes address real disk objects.
test("Pocket files: traversal hidden data junctions and hard links cannot expose another root", async () => {
	const f = await setup();
	try {
		await symlink(f.other, join(f.root, "portal"), process.platform === "win32" ? "junction" : "dir");
		await link(join(f.other, "secret.txt"), join(f.root, "linked.txt"));
		for (const path of [
			"../private/secret.txt",
			"portal/secret.txt",
			"linked.txt",
			".git/config",
			"readme.txt:stream",
			"readme.txt.",
			"C:/Windows/win.ini",
			"%2e%2e/private/secret.txt",
		]) {
			await assert.rejects(f.client.read(f.ref, { root: "project", path }), /path|link|denied|refused/i);
		}
		await assert.rejects(
			createPocketFiles({
				runtime: f.m.runtime,
				people: f.people,
				namespace: "files.unsafe",
				roots: [{ id: "native", path: f.m.f.dataDir, resources: "*" }],
			}),
			/storage|root|private|denied/i,
		);
		assert.equal(await readFile(join(f.other, "secret.txt"), "utf8"), "OUTSIDE-SECRET");
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});
// Upload/export must retain exact bytes, not silently UTF-8 replace data or overwrite an existing file.
test("Pocket files: bounded upload and export preserve original bytes and reject overwrite", async () => {
	const f = await setup();
	try {
		const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10]);
		const uploaded = await f.client.upload(f.ref, {
			root: "project",
			path: "artifact.png",
			requestId: "upload",
			base64: data.toString("base64"),
		});
		assert.equal(uploaded.state, "done");
		assert.deepEqual(await readFile(join(f.root, "artifact.png")), data);
		const exported = await f.client.export(f.ref, { root: "project", path: "artifact.png" });
		assert.equal(exported.sha256, createHash("sha256").update(data).digest("hex"));
		assert.deepEqual(Buffer.from(exported.base64, "base64"), data);
		await assert.rejects(
			f.client.upload(f.ref, {
				root: "project",
				path: "artifact.png",
				requestId: "other",
				base64: Buffer.from("OVERWRITE").toString("base64"),
			}),
			/conflict|exists/i,
		);
		await assert.rejects(
			f.client.upload(f.ref, { root: "project", path: "broken.txt", requestId: "broken", base64: "%%%" }),
			/invalid|base64/i,
		);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});
// Branch/worktree controls must operate on a real approved repository, leave commits intact and not run hooks.
test("Pocket files Git: actual changes branches and managed worktrees are bounded native effects", async () => {
	const f = await setup();
	try {
		await writeFile(join(f.root, "readme.txt"), "REAL-DIFF-CANARY\n");
		const changes = await f.client.changes(f.ref, { root: "project" });
		assert.ok(changes.files.some((row) => row.path === "readme.txt"));
		const diff = await f.client.diff(f.ref, { root: "project", path: "readme.txt" });
		assert.match(diff.text, /\+REAL-DIFF-CANARY/);
		await writeFile(join(f.root, "readme.txt"), "BASE\n");
		const switched = await f.client.switchBranch(f.ref, {
			root: "project",
			requestId: "branch",
			name: "feature-test",
			create: true,
		});
		assert.equal(switched.state, "done");
		assert.equal(git(f.root, "branch", "--show-current").trim(), "feature-test");
		const created = await f.client.addWorktree(f.ref, {
			root: "project",
			requestId: "tree",
			name: "parallel",
			branch: "parallel-work",
		});
		assert.equal(created.state, "done");
		assert.equal(git(join(f.worktrees, "parallel"), "branch", "--show-current").trim(), "parallel-work");
		assert.equal(await readFile(join(f.worktrees, "parallel", "readme.txt"), "utf8"), "BASE\n");
		assert.ok(
			(await f.client.worktrees(f.ref, { root: "project" })).some(
				(row) => row.name === "parallel" && row.branch === "parallel-work",
			),
		);
		await writeFile(join(f.worktrees, "parallel", "uncommitted.txt"), "DO-NOT-LOSE");
		await assert.rejects(
			f.client.removeWorktree(f.ref, { root: "project", requestId: "dirty", name: "parallel", force: false }),
			/dirty|changes|conflict/i,
		);
		assert.equal(await readFile(join(f.worktrees, "parallel", "uncommitted.txt"), "utf8"), "DO-NOT-LOSE");
		const removed = await f.client.removeWorktree(f.ref, {
			root: "project",
			requestId: "remove",
			name: "parallel",
			force: true,
		});
		assert.equal(removed.state, "done");
		assert.ok(git(f.root, "branch", "--list", "parallel-work").includes("parallel-work"));
		assert.deepEqual(await f.client.worktrees(f.ref, { root: "project" }), []);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});
test(
	"Pocket files Git: a real running native input prevents branch changes",
	{ timeout: 10000 },
	async () => {
		const entered = deferred(),
			release = deferred(),
			f = await setup(async () => {
				entered.resolve();
				await release.promise;
				return { text: "NATIVE-WORK-DONE" };
			});
		try {
			const admission = await f.workspace
				.bind(f.actor)
				.submit(f.ref, { requestId: "native-busy", text: "BLOCKED-MODEL-WORK", mode: "prompt" });
			await entered.promise;
			await assert.rejects(
				f.client.switchBranch(f.ref, {
					root: "project",
					requestId: "while-busy",
					name: "forbidden-branch",
					create: true,
				}),
				/conflict/i,
			);
			assert.equal(git(f.root, "branch", "--show-current").trim(), "main");
			release.resolve();
			assert.equal((await f.workspace.bind(f.actor).wait(admission.id)).status, "done");
			assert.equal(f.m.f.requests.length, 1);
		} finally {
			release.resolve();
			await f.m.close();
		}
	},
);
// Establish that the genuine Git hook executes first; its later absence is then positive policy evidence.
test("Pocket files Git: native hooks are disabled and unsafe local config is refused", async () => {
	const f = await setup();
	try {
		const marker = join(f.root, "hook-effect"),
			js = join(f.root, ".git", "hooks", "marker.cjs"),
			hook = join(f.root, ".git", "hooks", "post-checkout");
		await writeFile(js, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'HOOK-RAN')`);
		await writeFile(hook, `#!/bin/sh\nnode '${js.replaceAll("\\", "/").replaceAll("'", "'\\''")}'\n`, {
			mode: 0o700,
		});
		git(f.root, "switch", "-c", "baseline-hook");
		assert.equal(await readFile(marker, "utf8"), "HOOK-RAN");
		await unlink(marker);
		assert.equal(
			(
				await f.client.switchBranch(f.ref, {
					root: "project",
					requestId: "safe-hook",
					name: "safe-branch",
					create: true,
				})
			).state,
			"done",
		);
		await assert.rejects(readFile(marker), { code: "ENOENT" });
		const outside = join(f.other, "included-config");
		await writeFile(outside, "OUTSIDE-CONFIG-CONTENT-IS-NOT-A-CONFIG");
		git(f.root, "config", "include.path", outside);
		await assert.rejects(f.client.changes(f.ref, { root: "project" }), /authority\/path denied/);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});
test("Pocket files: an opaque host guard cannot forge a definite conflict after its own real effect", async () => {
	const f = await setup();
	try {
		const marker = join(f.root, "opaque-effect"),
			guarded = await createPocketFiles({
				runtime: f.m.runtime,
				people: f.people,
				namespace: "files.guarded",
				roots: f.roots,
				beforeChange: () => {
					writeFileSync(marker, "REAL-OPAQUE-EFFECT");
					throw new PocketFileConflict();
				},
			});
		await assert.rejects(
			guarded.bind(f.actor).write(f.ref, {
				root: "project",
				path: "readme.txt",
				requestId: "opaque",
				expectedSha256: sha("BASE\n"),
				text: "NO-FILE-EDIT",
			}),
			(error) =>
				!(error instanceof PocketFileConflict) &&
				error instanceof Error &&
				/unconfirmed.*guard/i.test(error.message),
		);
		assert.equal(await readFile(marker, "utf8"), "REAL-OPAQUE-EFFECT");
		assert.equal(await readFile(join(f.root, "readme.txt"), "utf8"), "BASE\n");
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});
// Controlled public-store restore represents an unconfirmed external effect, not a claim of process-kill testing.
test("Pocket files: restored running intents stay unknown and do not replay disk writes", async () => {
	const f = await setup();
	try {
		const input = {
			root: "project",
			path: "readme.txt",
			requestId: "unconfirmed",
			expectedSha256: sha("BASE\n"),
			text: "FIRST-WRITE\n",
		};
		assert.equal((await f.client.write(f.ref, input)).state, "done");
		const store = f.m.runtime.store({ namespace: "files.operations", maxBytes: 1024 * 1024 }),
			saved = await store.snapshot();
		assert.ok(Array.isArray(saved.data.rows));
		const rows = saved.data.rows.map((row) => {
			assert.ok(row && typeof row === "object" && !Array.isArray(row));
			return { ...row, state: "running" };
		});
		await store.compareAndSet(saved.version, { ...saved.data, rows }, () => {});
		await writeFile(join(f.root, "readme.txt"), "EXTERNAL-STATE-AFTER-UNKNOWN\n");
		const reopened = await createPocketFiles({
				runtime: f.m.runtime,
				people: f.people,
				namespace: "files.operations",
				roots: f.roots,
			}),
			outcome = await reopened.bind(f.actor).write(f.ref, input);
		assert.equal(outcome.state, "unknown");
		assert.equal(outcome.value, undefined);
		assert.equal(await readFile(join(f.root, "readme.txt"), "utf8"), "EXTERNAL-STATE-AFTER-UNKNOWN\n");
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await f.m.close();
	}
});
// Completed request IDs survive reopen; a retry must never overwrite a later outside edit.
test("Pocket files: committed external-effect receipts reconcile after normal reopen without replay", async () => {
	const f = await setup();
	let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const input = {
				root: "project",
				path: "readme.txt",
				requestId: "stable-edit",
				expectedSha256: sha("BASE\n"),
				text: "FIRST-EFFECT\n",
			},
			receipt = await f.client.write(f.ref, input);
		assert.equal(receipt.state, "done");
		const file = f.m.runtime.view().sessionFile;
		await f.m.runtime.close();
		await writeFile(join(f.root, "readme.txt"), "LATER-EXTERNAL-EDIT\n");
		runtime = await createRuntime({ ...f.m.config, reopenSessionFile: file });
		const people = await createPocketPeople({ runtime, namespace: "files.people" }),
			actor = await people.authenticate(f.session.token),
			files = await createPocketFiles({ runtime, people, namespace: "files.operations", roots: f.roots });
		assert.deepEqual(await files.bind(actor).write(f.ref, input), receipt);
		assert.equal(await readFile(join(f.root, "readme.txt"), "utf8"), "LATER-EXTERNAL-EDIT\n");
		assert.equal(
			(await files.bind(actor).receipt(f.ref, { root: "project", requestId: "stable-edit" })).state,
			"done",
		);
		assert.equal(f.m.f.requests.length, 0);
	} finally {
		await runtime?.close();
		await f.m.close();
	}
});
