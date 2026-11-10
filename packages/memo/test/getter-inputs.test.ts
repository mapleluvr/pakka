// Regressions for review finding F1: every public MemoClient operation must act on one
// stable snapshot of its input. All inputs go through the ordinary headless client returned by
// service.connect(); no database handle or private module is used.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemo, type MemoClient, type Receipt, type Entry } from "../src/index.ts";

const READS = 16;
const MODES = ["once", "from"] as const;
type Mode = (typeof MODES)[number];
/** `key` yields `other` on the k-th read only ("once") or from the k-th read on ("from"). */
function shifting<T extends object>(
	base: T,
	key: string,
	own: unknown,
	other: unknown,
	k: number,
	mode: Mode,
): never {
	let reads = 0;
	const input = { ...base };
	Object.defineProperty(input, key, {
		enumerable: true,
		get: () => {
			reads++;
			return (mode === "once" ? reads === k : reads >= k) ? other : own;
		},
	});
	return input as never;
}
const settle = async <T>(run: () => Promise<T>): Promise<{ value?: T; error?: unknown }> => {
	try {
		return { value: await run() };
	} catch (error) {
		return { error };
	}
};
const page = (libraryId: string, requestId: string, path: string, markdown = "own body") => ({
	libraryId,
	requestId,
	baseRevision: 0,
	path,
	title: "T",
	markdown,
	summary: "own summary",
	sources: [],
});
async function fixture(t: import("node:test").TestContext) {
	const dir = await mkdtemp(join(tmpdir(), "memo-getter-"));
	const service = openMemo({ file: join(dir, "memo.sqlite") });
	t.after(async () => {
		service.close();
		await rm(dir, { recursive: true, force: true });
	});
	service.createLibrary({ id: "mine", title: "Mine", ownerId: "mallory" });
	service.createLibrary({ id: "victim", title: "Victim", ownerId: "alice" });
	const alice = service.connect({ id: "alice", check() {} });
	const mallory = service.connect({ id: "mallory", check() {} });
	const secret = await alice.write({
		...page("victim", "secret", "secret.md", "VICTIM CANARY"),
		summary: "VICTIM SUMMARY",
	});
	const secretRef = { kind: "wiki" as const, libraryId: "victim", pageId: secret.pageId!, revision: 1 };
	const victimIntact = async (label: string) => {
		assert.equal((await alice.read(secretRef)).text, "VICTIM CANARY", label + ": victim page changed");
		await assert.rejects(
			mallory.read(secretRef),
			{ code: "denied" },
			label + ": outsider can read victim page",
		);
		assert.deepEqual(
			(await mallory.libraries()).items.map((r) => r.id),
			["mine"],
			label + ": outsider gained a library",
		);
	};
	return { alice, mallory, secret, victimIntact };
}
const cases = (run: (k: number, mode: Mode, label: string) => Promise<void>) => async () => {
	for (const mode of MODES) for (let k = 1; k <= READS; k++) await run(k, mode, `${mode} read ${k}`);
};

test("grant cannot be redirected to another library by an input that changes between reads", async (t) => {
	const f = await fixture(t);
	await cases(async (k, mode, label) => {
		const input = shifting(
			{ requestId: `grant-${mode}-${k}`, actorId: "mallory", role: "manager" },
			"libraryId",
			"mine",
			"victim",
			k,
			mode,
		);
		await settle(() => f.mallory.grant(input));
		await f.victimIntact(label);
	})();
});

test("exportMarkdown never returns a page of another library", async (t) => {
	const f = await fixture(t);
	const own = await f.mallory.write(page("mine", "own", "own.md"));
	await cases(async (k, mode, label) => {
		const r = await settle(() =>
			f.mallory.exportMarkdown(
				shifting({ libraryId: "mine" }, "pageId", own.pageId, f.secret.pageId, k, mode),
			),
		);
		assert.ok(!String(r.value ?? "").includes("VICTIM"), label + ": exported foreign body");
	})();
});

