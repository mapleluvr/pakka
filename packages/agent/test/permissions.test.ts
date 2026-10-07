import { test } from "node:test";
import assert from "node:assert/strict";
import { deferred, fixture, raw, seed, text } from "./fixture.ts";

const cut = { type: "cut" as const, summary: "AUTHORIZED-SUMMARY", firstKeptEntryId: null, tokensBefore: 12 };

test(
	"exact hook ownership denies artifact-only writes and owner cut reaches HTTP",
	{ timeout: 15000 },
	async () => {
		const f = await fixture();
		try {
			const host = await f.start();
			const { client: user } = await seed(host);
			const owner = host.connect("owner", ["real_context.write"]),
				other = host.connect("artifacts", ["context_artifacts.write"]);
			assert.doesNotThrow(() => owner.activateStrategy({ id: "real", hooks: ["real_context.write"] }));
			other.activateStrategy({ id: "art", hooks: ["context_artifacts.write"] });
			const before = await raw(host);
			assert.equal((await other.commit(other.capture(), cut)).status, "denied");
			assert.equal(await raw(host), before);
			const at = owner.capture();
			assert.equal((await owner.commit(at, cut)).status, "committed");
			assert.equal((await owner.commit(at, cut)).status, "denied");
			await user.submit({ key: "after", text: "AFTER-CUT" });
			await host.waitForIdle();
			assert.match(text(f.requests[1]), /AUTHORIZED-SUMMARY/);
			assert.doesNotMatch(text(f.requests[1]), /ORIGINAL/);
			assert.match(text(f.requests[1]), /PAKKA-SYSTEM/);
			assert.match(await raw(host), /ORIGINAL/);
			assert.match(await raw(host), /"strategyId":"real"/);
		} finally {
			await f.close();
		}
	},
);

test(
	"edit validates target before intent append and changes only provider projection",
	{ timeout: 15000 },
	async () => {
		const f = await fixture();
		try {
			const host = await f.start();
			const { client: user, receipt } = await seed(host);
			const owner = host.connect("owner", ["real_context.write"]);
			owner.activateStrategy({ id: "real", hooks: ["real_context.write"] });
			const before = await raw(host);
			assert.equal(
				(await owner.commit(owner.capture(), { type: "edit", targetId: "missing", text: "BAD" })).status,
				"denied",
			);
			assert.equal(await raw(host), before);
			assert.equal(
				(await owner.commit(owner.capture(), { type: "edit", targetId: receipt.entryId!, text: "EDITED" }))
					.status,
				"committed",
			);
			await user.submit({ key: "next", text: "NEXT" });
			await host.waitForIdle();
			assert.match(text(f.requests[1]), /EDITED/);
			assert.doesNotMatch(text(f.requests[1]), /ORIGINAL/);
			assert.match(await raw(host), /ORIGINAL/);
		} finally {
			await f.close();
		}
	},
);

test(
	"async policy approval is invalidated by owner revocation before commit",
	{ timeout: 15000 },
	async () => {
		const f = await fixture();
		const entered = deferred(),
			release = deferred();
		try {
			const host = await f.start();
			await seed(host);
			const owner = host.connect("owner", ["real_context.write"]),
				guest = host.connect("guest", []);
			owner.activateStrategy({ id: "real", hooks: ["real_context.write"] });
			owner.setPolicy(async () => {
				entered.resolve();
				await release.promise;
				return true;
			});
			const before = await raw(host);
			const pending = guest.commit(guest.capture(), cut);
			await entered.promise;
			owner.deactivateStrategy("real");
			release.resolve();
			assert.equal((await pending).status, "denied");
			assert.equal(await raw(host), before);
		} finally {
			release.resolve();
			await f.close();
		}
	},
);

test("async policy cannot authorize a snapshot invalidated by new input", { timeout: 15000 }, async () => {
	const f = await fixture();
	const entered = deferred(),
		release = deferred();
	try {
		const host = await f.start();
		const { client: user } = await seed(host);
		const owner = host.connect("owner", ["real_context.write"]),
			guest = host.connect("guest", []);
		owner.activateStrategy({ id: "real", hooks: ["real_context.write"] });
		owner.setPolicy(async () => {
			entered.resolve();
			await release.promise;
			return true;
		});
		const pending = guest.commit(guest.capture(), cut);
		await entered.promise;
		await user.submit({ key: "racing-input", text: "RACING-INPUT" });
		await host.waitForIdle();
		release.resolve();
		assert.equal((await pending).status, "denied");
		assert.doesNotMatch(await raw(host), /AUTHORIZED-SUMMARY/);
	} finally {
		release.resolve();
		await f.close();
	}
});

test(
	"delegated policy sees immutable proposal and records actual owning strategy",
	{ timeout: 15000 },
	async () => {
		const f = await fixture();
		const entered = deferred(),
			release = deferred();
		try {
			const host = await f.start();
			await seed(host);
			const owner = host.connect("owner", ["real_context.write", "context_artifacts.write"]),
				guest = host.connect("guest", []);
			owner.activateStrategy({ id: "real", hooks: ["real_context.write"] });
			owner.activateStrategy({ id: "art", hooks: ["context_artifacts.write"] });
			owner.setPolicy(async (r) => {
				assert.equal(Object.isFrozen(r.proposal), true);
				entered.resolve();
				await release.promise;
				return true;
			});
			const proposal = { ...cut };
			const pending = guest.commit(guest.capture(), proposal);
			await entered.promise;
			proposal.summary = "CHANGED-AFTER-APPROVAL";
			release.resolve();
			assert.equal((await pending).status, "committed");
			const disk = await raw(host);
			assert.match(disk, /AUTHORIZED-SUMMARY/);
			assert.doesNotMatch(disk, /CHANGED-AFTER-APPROVAL/);
			assert.match(disk, /"strategyId":"real"/);
			assert.match(disk, /"principal":"guest"/);
		} finally {
			release.resolve();
			await f.close();
		}
	},
);

test("capability forgery and invalid proposals are refused without appends", { timeout: 15000 }, async () => {
	const f = await fixture();
	try {
		const host = await f.start();
		await seed(host);
		const owner = host.connect("owner", ["real_context.write"]);
		owner.activateStrategy({ id: "real", hooks: ["real_context.write"] });
		const before = await raw(host);
		assert.equal((await owner.commit({ ...owner.capture() }, cut)).status, "denied");
		for (const p of [
			{ ...cut, tokensBefore: -1 },
			{ ...cut, firstKeptEntryId: "missing" },
			{ type: "other" },
			null,
		]) {
			assert.equal((await owner.commit(owner.capture(), p as never)).status, "denied");
		}
		assert.equal(await raw(host), before);
	} finally {
		await f.close();
	}
});

test(
	"multi-hook conflict does not claim the free hook or leak mutable claims",
	{ timeout: 15000 },
	async () => {
		const f = await fixture();
		try {
			const host = await f.start();
			const owner = host.connect("owner", ["real_context.write"]),
				challenger = host.connect("challenger", ["real_context.write", "context_artifacts.write"]);
			owner.activateStrategy({ id: "real", hooks: ["real_context.write"] });
			assert.throws(
				() =>
					challenger.activateStrategy({
						id: "both",
						hooks: ["context_artifacts.write", "real_context.write"],
					}),
				/owned/,
			);
			assert.doesNotThrow(() =>
				challenger.activateStrategy({ id: "art", hooks: ["context_artifacts.write"] }),
			);
			assert.throws(() => challenger.setPolicy(() => true), /owner/);
		} finally {
			await f.close();
		}
	},
);
