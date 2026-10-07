import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rename, rm } from "node:fs/promises";
import { deferred, fixture, raw, seed, text } from "./fixture.ts";
import type { Host, HostOptions } from "../src/index.ts";
const cut = { type: "cut" as const, summary: "MUST-NOT-COMMIT", firstKeptEntryId: null, tokensBefore: 1 };
function gatedOptions(
	entered: ReturnType<typeof deferred>,
	release: ReturnType<typeof deferred>,
	onExecute = () => {},
): Partial<HostOptions> {
	return {
		tools: [
			{
				name: "gate",
				description: "Controlled fixture tool",
				parameters: { type: "object", properties: {} },
				execute: async () => {
					onExecute();
					entered.resolve();
					await release.promise;
					return "TOOL-RESULT";
				},
			},
		],
	};
}
async function reachedGate(host: Host, entered: ReturnType<typeof deferred>) {
	await Promise.race([
		entered.promise,
		host.waitForIdle().then(() => assert.fail("configured gate tool did not execute")),
	]);
}

test(
	"prepared steering enters after tools and follow-up remains in native run",
	{ timeout: 15000 },
	async () => {
		const entered = deferred(),
			release = deferred();
		const f = await fixture(
			{
				...gatedOptions(entered, release),
				prepareInput: async ({ text }) => ({ action: "text", text: "PREP:" + text }),
			},
			(_p, n) => (n === 1 ? { tool: "gate" } : { text: "ANSWER" }),
		);
		try {
			const host = await f.start(),
				user = host.connect("user", ["input.submit"]);
			await user.submit({ key: "start", text: "START" });
			await reachedGate(host, entered);
			const steer = await user.submit({ key: "steer", text: "STEERING", mode: "steer" });
			const follow = await user.submit({ key: "follow", text: "FOLLOW", mode: "followUp" });
			release.resolve();
			await host.waitForIdle();
			assert.equal(f.requests.length, 3);
			assert.match(text(f.requests[1]), /TOOL-RESULT/);
			assert.match(text(f.requests[1]), /PREP:STEERING/);
			assert.doesNotMatch(text(f.requests[1]), /PREP:FOLLOW/);
			assert.match(text(f.requests[2]), /PREP:FOLLOW/);
			assert.equal(user.receipt(steer.id)?.state, "committed");
			assert.equal(user.receipt(follow.id)?.state, "committed");
		} finally {
			release.resolve();
			await f.close();
		}
	},
);

test(
	"cancel only this principal's queued objects and allow released identity retry",
	{ timeout: 15000 },
	async () => {
		const entered = deferred(),
			release = deferred();
		const f = await fixture(gatedOptions(entered, release), (_p, n) =>
			n === 1 ? { tool: "gate" } : { text: "ANSWER" },
		);
		try {
			const host = await f.start(),
				a = host.connect("a", ["input.submit"]),
				b = host.connect("b", ["input.submit"]);
			await a.submit({ key: "start", text: "START" });
			await reachedGate(host, entered);
			const qa = await a.submit({ key: "q", text: "SAME", mode: "steer" }),
				qb = await b.submit({ key: "q", text: "SAME", mode: "steer" });
			assert.deepEqual(
				a.cancelQueued().map((r) => r.id),
				[qa.id],
			);
			assert.equal(b.receipt(qb.id)?.state, "queued");
			assert.equal(a.receipt(qb.id), undefined);
			const retry = await a.submit({ key: "q", text: "SAME", mode: "steer" });
			assert.equal(retry.id, qa.id);
			assert.equal(retry.attempt, 2);
			release.resolve();
			await host.waitForIdle();
			assert.equal(a.receipt(qa.id)?.state, "committed");
			assert.equal(b.receipt(qb.id)?.state, "committed");
			assert.notEqual(a.receipt(qa.id)?.entryId, b.receipt(qb.id)?.entryId);
		} finally {
			release.resolve();
			await f.close();
		}
	},
);

for (const reload of [false, true])
	test(
		`cancel after drain before append preserves identities (reload=${reload})`,
		{ timeout: 15000 },
		async () => {
			const entered = deferred(),
				release = deferred();
			const f = await fixture({ ...gatedOptions(entered, release), steeringMode: "all" }, (_p, n) =>
				n === 1 ? { tool: "gate" } : { text: "ANSWER" },
			);
			try {
				const host = await f.start(),
					user = host.connect("user", ["input.submit"]);
				if (reload) await host.reload();
				await user.submit({ key: "start", text: "START" });
				await reachedGate(host, entered);
				const one = await user.submit({ key: "one", text: "IDENTICAL", mode: "steer" });
				const two = await user.submit({ key: "two", text: "IDENTICAL", mode: "steer" });
				const later = await user.submit({ key: "later", text: "IDENTICAL", mode: "followUp" });
				let removed: readonly string[] = [];
				host.subscribe((e) => {
					if (e.type === "receipt" && e.receipt.id === one.id && e.receipt.state === "consumed")
						removed = user.cancelQueued().map((r) => r.id);
				});
				release.resolve();
				await host.waitForIdle();
				assert.deepEqual(removed, [later.id]);
				assert.equal(user.receipt(one.id)?.state, "committed");
				assert.equal(user.receipt(two.id)?.state, "committed");
				assert.equal(user.receipt(later.id)?.state, "released");
				assert.notEqual(user.receipt(one.id)?.entryId, user.receipt(two.id)?.entryId);
				assert.equal(f.requests.length, 2);
			} finally {
				release.resolve();
				await f.close();
			}
		},
	);

