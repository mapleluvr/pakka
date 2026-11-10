import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemo } from "../src/index.ts";
async function implementation() {
	const module = await import(new URL("../src/patchouli.ts", import.meta.url).href).catch(
		(e: NodeJS.ErrnoException) => {
			if (e.code !== "ERR_MODULE_NOT_FOUND") throw e;
			return {};
		},
	);
	assert.equal(typeof module.openPatchouli, "function", "Persistent librarian service is missing");
	return module;
}
const owner = { id: "owner", check() {} };
async function fixture(t: import("node:test").TestContext) {
	const mod = await implementation(),
		dir = await mkdtemp(join(tmpdir(), "memo-patchouli-")),
		file = join(dir, "memo.sqlite");
	const memo = openMemo({ file });
	memo.createLibrary({ id: "work", title: "Work", ownerId: "owner" });
	await memo
		.connect(owner)
		.grant({ libraryId: "work", actorId: "patchouli", role: "editor", requestId: "grant" });
	let sends = 0,
		lookups = 0,
		lost = false;
	const deliveries = new Map<string, { id: string; state: string }>();
	const driver = {
		identity: { route: "fixed-runtime-identity" },
		check() {},
		checkInvocation() {},
		async idle() {
			return true;
		},
		async send(input: { requestId: string; text: string }, check: () => void) {
			check();
			sends++;
			const result = { id: "delivery-" + input.requestId, state: "done" };
			deliveries.set(input.requestId, result);
			if (lost) throw Error("lost response");
			return result;
		},
		async lookup(input: { requestId: string; text: string }, check: () => void) {
			check();
			lookups++;
			return deliveries.get(input.requestId) ?? null;
		},
		async observe(receiptId: string, check: () => void) {
			check();
			return [...deliveries.values()].find((d) => d.id === receiptId)!;
		},
		async cancel(_requestId: string, check: () => void) {
			check();
		},
	};
	const options = {
		file,
		id: "patchouli",
		actorId: "patchouli",
		scope: [{ libraryId: "work", write: true }],
		driver,
		authorize(id: string, _action: string) {
			if (id !== "owner") throw Error("not manager");
		},
	};
	const services: any[] = [];
	const open = () => {
		const service = mod.openPatchouli(options);
		services.push(service);
		return service;
	};
	t.after(async () => {
		for (const s of services) s.close();
		memo.close();
		await rm(dir, { recursive: true, force: true });
	});
	return {
		open,
		options,
		driver,
		memo,
		get sends() {
			return sends;
		},
		get lookups() {
			return lookups;
		},
		lose() {
			lost = true;
		},
	};
}

test("Patchouli open/request stay passive; explicit wake reuses one run until business completion, including no publication", async (t) => {
	const f = await fixture(t),
		service = f.open(),
		client = service.connect(owner);
	const first = await client.request({ requestId: "r1", subject: "Read old material", refs: [] });
	const second = await client.request({
		requestId: "r2",
		subject: "Later question",
		refs: [],
		dueAt: Date.now() + 60000,
	});
	assert.equal(f.sends, 0);
	await assert.rejects(client.advance(), { code: "denied" });
	await client.setEnabled(true);
	await client.advance();
	assert.equal(f.sends, 1);
	assert.equal((await client.get(first.runId)).state, "waiting");
	await client.advance();
	assert.equal(f.sends, 1, "native done cannot release the research slot");
	assert.deepEqual(await client.request({ requestId: "r1", subject: "Read old material", refs: [] }), first);
	service.close();
	const reopened = f.open().connect(owner);
	assert.equal((await reopened.get(first.runId)).state, "waiting");
	assert.equal(f.sends, 1);
	assert.equal((await reopened.get(second.runId)).state, "queued");
	await reopened.cancel(second.runId);
	assert.equal((await reopened.get(second.runId)).state, "cancelled");
	await assert.rejects(reopened.request({ requestId: "r1", subject: "different", refs: [] }), {
		code: "conflict",
	});
});

test("Patchouli completion waits for native idle before admitting the next run and cancellation closes a waiting run", async (t) => {
	const f = await fixture(t),
		service = f.open(),
		client = service.connect(owner);
	const first = await client.request({ requestId: "first", subject: "First", refs: [] });
	await client.setEnabled(true);
	await client.advance();
	const second = await client.request({ requestId: "second", subject: "Second", refs: [] });
	f.driver.idle = async () => false;
	await service.finish({}, { runId: first.runId });
	await client.advance();
	assert.equal(f.sends, 1, "completed research must not grant the still-running generation the next run");
	f.driver.idle = async () => true;
	await client.advance();
	assert.equal(f.sends, 2);
	await client.cancel(second.runId);
	assert.equal((await client.get(second.runId)).state, "cancelled");
});

test("timer wake respects dueAt, stops on close and never restarts merely by reopening", async (t) => {
	const f = await fixture(t),
		service = f.open(),
		client = service.connect(owner);
	let notified: () => void = () => {};
	const sent = new Promise<void>((resolve) => {
			notified = resolve;
		}),
		original = f.driver.send;
	f.driver.send = async (...args) => {
		const result = await original(...args);
		notified();
		return result;
	};
	const dueAt = Date.now() + 150;
	const run = await client.request({ requestId: "timed", subject: "Later", refs: [], dueAt });
	await client.setEnabled(true);
	const stop = client.start(100);
	try {
		await Promise.race([
			sent,
			new Promise((_, reject) => {
				const timer = setTimeout(() => reject(Error("Timer did not dispatch")), 2000);
				timer.unref();
			}),
		]);
		assert.ok(Date.now() >= dueAt);
		assert.equal(f.sends, 1);
	} finally {
		stop();
	}
	await client.cancel(run.runId);
	service.close();
	const passive = f.open().connect(owner);
	assert.equal((await passive.get(run.runId)).state, "cancelled");
	assert.equal(f.sends, 1);
});

test("unconfirmed admission keeps its original slot and changed binding cannot impersonate recovery", async (t) => {
	const f = await fixture(t),
		service = f.open(),
		client = service.connect(owner);
	let attempts = 0;
	f.driver.send = async () => {
		attempts++;
		throw Error("Admission response unknown");
	};
	const first = await client.request({ requestId: "one", subject: "Unknown", refs: [] });
	await client.request({ requestId: "two", subject: "Queued", refs: [] });
	await client.setEnabled(true);
	await client.advance();
	await client.advance();
	await client.cancel(first.runId);
	await client.advance();
	assert.equal(attempts, 1);
	assert.equal((await client.get(first.runId)).state, "unknown");
	const mod = await implementation();
	assert.throws(
		() => mod.openPatchouli({ ...f.options, driver: { ...f.driver, identity: { route: "replacement" } } }),
		{ code: "conflict" },
	);
});

test("Patchouli lost dispatch response reconciles original identity and concurrent services never send twice", async (t) => {
	const f = await fixture(t),
		a = f.open().connect(owner),
		b = f.open().connect(owner);
	const run = await a.request({ requestId: "r1", subject: "Inspect", refs: [] });
	await a.setEnabled(true);
	f.lose();
	await Promise.all([a.advance(), b.advance()]);
	assert.equal(f.sends, 1);
	const reopened = f.open().connect(owner);
	await reopened.advance();
	assert.ok(f.lookups >= 1);
	assert.equal(f.sends, 1);
	assert.equal((await reopened.get(run.runId)).deliveryState, "done");
	assert.equal((await reopened.get(run.runId)).state, "waiting");
});
