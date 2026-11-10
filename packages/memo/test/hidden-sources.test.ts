// Regressions for review finding F2: a library reader whom the source provider refuses must
// not learn about a registered source through change facts or through read() error differences.
// Only the ordinary headless client is used.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemo, MemoError, type MemoClient, type Change, type SourceRef } from "../src/index.ts";

const registration = {
	libraryId: "work",
	sourceId: "history",
	requestId: "register-v1",
	baseVersion: 0,
	provider: "archive",
	address: "session:a/book:1",
	version: "v1" as string | null,
	title: "HIDDEN TITLE",
	summary: "hidden summary",
};
async function fixture(t: import("node:test").TestContext) {
	const state = { guestCanRead: false };
	const dir = await mkdtemp(join(tmpdir(), "memo-hidden-"));
	const service = openMemo({
		file: join(dir, "memo.sqlite"),
		providers: {
			archive: {
				check(i) {
					if (i.actorId === "guest" && !state.guestCanRead) throw new MemoError("denied", "private source");
				},
				async read(i) {
					return { ref: i.ref, text: "SOURCE BODY", nextOffset: null };
				},
			},
		},
	});
	t.after(async () => {
		service.close();
		await rm(dir, { recursive: true, force: true });
	});
	service.createLibrary({ id: "work", title: "Work", ownerId: "owner" });
	const owner = service.connect({ id: "owner", check() {} });
	await owner.grant({ libraryId: "work", requestId: "grant-guest", actorId: "guest", role: "reader" });
	await owner.registerSource(registration);
	await owner.registerSource({
		...registration,
		requestId: "register-v2",
		baseVersion: 1,
		version: "v2",
		address: "session:a/book:2",
	});
	const page = await owner.write({
		libraryId: "work",
		requestId: "wiki",
		baseRevision: 0,
		path: "public.md",
		title: "Public",
		markdown: "public",
		summary: "shared",
		sources: [],
	});
	return { state, owner, guest: service.connect({ id: "guest", check() {} }), pageId: page.pageId! };
}
async function allChanges(client: MemoClient) {
	const items: Change[] = [];
	let cursor: string | undefined;
	do {
		const next = await client.changes({ libraryId: "work", limit: 50, cursor });
		items.push(...next.items);
		cursor = next.cursor ?? undefined;
	} while (cursor);
	return items;
}
const ref = (sourceId: string, version: string | null): SourceRef => ({
	kind: "source",
	libraryId: "work",
	sourceId,
	version,
});

test("change facts of a source the provider hides are not published to that reader", async (t) => {
	const f = await fixture(t);
	const hiddenView = await allChanges(f.guest);
	assert.ok(!JSON.stringify(hiddenView).includes("history"), "hidden sourceId disclosed by changes()");
	assert.ok(!JSON.stringify(hiddenView).includes("register-v"), "hidden registration request disclosed");
	assert.ok(
		hiddenView.some((c) => c.objectId === f.pageId),
		"readable Wiki change must remain visible",
	);
	assert.equal((await allChanges(f.owner)).filter((c) => c.action === "registerSource").length, 2);
	f.state.guestCanRead = true;
	assert.ok(
		(await allChanges(f.guest)).some((c) => c.objectId === "history"),
		"source change becomes visible once the provider authorizes the reader",
	);
});

test("membership grant facts are published to managers only", async (t) => {
	const f = await fixture(t);
	assert.equal((await allChanges(f.guest)).filter((c) => c.action === "grant").length, 0);
	assert.equal((await allChanges(f.owner)).filter((c) => c.action === "grant").length, 1);
});

test("read() gives a refused reader one answer for registered, unregistered and mis-versioned sources", async (t) => {
	const f = await fixture(t);
	const probes: Record<string, SourceRef> = {
		unregistered: ref("nothing", "v1"),
		currentVersion: ref("history", "v2"),
		retainedFixedVersion: ref("history", "v1"),
		unknownVersion: ref("history", "v9"),
		floatingVersion: ref("history", null),
	};
	const answers: Record<string, string> = {};
	for (const [name, target] of Object.entries(probes)) {
		try {
			await f.guest.read(target);
			answers[name] = "published";
		} catch (error) {
			answers[name] = error instanceof MemoError ? error.code + "|" + error.message : "non-Memo error";
		}
	}
	assert.equal(
		new Set(Object.values(answers)).size,
		1,
		"distinguishable answers: " + JSON.stringify(answers),
	);
	assert.ok(answers.unregistered!.startsWith("denied|"));
	// An authorized reader still gets precise answers.
	assert.equal((await f.owner.read(probes.currentVersion!)).text, "SOURCE BODY");
	assert.equal((await f.owner.read(probes.retainedFixedVersion!)).text, "SOURCE BODY");
	await assert.rejects(f.owner.read(probes.unknownVersion!), { code: "conflict" });
});