test(
	"reload revokes before waiting for active tool and rejects concurrent transition",
	{ timeout: 15000 },
	async () => {
		const entered = deferred(),
			release = deferred();
		const f = await fixture(gatedOptions(entered, release), (_p, n) =>
			n === 1 ? { tool: "gate" } : { text: "ANSWER" },
		);
		try {
			const host = await f.start(),
				user = host.connect("user", ["input.submit"]),
				owner = host.connect("owner", ["real_context.write"]);
			owner.activateStrategy({ id: "real", hooks: ["real_context.write"] });
			await user.submit({ key: "start", text: "START" });
			await reachedGate(host, entered);
			const old = owner.capture(),
				before = await raw(host);
			const reload = host.reload();
			assert.equal(host.view().phase, "transitioning");
			assert.equal((await owner.commit(old, cut)).status, "denied");
			assert.equal(await raw(host), before);
			await assert.rejects(host.newSession(), /transition/);
			release.resolve();
			await reload;
			assert.equal(host.view().phase, "ready");
			assert.equal(host.view().autoCompaction, false);
			assert.equal((await owner.commit(old, cut)).status, "denied");
			assert.equal((await owner.commit(owner.capture(), { ...cut, summary: "FRESH" })).status, "committed");
			await user.submit({ key: "fresh", text: "FRESH-PROMPT" });
			await host.waitForIdle();
			assert.match(text(f.requests.at(-1)!), /FRESH-PROMPT/);
		} finally {
			release.resolve();
			await f.close();
		}
	},
);

test(
	"session replacement releases pending queue and does not carry it into new session",
	{ timeout: 15000 },
	async () => {
		const entered = deferred(),
			release = deferred();
		const f = await fixture(gatedOptions(entered, release), (_p, n) =>
			n === 1 ? { tool: "gate" } : { text: "ANSWER" },
		);
		try {
			const host = await f.start(),
				user = host.connect("user", ["input.submit"]);
			await user.submit({ key: "start", text: "START" });
			await reachedGate(host, entered);
			const q = await user.submit({ key: "queued", text: "OLD-QUEUED", mode: "followUp" }),
				oldSession = host.view().sessionId;
			const replacing = host.newSession();
			assert.equal(user.receipt(q.id)?.state, "released");
			release.resolve();
			await replacing;
			assert.notEqual(host.view().sessionId, oldSession);
			await user.submit({ key: "fresh", text: "NEW-SESSION" });
			await host.waitForIdle();
			assert.doesNotMatch(text(f.requests.at(-1)!), /OLD-QUEUED|START/);
			assert.match(text(f.requests.at(-1)!), /NEW-SESSION/);
		} finally {
			release.resolve();
			await f.close();
		}
	},
);

test(
	"host ABA invalidates capability even with original leaf and count restored",
	{ timeout: 15000 },
	async () => {
		const f = await fixture();
		try {
			const host = await f.start();
			const { receipt } = await seed(host);
			const owner = host.connect("owner", ["real_context.write", "branch.control"]);
			owner.activateStrategy({ id: "real", hooks: ["real_context.write"] });
			const old = owner.capture(),
				view = host.view(),
				disk = await raw(host);
			owner.branch(owner.capture(), receipt.entryId!);
			owner.branch(owner.capture(), view.leafId!);
			assert.equal(host.view().leafId, view.leafId);
			assert.equal(host.view().entries.length, view.entries.length);
			assert.equal((await owner.commit(old, cut)).status, "denied");
			assert.equal(await raw(host), disk);
			assert.equal(
				(await owner.commit(owner.capture(), { ...cut, summary: "FRESH-ABA" })).status,
				"committed",
			);
		} finally {
			await f.close();
		}
	},
);

test("preparation crossing replacement cannot transfer into new scope", { timeout: 15000 }, async () => {
	const entered = deferred(),
		release = deferred();
	const f = await fixture({
		prepareInput: async ({ text }) => {
			entered.resolve();
			await release.promise;
			return { action: "text", text };
		},
	});
	try {
		const host = await f.start(),
			user = host.connect("user", ["input.submit"]);
		const pending = user.submit({ key: "slow", text: "OLD" });
		await entered.promise;
		await host.newSession();
		release.resolve();
		assert.equal((await pending).state, "released");
		assert.equal(f.requests.length, 0);
		await user.submit({ key: "slow", text: "NEW" });
		await host.waitForIdle();
		assert.match(text(f.requests[0]), /NEW/);
		assert.doesNotMatch(text(f.requests[0]), /OLD/);
	} finally {
		release.resolve();
		await f.close();
	}
});

test(
	"tool side effect then disk failure fails closed and does not replay committed input",
	{ timeout: 15000 },
	async () => {
		const entered = deferred(),
			release = deferred();
		let effects = 0;
		const f = await fixture(
			gatedOptions(entered, release, () => effects++),
			(_p, n) => (n === 1 ? { tool: "gate" } : { text: "ANSWER" }),
		);
		let path: string | undefined;
		try {
			const host = await f.start(),
				user = host.connect("user", ["input.submit"]);
			const start = await user.submit({ key: "effect", text: "DO-ONCE" });
			await reachedGate(host, entered);
			assert.equal(effects, 1);
			assert.equal(user.receipt(start.id)?.state, "committed");
			path = host.view().sessionFile;
			await rename(path, path + ".saved");
			await mkdir(path);
			release.resolve();
			await host.waitForIdle();
			assert.equal(host.view().phase, "failed");
			assert.equal(host.view().effects, "unknown");
			const count = f.requests.length;
			assert.equal((await user.submit({ key: "effect", text: "DO-ONCE" })).state, "committed");
			assert.equal(f.requests.length, count);
			assert.equal(effects, 1);
			await assert.rejects(user.submit({ key: "other", text: "RETRY" }), /failed/);
		} finally {
			release.resolve();
			if (path) {
				await rm(path, { recursive: true });
				await rename(path + ".saved", path);
			}
			await f.close();
		}
	},
);
