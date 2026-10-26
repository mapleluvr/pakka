import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";

type Product = Awaited<ReturnType<typeof startPocket>>;
async function connection(app: Product, credential: string | { cookie: string; csrf: string }) {
	let auth: { cookie: string; csrf: string };
	if (typeof credential === "string") {
		const exchanged = await fetch(app.http.origin + "/pocket/exchange", {
			method: "POST",
			headers: { Origin: app.http.origin, "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "session", token: credential }),
		});
		assert.equal(exchanged.status, 200);
		const cookie = exchanged.headers
				.getSetCookie()
				.map((row) => row.split(";")[0])
				.join("; "),
			csrf = /pakka_csrf=([^;]+)/.exec(cookie)?.[1];
		assert.ok(csrf);
		auth = { cookie, csrf };
	} else auth = credential;
	async function raw(command: Record<string, unknown>) {
		const response = await fetch(app.http.origin + "/pocket/rpc", {
			method: "POST",
			headers: {
				Origin: app.http.origin,
				Cookie: auth.cookie,
				"X-Pakka-CSRF": auth.csrf,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ version: 2, requestId: crypto.randomUUID(), command }),
		});
		return { status: response.status, body: await response.json() };
	}
	return Object.assign(
		async (command: Record<string, unknown>) => {
			const result = await raw(command);
			assert.equal(result.status, 200, JSON.stringify(result.body));
			return result.body.result;
		},
		auth,
		{ raw },
	);
}

// Presentation edits must persist separately from each Session's native resource identity and inference budget.
test("Personal navigation: cross-Session folders and grouping persist, delete only ungroups, and original edits never duplicate", async () => {
	const m = await runtimeFixture();
	let app: Product | undefined;
	try {
		await m.runtime.close();
		const dataDir = join(m.f.root, "navigation");
		app = await startPocket({ runtime: { ...m.config, dataDir }, owner: "Owner" });
		assert.ok(app.initialOwner);
		const rpc = await connection(app, app.initialOwner.token);
		const a = (await rpc({ op: "session.create", requestId: "parent-a", name: "Parent A", cwd: m.f.cwd }))
			.session;
		const b = (await rpc({ op: "session.create", requestId: "parent-b", name: "Parent B", cwd: m.f.cwd }))
			.session;
		const first = (
			await rpc({ op: "create", sessionId: a.id, requestId: "first", name: "First", profile: "default" })
		).ref;
		const second = (
			await rpc({ op: "create", sessionId: b.id, requestId: "second", name: "Second", profile: "default" })
		).ref;
		assert.equal(first.conversationId, second.conversationId);
		const rows = (await rpc({ op: "list" })).navigation as { resourceId: string }[];
		assert.notEqual(rows[0]!.resourceId, rows[1]!.resourceId);
		assert.deepEqual((await rpc({ op: "navigation.read" })).view, {
			version: 0,
			mode: "default",
			folders: [],
			assignments: {},
		});
		const original = {
			requestId: "folder-original",
			expectedVersion: 0,
			action: { kind: "folder.create", name: "Projects" },
		};
		const folder = (await rpc({ op: "navigation.update", input: original })).receipt;
		assert.equal(folder.requestId, original.requestId);
		assert.equal(folder.version, 1);
		assert.equal(typeof folder.folderId, "string");
		await rpc({
			op: "navigation.update",
			input: {
				requestId: "move-first",
				expectedVersion: 1,
				action: { kind: "assign", resourceId: rows[0]!.resourceId, folderId: folder.folderId },
			},
		});
		await rpc({
			op: "navigation.update",
			input: {
				requestId: "move-second",
				expectedVersion: 2,
				action: { kind: "assign", resourceId: rows[1]!.resourceId, folderId: folder.folderId },
			},
		});
		await rpc({
			op: "navigation.update",
			input: { requestId: "sort-session", expectedVersion: 3, action: { kind: "mode", mode: "session" } },
		});
		assert.deepEqual((await rpc({ op: "navigation.update", input: original })).receipt, folder);
		assert.deepEqual((await rpc({ op: "navigation.lookup", original })).receipt, folder);
		assert.equal((await rpc({ op: "navigation.read" })).view.version, 4);
		const stale = await rpc.raw({
			op: "navigation.update",
			input: {
				requestId: "stale-edit",
				expectedVersion: 0,
				action: { kind: "folder.create", name: "Must Not Exist" },
			},
		});
		assert.equal(stale.status, 409);
		assert.equal(stale.body.error.code, "CONFLICT");
		const controlFile = app.runtime.view().sessionFile;
		await app.close();
		app = undefined;
		app = await startPocket({
			runtime: { ...m.config, dataDir, reopenSessionFile: controlFile },
			owner: "Owner",
		});
		const reopened = await connection(app, rpc);
		assert.deepEqual((await reopened({ op: "navigation.read" })).view, {
			version: 4,
			mode: "session",
			folders: [{ id: folder.folderId, name: "Projects" }],
			assignments: { [rows[0]!.resourceId]: folder.folderId, [rows[1]!.resourceId]: folder.folderId },
		});
		await reopened({
			op: "navigation.update",
			input: {
				requestId: "rename-folder",
				expectedVersion: 4,
				action: { kind: "folder.rename", folderId: folder.folderId, name: "Work" },
			},
		});
		assert.equal((await reopened({ op: "navigation.read" })).view.folders[0].name, "Work");
		await reopened({
			op: "navigation.update",
			input: {
				requestId: "delete-folder",
				expectedVersion: 5,
				action: { kind: "folder.delete", folderId: folder.folderId },
			},
		});
		assert.deepEqual((await reopened({ op: "navigation.read" })).view, {
			version: 6,
			mode: "session",
			folders: [],
			assignments: {},
		});
		assert.deepEqual((await reopened({ op: "list" })).conversations, [first, second]);
		for (const target of [first, second]) {
			assert.equal((await reopened({ op: "read", target })).snapshot.ref.sessionId, target.sessionId);
			assert.equal(
				(await reopened({ op: "configuration", target })).configuration.session.budget.primaryAttempts,
				0,
			);
		}
		assert.equal(m.f.requests.length, 0);
	} finally {
		await app?.close();
		await m.close();
	}
});

