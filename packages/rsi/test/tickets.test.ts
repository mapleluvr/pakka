import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createRuntime } from "../../agent/src/index.ts";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { blockSqliteWrites } from "../../agent/test/native-storage.ts";
import { deferred } from "../../agent/test/fixture.ts";

async function factory(): Promise<typeof import("../src/index.ts").createTicketService> {
	const module = await import(new URL("../src/index.ts", import.meta.url).href).catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
			return {};
		},
	);
	assert.equal(typeof module.createTicketService, "function", "Ticket service production factory is missing");
	return module.createTicketService;
}
const actor = (id: string, role: "submitter" | "handler" | "manager" = "submitter") => ({
	id,
	role: () => role,
	check() {},
});
const request = (requestId: string, title = "A lighter collaboration filesystem") => ({
	requestId,
	title,
	body: "Investigate the cost of independent agent workspaces.",
	sources: ["https://example.org/idea"],
});
const code = (expected: string) => (error: unknown) =>
	!!error && typeof error === "object" && "code" in error && error.code === expected;

test("tickets: submission returns a durable receipt without inference; author edits retain source revisions and original requests", async () => {
	const create = await factory(),
		m = await runtimeFixture();
	try {
		const service = await create({ runtime: m.runtime, namespace: "tickets" });
		const author = service.connect(actor("im-bot"));
		const submitted = await author.submit(request("first"));
		assert.equal(submitted.state, "open");
		assert.equal(submitted.version, 1);
		assert.deepEqual(await author.submit(request("first")), submitted);
		await assert.rejects(author.submit(request("first", "Different payload")), code("conflict"));
		const updated = await author.edit({
			requestId: "edit",
			id: submitted.id,
			expectedVersion: 1,
			title: "Use shared dependencies",
			body: "New evidence",
			sources: [],
		});
		assert.equal(updated.contentRevision, 2);
		assert.deepEqual(
			await author.submit(request("first")),
			submitted,
			"retry returns original receipt, not the edited record",
		);
		const view = await author.get(submitted.id);
		assert.equal(view.ticket.title, "Use shared dependencies");
		assert.deepEqual(
			view.ticket.revisions.map((r: { body: string }) => r.body),
			[request("first").body, "New evidence"],
		);
		assert.equal(view.ticket.runs.length, 0);
		assert.equal(Object.isFrozen(view.ticket.revisions), true);
		assert.deepEqual(await author.lookup("edit"), updated);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("tickets: foreign authors cannot read/edit; assignment allows only the named handler and list pagination filters first", async () => {
	const create = await factory(),
		m = await runtimeFixture();
	try {
		const service = await create({
			runtime: m.runtime,
			namespace: "tickets",
			handlers: [{ id: "worker", label: "Worker", actorId: "worker-bot" }],
		});
		const a = service.connect(actor("a")),
			b = service.connect(actor("b"));
		const manager = service.connect(actor("owner", "manager")),
			worker = service.connect(actor("worker-bot", "handler"));
		const one = await a.submit(request("one"));
		await b.submit(request("hidden"));
		const two = await a.submit(request("two"));
		await assert.rejects(b.get(one.id), code("denied"));
		await assert.rejects(
			b.edit({ requestId: "steal", id: one.id, expectedVersion: 1, title: "stolen", body: "x", sources: [] }),
			code("denied"),
		);
		await assert.rejects(
			a.assign({ requestId: "self-grant", id: one.id, expectedVersion: 1, handlerId: "worker" }),
			code("denied"),
		);
		const page = await a.list({ limit: 1 });
		assert.equal(page.items.length, 1);
		assert.ok(page.cursor);
		const next = await a.list({ limit: 1, cursor: page.cursor! });
		assert.deepEqual([page.items[0]!.id, next.items[0]!.id].sort(), [one.id, two.id].sort());
		assert.equal(next.cursor, null);
		await assert.rejects(worker.get(one.id), code("denied"));
		const assigned = await manager.assign({
			requestId: "assign",
			id: one.id,
			expectedVersion: 1,
			handlerId: "worker",
		});
		const reported = await worker.setState({
			requestId: "report",
			id: one.id,
			expectedVersion: assigned.version,
			state: "waiting",
			text: "Need workload samples",
			links: [],
		});
		assert.equal(reported.state, "waiting");
		assert.equal((await a.get(one.id)).ticket.events.at(-1)!.text, "Need workload samples");
		await assert.rejects(
			worker.edit({
				requestId: "rewrite",
				id: one.id,
				expectedVersion: reported.version,
				title: "changed",
				body: "x",
				sources: [],
			}),
			code("denied"),
		);
		assert.equal((await manager.list()).items.length, 3);
	} finally {
		await m.close();
	}
});

test("tickets: concurrent revisions cannot overwrite each other; revocation during asynchronous preparation prevents a commit", async () => {
	const create = await factory(),
		m = await runtimeFixture();
	try {
		const service = await create({ runtime: m.runtime, namespace: "tickets" });
		let allowed = true;
		const a = service.connect({
			...actor("a"),
			check: () => {
				if (!allowed) throw Error("revoked");
			},
		});
		const first = await a.submit(request("first"));
		const edits = await Promise.allSettled(
			["left", "right"].map((text) =>
				a.edit({ requestId: text, id: first.id, expectedVersion: 1, title: text, body: text, sources: [] }),
			),
		);
		assert.equal(edits.filter((r) => r.status === "fulfilled").length, 1);
		assert.equal((await a.get(first.id)).ticket.revisions.length, 2);
		const late = a.submit(request("revoked-write"));
		allowed = false;
		await assert.rejects(late);
		await assert.rejects(a.list());
		assert.equal((await service.connect(actor("owner", "manager")).list()).items.length, 1);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("tickets: normal Runtime reopen preserves revisions, state and mutation receipts without restarting work", async () => {
	const create = await factory(),
		m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		const service = await create({ runtime: m.runtime, namespace: "tickets" });
		const a = service.connect(actor("a")),
			manager = service.connect(actor("owner", "manager"));
		const first = await a.submit(request("first"));
		await manager.setState({
			requestId: "close",
			id: first.id,
			expectedVersion: 1,
			state: "closed",
			text: "Existing tool meets the need",
			links: ["https://example.org/tool"],
		});
		const before = await a.get(first.id),
			file = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
		const restored = (await create({ runtime: reopened, namespace: "tickets" })).connect(actor("a"));
		assert.deepEqual(await restored.get(first.id), before);
		assert.deepEqual(await restored.submit(request("first")), first);
		await assert.rejects(a.get(first.id));
		assert.equal(m.f.requests.length, 0);
	} finally {
		await reopened?.close();
		await m.close();
	}
});

test("tickets: invalid authority fields cannot create records; corrupt current records are refused rather than reset", async () => {
	const create = await factory(),
		m = await runtimeFixture();
	try {
		const service = await create({ runtime: m.runtime, namespace: "tickets", maxTickets: 1 });
		const a = service.connect(actor("a"));
		await assert.rejects(a.submit({ ...request("forged"), authorId: "owner" } as never), code("invalid"));
		const first = await a.submit(request("first"));
		await a.submit(request("second"));
		const store = m.runtime.records({ namespace: "tickets" });
		const key = "ticket:" + first.id,
			saved = await store.get(key, () => {});
		await store.commit(
			{
				requestId: "corrupt",
				reads: [{ key, version: saved.version }],
				writes: [{ key, data: { schema: 999 } }],
				append: [],
			},
			() => {},
		);
		await assert.rejects(a.get(first.id), code("unknown"));
		const reopened = (await create({ runtime: m.runtime, namespace: "tickets" })).connect(actor("a"));
		await assert.rejects(reopened.get(first.id), code("unknown"));
		assert.deepEqual((await store.get(key, () => {})).data, { schema: 999 });
	} finally {
		await m.close();
	}
});

test("tickets: malformed JSON state cannot commit a status outside the declared scalar schema", async () => {
	const create = await factory(),
		m = await runtimeFixture();
	try {
		const manager = (await create({ runtime: m.runtime, namespace: "tickets" })).connect(
			actor("owner", "manager"),
		);
		const created = await manager.submit(request("first"));
		await assert.rejects(
			manager.setState({
				requestId: "malformed",
				id: created.id,

				expectedVersion: 1,
				state: ["closed"],
				text: "Bad shape",
				links: [],
			} as never),
			code("invalid"),
		);
		assert.equal((await manager.get(created.id)).ticket.state, "open");
		assert.equal(await manager.lookup("malformed"), null);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("tickets: a role downgrade during the real CAS boundary prevents manager effects", async () => {
	const create = await factory(),
		m = await runtimeFixture(),
		entered = deferred(),
		release = deferred();
	let paused = false;
	try {
		const runtime = {
			...m.runtime,
			records: (options: Parameters<typeof m.runtime.records>[0]) => {
				const native = m.runtime.records(options);
				return {
					...native,
					commit: async (...args: Parameters<typeof native.commit>) => {
						if (paused) {
							entered.resolve();
							await release.promise;
						}
						return native.commit(...args);
					},
				};
			},
		};
		const service = await create({
			runtime,
			namespace: "tickets",
			handlers: [{ id: "worker", label: "Worker", actorId: "worker" }],
		});
		let role: "manager" | "submitter" = "manager";
		const manager = service.connect({ id: "owner", role: () => role, check() {} });
		const created = await manager.submit(request("first"));
		paused = true;
		const assignment = manager.assign({
			requestId: "assign",
			id: created.id,
			expectedVersion: 1,
			handlerId: "worker",
		});
		await entered.promise;
		role = "submitter";
		release.resolve();
		await assert.rejects(assignment, code("denied"));
		assert.equal((await manager.get(created.id)).ticket.handler, null);
		assert.equal(m.runtime.view().phase, "ready");
	} finally {
		release.resolve();
		await m.close();
	}
});

test("tickets: a committed write whose authority ends before publication stays unknown, with its receipt recoverable", async () => {
	const create = await factory(),
		m = await runtimeFixture();
	let allowed = true,
		revokeAfterCommit = false;
	try {
		const runtime = {
			...m.runtime,
			records: (options: Parameters<typeof m.runtime.records>[0]) => {
				const native = m.runtime.records(options);
				return {
					...native,
					commit: async (...args: Parameters<typeof native.commit>) => {
						const committed = await native.commit(...args);
						if (revokeAfterCommit) allowed = false;
						return committed;
					},
				};
			},
		};
		const service = await create({ runtime, namespace: "tickets" });
		const author = service.connect({
			id: "author",
			role: () => "submitter",
			check: () => {
				if (!allowed) throw Error("revoked");
			},
		});
		revokeAfterCommit = true;
		await assert.rejects(author.submit(request("committed")), code("unknown"));
		allowed = true;
		assert.ok(await author.lookup("committed"));
		assert.equal((await author.list()).items.length, 1);
	} finally {
		await m.close();
	}
});

test("tickets: real SQLite write failure never returns accepted or drops an earlier ticket", async () => {
	const create = await factory(),
		m = await runtimeFixture();
	let release: (() => void) | undefined;
	try {
		const service = await create({ runtime: m.runtime, namespace: "tickets" });
		const a = service.connect(actor("a"));
		await a.submit(request("first"));
		release = blockSqliteWrites(m.runtime.view().sessionFile);
		await assert.rejects(a.submit(request("uncertain")), code("unknown"));
		await assert.rejects(a.list(), code("unknown"));
		assert.equal(m.runtime.view().phase, "failed");
	} finally {
		release?.();
		await m.close();
	}
});
