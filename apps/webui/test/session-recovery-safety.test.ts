import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createRuntime, type Runtime } from "@pakka/agent";
import { createPocketPeople, createPocketWorkspace } from "@pakka/server/pocket";
import { startPocket } from "../src/bootstrap.ts";
import { createManagedSessions, type ManagedSessions } from "../src/sessions.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("Session reopening requires global creation authority and refuses a retained closed Runtime", async () => {
	const m = await runtimeFixture();
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	try {
		await m.runtime.close();
		app = await startPocket({
			runtime: { ...m.config, dataDir: join(m.f.root, "permissions") },
			owner: "Owner",
		});
		assert.ok(app.initialOwner);
		const owner = await app.people.authenticate(app.initialOwner.token);
		const child = await app.sessions!.create(owner, {
			requestId: "child",
			name: "Original child",
			cwd: m.f.cwd,
		});
		const ref = await app.workspace
			.bind(owner)
			.create({ sessionId: child.id, requestId: "work", name: "Work", profile: "default" });
		for (const who of [
			{ name: "Viewer", role: "viewer" as const, resources: "*" as const },
			{ name: "Scoped admin", role: "admin" as const, resources: [app.people.resourceId(ref)] },
		]) {
			const invitation = await app.people.invite(owner, {
				requestId: who.role,
				role: who.role,
				resources: who.resources,
				ttlMs: 60000,
			});
			assert.ok(invitation.token);
			const issued = await app.people.redeem(invitation.token, who.name);
			const actor = await app.people.authenticate(issued.token);
			await assert.rejects(app.sessions!.reopen(actor, child.id), /denied/i);
		}
		const retained = app.sessions!.runtimeFor(ref);
		await retained.close();
		await assert.rejects(app.sessions!.reopen(owner, child.id), /retained|refused/i);
		assert.equal(app.sessions!.runtimeFor(ref), retained);
		assert.equal((await app.sessions!.list(owner)).find((row) => row.id === child.id)?.status, "unavailable");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await app?.close();
		await m.close();
	}
});

test("Session retry does not steal a live writer and succeeds only after that writer closes normally", async () => {
	const m = await runtimeFixture();
	const config = { ...m.config, dataDir: join(m.f.root, "writer-product") };
	let app: Awaited<ReturnType<typeof startPocket>> | undefined;
	let writer: Runtime | undefined;
	try {
		await m.runtime.close();
		app = await startPocket({ runtime: config, owner: "Owner" });
		assert.ok(app.initialOwner);
		const token = app.initialOwner.token;
		let actor = await app.people.authenticate(token);
		const child = await app.sessions!.create(actor, {
			requestId: "child",
			name: "Original child",
			cwd: m.f.cwd,
		});
		const file = app.sessions!.runtimeFor({ sessionId: child.id }).view().sessionFile;
		const controlFile = app.runtime.view().sessionFile;
		const cwdRoots = app.runtime.directoryRoots(["default"]);
		await app.close();
		app = undefined;
		writer = await createRuntime({
			...config,
			cwdRoots,
			reservedSessionId: child.id,
			reopenSessionFile: file,
		});
		app = await startPocket({ runtime: { ...config, reopenSessionFile: controlFile }, owner: "Owner" });
		actor = await app.people.authenticate(token);
		assert.equal((await app.sessions!.reopen(actor, child.id)).status, "unavailable");
		assert.equal(writer.view().phase, "ready");
		assert.equal(writer.view().sessionId, child.id);
		await writer.close();
		writer = undefined;
		assert.equal((await app.sessions!.reopen(actor, child.id)).status, "ready");
		assert.equal(app.sessions!.runtimeFor({ sessionId: child.id }).view().sessionFile, file);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await writer?.close();
		await app?.close();
		await m.close();
	}
});

// The host factory delays returning an actually opened native Runtime. This
// controls the authorization boundary without patching a Runtime or its storage.
test("revocation while a native Session opens closes the acquired writer before any publication", async () => {
	const m = await runtimeFixture();
	let sessions: ManagedSessions | undefined;
	const admitted = deferred<Runtime>();
	const release = deferred<void>();
	let pause = false;
	let outcome: Promise<{ error: unknown } | { result: unknown }> | undefined;
	try {
		const people = await createPocketPeople({
			runtime: m.runtime,
			namespace: "pocket.people",
			resources: () =>
				(sessions?.runtimes() ?? [m.runtime]).flatMap((runtime) => runtime.view().conversations),
		});
		const login = await people.initializeOwner("Owner");
		const owner = await people.authenticate(login.token);
		const invitation = await people.invite(owner, {
			requestId: "recovery-admin",
			role: "admin",
			resources: "*",
			ttlMs: 60000,
		});
		assert.ok(invitation.token);
		const issued = await people.redeem(invitation.token, "Recovery admin");
		const actor = await people.authenticate(issued.token);
		const workspaceFor = (runtime: Runtime) =>
			createPocketWorkspace({
				runtime,
				people,
				catalog: { namespace: "pocket.workspace", maxDeliveries: 512, maxPending: 32 },
				profileCeiling: () => ["default"],
			});
		const options: Parameters<typeof createManagedSessions>[0] = {
			runtime: m.runtime,
			people,
			workspace: workspaceFor(m.runtime),
			workspaceFor,
			profiles: ["default"],
			open: async ({ id, cwd, reopen }) => {
				const runtime = await createRuntime({
					...m.config,
					cwd,
					cwdRoots: m.runtime.directoryRoots(["default"]),
					reservedSessionId: id,
					reopenSessionFile: reopen ? join(m.config.dataDir, "sessions", id, "main.sqlite") : undefined,
				});
				if (pause && reopen) {
					admitted.resolve(runtime);
					await release.promise;
				}
				return runtime;
			},
		};
		sessions = await createManagedSessions(options);
		const child = await sessions.create(owner, { requestId: "child", name: "Original child", cwd: m.f.cwd });
		const file = sessions.runtimeFor({ sessionId: child.id }).view().sessionFile;
		await sessions.close();
		sessions = undefined;
		const bytes = await readFile(file);
		await unlink(file);
		sessions = await createManagedSessions(options);
		await writeFile(file, bytes);
		pause = true;
		outcome = sessions.reopen(actor, child.id).then(
			(result) => ({ result }),
			(error) => ({ error }),
		);
		const acquired = await Promise.race([
			admitted.promise,
			outcome.then((result) => {
				if ("error" in result) throw result.error;
				throw new Error("Session returned without reaching the native-open boundary");
			}),
		]);
		assert.equal((await sessions.list(owner)).find((row) => row.id === child.id)?.status, "unavailable");
		await people.setPerson(owner, issued.person.id, { role: "viewer", resources: "*" });
		release.resolve();
		const settled = await outcome;
		assert.ok("error" in settled);
		assert.equal(
			acquired.view().phase,
			"closed",
			"the native writer acquired during the revoked request is closed",
		);
		assert.equal((await sessions.list(owner)).find((row) => row.id === child.id)?.status, "unavailable");
		pause = false;
		assert.equal((await sessions.reopen(owner, child.id)).status, "ready");
		assert.equal(m.f.requests.length, 0);
	} finally {
		release.resolve();
		await outcome;
		await sessions?.close();
		await m.close();
	}
});