// A read-only viewer may organize personal navigation, never another person's folders or an unreadable same-ID peer.
test("Personal navigation: no folder ACL, independent people, and existing resource authorization before assignment", async () => {
	const m = await runtimeFixture();
	let app: Product | undefined;
	try {
		await m.runtime.close();
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "navigation-people") },
			owner: "Owner",
		});
		assert.ok(app.initialOwner);
		const owner = await connection(app, app.initialOwner.token);
		for (const name of ["Visible", "Private"]) {
			const parent = (await owner({ op: "session.create", requestId: "parent-" + name, name, cwd: m.f.cwd }))
				.session;
			await owner({
				op: "create",
				sessionId: parent.id,
				requestId: "child-" + name,
				name,
				profile: "default",
			});
		}
		const rows = (await owner({ op: "list" })).navigation;
		const privateFolder = (
			await owner({
				op: "navigation.update",
				input: {
					requestId: "owner-folder",
					expectedVersion: 0,
					action: { kind: "folder.create", name: "OWNER-PRIVATE-FOLDER" },
				},
			})
		).receipt.folderId;
		const invite = await owner({
			op: "invite",
			requestId: "viewer",
			role: "viewer",
			resources: [rows[0].resourceId],
			ttlMs: 60000,
		});
		const issued = await app.people.redeem(invite.token, "Viewer");
		const viewer = await connection(app, issued.token);
		assert.deepEqual((await viewer({ op: "navigation.read" })).view.folders, []);
		const ownFolder = (
			await viewer({
				op: "navigation.update",
				input: {
					requestId: "viewer-folder",
					expectedVersion: 0,
					action: { kind: "folder.create", name: "Reading" },
				},
			})
		).receipt.folderId;
		await viewer({
			op: "navigation.update",
			input: {
				requestId: "viewer-move",
				expectedVersion: 1,
				action: { kind: "assign", resourceId: rows[0].resourceId, folderId: ownFolder },
			},
		});
		for (const action of [
			{ kind: "assign", resourceId: rows[1].resourceId, folderId: ownFolder },
			{ kind: "folder.rename", folderId: privateFolder, name: "STOLEN" },
		]) {
			const denied = await viewer.raw({
				op: "navigation.update",
				input: { requestId: crypto.randomUUID(), expectedVersion: 2, action },
			});
			assert.equal(denied.status, 403);
		}
		assert.deepEqual((await owner({ op: "navigation.read" })).view.folders, [
			{ id: privateFolder, name: "OWNER-PRIVATE-FOLDER" },
		]);
		assert.deepEqual((await viewer({ op: "navigation.read" })).view.assignments, {
			[rows[0].resourceId]: ownFolder,
		});
		assert.equal(m.f.requests.length, 0);
	} finally {
		await app?.close();
		await m.close();
	}
});
