import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startPocket } from "../src/bootstrap.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";

type Product = Awaited<ReturnType<typeof startPocket>>;

// Real persisted children, not fake Runtime objects. Corruption is introduced only
// after every writer closes, and restored from the exact original bytes.
for (const fault of ["missing", "corrupt", "foreign"] as const)
	test(`Session isolation: ${fault} storage cannot block a healthy sibling or replace the original`, async () => {
		const m = await runtimeFixture();
		const config = { ...m.config, dataDir: join(m.f.root, "isolated-product") };
		let app: Product | undefined;
		try {
			await m.runtime.close();
			app = await startPocket({ runtime: config, owner: "Owner" });
			assert.ok(app.initialOwner);
			const token = app.initialOwner.token;
			let actor = await app.people.authenticate(token);
			const original = { requestId: "original-child", name: "Original child", cwd: m.f.cwd };
			const bad = await app.sessions!.create(actor, original);
			const good = await app.sessions!.create(actor, {
				...original,
				requestId: "healthy-child",
				name: "Healthy child",
			});
			let client = app.workspace.bind(actor);
			const a = await client.create({
				requestId: "original-conversation",
				sessionId: bad.id,
				name: "Original work",
				profile: "default",
			});
			const b = await client.create({
				requestId: "healthy-conversation",
				sessionId: good.id,
				name: "Healthy work",
				profile: "default",
			});
			const sent = await client.submit(a, {
				requestId: "one-original-input",
				text: "PRESERVE ORIGINAL INPUT",
				mode: "prompt",
			});
			assert.equal((await client.wait(sent.id, undefined, bad.id)).status, "done");
			assert.equal(m.f.requests.length, 1);
			const before = app.sessions!.runtimeFor(a).view();
			const goodFile = app.sessions!.runtimeFor(b).view().sessionFile;
			const control = app.runtime.view();
			await app.close();
			app = undefined;
			const preserved = await readFile(before.sessionFile);
			const damaged = fault === "foreign" ? await readFile(goodFile) : Buffer.from("not a SQLite database");
			if (fault === "missing") await unlink(before.sessionFile);
			else await writeFile(before.sessionFile, damaged);

			app = await startPocket({
				runtime: { ...config, reopenSessionFile: control.sessionFile },
				owner: "Owner",
			});
			assert.equal(app.runtime.view().sessionId, control.sessionId);
			actor = await app.people.authenticate(token);
			client = app.workspace.bind(actor);
			const listed = await app.sessions!.list(actor);
			assert.equal(listed.find((row) => row.id === bad.id)?.status, "unavailable");
			assert.equal(listed.find((row) => row.id === good.id)?.status, "ready");
			assert.deepEqual(
				(await client.navigation()).map((row) => row.ref),
				[b],
			);
			assert.deepEqual((await client.read(b)).ref, b);
			assert.throws(() => app!.sessions!.runtimeFor(a), /unavailable/i);
			assert.equal((await app.sessions!.lookup(actor, original))?.id, bad.id);
			assert.equal((await app.sessions!.create(actor, original)).status, "unavailable");
			assert.equal(m.f.requests.length, 1, "startup and original-request lookup cannot replay work");
			if (fault === "missing") assert.equal(existsSync(before.sessionFile), false, "no replacement database");
			else
				assert.deepEqual(
					await readFile(before.sessionFile),
					damaged,
					"failed open cannot overwrite the selected artifact",
				);

			await writeFile(before.sessionFile, preserved);
			const restored = await app.sessions!.reopen(actor, bad.id);
			assert.equal(restored.id, bad.id);
			assert.equal(restored.status, "ready");
			const current = app.sessions!.runtimeFor(a);
			assert.equal(current.view().sessionId, before.sessionId);
			assert.deepEqual(current.view().conversations, before.conversations);
			assert.equal(current.view().budget.primaryAttempts, 1);
			assert.match(JSON.stringify((await client.read(a)).entries), /PRESERVE ORIGINAL INPUT/);
			assert.equal((await client.receipt(sent.id, bad.id)).status, "done");
			assert.equal((await app.sessions!.reopen(actor, bad.id)).status, "ready");
			assert.equal(app.sessions!.runtimeFor(a), current, "ready lookup reuses the one Runtime");
			assert.equal(m.f.requests.length, 1);
		} finally {
			await app?.close();
			await m.close();
		}
	});

test("Session recovery cannot initialize an unknown registration even when its original database exists", async () => {
	const m = await runtimeFixture();
	const config = { ...m.config, dataDir: join(m.f.root, "unknown-product") };
	let app: Product | undefined;
	try {
		await m.runtime.close();
		app = await startPocket({ runtime: config, owner: "Owner" });
		assert.ok(app.initialOwner);
		const token = app.initialOwner.token;
		let actor = await app.people.authenticate(token);
		const original = { requestId: "unconfirmed-child", name: "Unconfirmed child", cwd: m.f.cwd };
		const child = await app.sessions!.create(actor, original);
		const file = app.sessions!.runtimeFor({ sessionId: child.id }).view().sessionFile;
		const controlFile = app.runtime.view().sessionFile;
		const registry = app.runtime.store({ namespace: "pocket.sessions", maxBytes: 65536 });
		const saved = await registry.snapshot();
		assert.ok(Array.isArray(saved.data.registrations));
		const registrations = saved.data.registrations.map((row) => {
			assert.ok(row && typeof row === "object" && !Array.isArray(row));
			return { ...row, status: "unknown" };
		});
		await registry.compareAndSet(saved.version, { ...saved.data, registrations }, () => {});
		await app.close();
		app = undefined;
		const bytes = await readFile(file);
		app = await startPocket({ runtime: { ...config, reopenSessionFile: controlFile }, owner: "Owner" });
		actor = await app.people.authenticate(token);
		assert.equal((await app.sessions!.lookup(actor, original))?.status, "unknown");
		await assert.rejects(app.sessions!.reopen(actor, child.id), /unconfirmed|unknown|refused/i);
		assert.deepEqual(await readFile(file), bytes);
		assert.equal((await app.sessions!.lookup(actor, original))?.status, "unknown");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await app?.close();
		await m.close();
	}
});