test("history never returns revisions of another library", async (t) => {
	const f = await fixture(t);
	const own = await f.mallory.write(page("mine", "own", "own.md"));
	await cases(async (k, mode, label) => {
		const r = await settle(() =>
			f.mallory.history(shifting({ libraryId: "mine" }, "pageId", own.pageId, f.secret.pageId, k, mode)),
		);
		const text = JSON.stringify(r.value ?? null);
		assert.ok(!text.includes("VICTIM") && !text.includes("alice"), label + ": foreign revision metadata");
	})();
});

test("restore cannot copy another library's revision into an own page", async (t) => {
	const f = await fixture(t);
	await cases(async (k, mode, label) => {
		const tag = `${mode}-${k}`;
		const first = await f.mallory.write(page("mine", "r1-" + tag, `r-${tag}.md`));
		await f.mallory.write({
			...page("mine", "r2-" + tag, `r-${tag}.md`, "own second"),
			pageId: first.pageId,
			baseRevision: 1,
		});
		await settle(() =>
			f.mallory.restore(
				shifting(
					{ libraryId: "mine", requestId: "rs-" + tag, baseRevision: 2, revision: 1, summary: "x" },
					"pageId",
					first.pageId,
					f.secret.pageId,
					k,
					mode,
				),
			),
		);
		for (const revision of [1, 2, 3]) {
			const view = await settle(() =>
				f.mallory.read({ kind: "wiki", libraryId: "mine", pageId: first.pageId!, revision }),
			);
			assert.ok(!String(view.value?.text ?? "").includes("VICTIM"), label + ": foreign body restored");
		}
		await f.victimIntact(label);
	})();
});

test("remove cannot delete a page of another library", async (t) => {
	const f = await fixture(t);
	await cases(async (k, mode, label) => {
		const tag = `${mode}-${k}`;
		const target = await f.mallory.write(page("mine", "d-" + tag, `d-${tag}.md`));
		await settle(() =>
			f.mallory.remove(
				shifting(
					{ libraryId: "mine", baseRevision: 1, requestId: "rm-" + tag },
					"pageId",
					target.pageId,
					f.secret.pageId,
					k,
					mode,
				),
			),
		);
		await f.victimIntact(label);
	})();
});

test("write stores exactly the values it validated: body limit and Wiki path rules hold", async (t) => {
	const f = await fixture(t);
	const all = async (client: MemoClient) => {
		const items: Entry[] = [];
		let cursor: string | undefined;
		do {
			const next = await client.list({ libraryId: "mine", limit: 50, cursor });
			items.push(...next.items);
			cursor = next.cursor ?? undefined;
		} while (cursor);
		return items;
	};
	await cases(async (k, mode, label) => {
		const tag = `${mode}-${k}`;
		const big = await settle<Receipt>(() =>
			f.mallory.write(
				shifting(
					page("mine", "big-" + tag, `big-${tag}.md`),
					"markdown",
					"ok",
					"x".repeat(1024 * 1024),
					k,
					mode,
				),
			),
		);
		if (big.value?.pageId) {
			const beyond = await settle(() =>
				f.mallory.read(
					{ kind: "wiki", libraryId: "mine", pageId: big.value!.pageId!, revision: big.value!.revision! },
					{ offset: 256 * 1024, limit: 1 },
				),
			);
			assert.ok(!beyond.value?.text, label + ": stored body exceeds the 256 KiB write limit");
		}
		await settle(() =>
			f.mallory.write(
				shifting(page("mine", "path-" + tag, "unused.md"), "path", `p-${tag}.md`, `..\\evil-${tag}`, k, mode),
			),
		);
		for (const entry of await all(f.mallory))
			assert.match(
				entry.path,
				/^(?!.*(^|\/)\.\.?(\/|$))[^\\:]+\.md$/,
				label + ": invalid stored path " + entry.path,
			);
	})();
});
