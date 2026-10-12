import { test } from "node:test";
import { strict as assert } from "node:assert";
import { runtimeFixture } from "../../agent/test/runtime-fixture.ts";
import { createRuntime } from "../../agent/src/index.ts";
import { createMas } from "../src/index.ts";
import type { Mas } from "../src/types.ts";
import { readFile } from "node:fs/promises";
import { text, deferred } from "../../agent/test/fixture.ts";

async function boot(runtime: Awaited<ReturnType<typeof runtimeFixture>>["runtime"]) {
	return createMas({ runtime, namespace: "crew", maxDeliveries: 16, maxPending: 3 });
}

test("M2 MAS: readiness barrier activates the entire roster on one durable commit", async () => {
	const m = await runtimeFixture();
	try {
		const mas = await boot(m.runtime);
		await mas.bootstrap([
			{ key: "a", owner: "operator" },
			{ key: "b", owner: "operator" },
		]);
		const before = await mas.view();
		assert.equal(before.phase, "ready");
		const offset = (await readFile(m.runtime.view().sessionFile, "utf8")).length;
		const activated = await mas.activate();
		assert.equal(
			activated.version,
			before.version + 1,
			"activation must not expose a partially active roster",
		);
		assert.deepEqual(
			activated.members.map((entry) => entry.phase),
			["active", "active"],
		);
		const commits = (await readFile(m.runtime.view().sessionFile, "utf8"))
			.slice(offset)
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		assert.equal(commits.length, 1);
		assert.equal(
			commits[0].writes.filter((write: { type: string }) => write.type === "document.change").length,
			1,
		);
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("M2 MAS: readiness, source binding, broad send and narrow owner administration", async () => {
	const m = await runtimeFixture();
	try {
		const mas = await boot(m.runtime);
		await mas.bootstrap([
			{ key: "a", owner: "operator" },
			{ key: "b", owner: "operator" },
		]);
		assert.equal((await mas.view()).phase, "ready");
		const refs = (await mas.view()).members;
		const a = refs.find((r) => r.key === "a")!,
			b = refs.find((r) => r.key === "b")!;
		const sender = mas.connect({
			principal: "agent-a",
			source: a.ref,
			grants: ["discover", "send", "observe"],
		});
		await assert.rejects(
			sender.send(b.ref, { requestId: "first", text: "BLOCKED-BEFORE-ACTIVE" }),
			/active|readiness/,
		);
		assert.equal(m.f.requests.length, 0);
		await mas.activate();
		assert.equal(sender.discover().length, 2);
		assert.equal("transcript" in (await sender.inspect(b.ref)), false);
		assert.equal("conversation" in sender, false);
		const first = await sender.send(b.ref, { requestId: "first", text: "A2A-FROM-A" });
		const duplicate = await sender.send(b.ref, { requestId: "first", text: "A2A-FROM-A" });
		assert.equal(first.id, duplicate.id);
		await assert.rejects(sender.send(b.ref, { requestId: "first", text: "CHANGED" }), /conflict/);
		await assert.rejects(sender.retire(b.ref), /grant|owner/);
		await assert.rejects(
			sender.send({ ...b.ref, incarnation: "fake" }, { requestId: "fake", text: "FAKE" }),
			/reference/,
		);
		await sender.wait(first.id);
		assert.equal(m.f.requests.length, 1);
		assert.match(text(m.f.requests[0]!), /A2A-FROM-A/);
		assert.doesNotMatch(text(m.f.requests[0]!), /BLOCKED-BEFORE-ACTIVE|CHANGED|FAKE/);
		mas.revoke("agent-a");
		await assert.rejects(sender.send(b.ref, { requestId: "revoked", text: "REVOKED" }), /revoked/);
		assert.equal(m.f.requests.length, 1);
		const admin = mas.connect({ principal: "operator", source: null, grants: ["retire", "send", "observe"] });
		await admin.retire(b.ref);
		assert.equal((await mas.view()).members.find((r) => r.key === "b")!.phase, "retired");
		await assert.rejects(admin.send(b.ref, { requestId: "retired", text: "RETIRED" }), /retired|admission/);
		assert.equal(m.f.requests.length, 1);
	} finally {
		await m.close();
	}
});

test("M2 MAS: delayed admission approval rechecks revocation before native target effects", async () => {
	const m = await runtimeFixture(),
		entered = deferred(),
		release = deferred();
	try {
		const mas = await boot(m.runtime);
		await mas.bootstrap([
			{ key: "a", owner: "operator" },
			{ key: "b", owner: "operator" },
		]);
		await mas.activate();
		const [a, b] = (await mas.view()).members;
		const sender = mas.connect({ principal: "a", source: a!.ref, grants: ["send"] });
		mas.setAdmission(async () => {
			entered.resolve();
			await release.promise;
			return true;
		});
		const pending = sender.send(b!.ref, { requestId: "delayed", text: "SHOULD-NEVER-DISPATCH" });
		await entered.promise;
		mas.revoke("a");
		release.resolve();
		await assert.rejects(pending, /revoked/);
		assert.equal(m.f.requests.length, 0);
		assert.equal(
			(await m.runtime.catalog({ namespace: "crew", maxDeliveries: 16, maxPending: 3 }).snapshot()).members
				.length,
			2,
		);
	} finally {
		release.resolve();
		await m.close();
	}
});

test(
	"M2 MAS: busy peer uses native steer post-tools and followUp final placement",
	{ timeout: 15000 },
	async () => {
		const held = deferred(),
			release = deferred();
		const m = await runtimeFixture(
			{
				tools: [
					{
						name: "held_tool",
						description: "local held tool",
						parameters: { type: "object", properties: {} },
						execute: async () => {
							held.resolve();
							await release.promise;
							return "LOCAL-TOOL-RESULT";
						},
					},
				],
			},
			undefined,
			(payload) => {
				if (payload.messages.some((m) => m.role === "tool")) return { text: "BOUNDARY-ANSWER" };
				return { tool: "held_tool" };
			},
		);
		try {
			const mas = await boot(m.runtime);
			await mas.bootstrap([
				{ key: "a", owner: "operator" },
				{ key: "b", owner: "operator" },
			]);
			await mas.activate();
			const [a, b] = (await mas.view()).members;
			const sender = mas.connect({ principal: "a", source: a!.ref, grants: ["send", "steer"] });
			const initial = await sender.send(b!.ref, { requestId: "busy", text: "START-BUSY" });
			await held.promise;
			const steer = await sender.send(b!.ref, {
				requestId: "steer",
				text: "STEER-POST-TOOLS",
				mode: "steer",
			});
			const follow = await sender.send(b!.ref, {
				requestId: "follow",
				text: "FOLLOW-UP-FINAL",
				mode: "followUp",
			});
			assert.equal(steer.status, "queued");
			assert.equal(follow.status, "queued");
			await assert.rejects(
				sender.send(b!.ref, { requestId: "too-many", text: "LIMITED", mode: "followUp" }),
				/pending.*limit/,
			);
			const withdrawn = await sender.withdraw(initial.id);
			assert.ok(withdrawn.entryId);
			assert.equal(withdrawn.status, "placed");
			release.resolve();
			await sender.wait(follow.id);
			assert.equal((await sender.receipt(steer.id)).status, "done");
			assert.equal(m.f.requests.length, 3);
			assert.match(text(m.f.requests[1]!), /STEER-POST-TOOLS/);
			assert.doesNotMatch(text(m.f.requests[1]!), /FOLLOW-UP-FINAL/);
			assert.match(text(m.f.requests[2]!), /FOLLOW-UP-FINAL/);
			assert.doesNotMatch(text(m.f.requests[2]!), /LIMITED/);
		} finally {
			release.resolve();
			await m.close();
		}
	},
);

test("M2 MAS: stopped source is rejected on the commit line despite a stale peer service cache", async () => {
	const m = await runtimeFixture();
	try {
		const mas = await boot(m.runtime);
		await mas.bootstrap([
			{ key: "a", owner: "operator" },
			{ key: "b", owner: "operator" },
		]);
		await mas.activate();
		const peer = await boot(m.runtime),
			[a, b] = (await mas.view()).members;
		const sender = mas.connect({ principal: "a", source: a!.ref, grants: ["send"] });
		const c = m.runtime.catalog({ namespace: "crew", maxDeliveries: 16, maxPending: 3 });
		mas.setAdmission(async () => {
			await c.update("a", { owner: "operator", phase: "retired" }, (await c.snapshot()).version, () => {});
			return true;
		});
		await assert.rejects(
			sender.send(b!.ref, { requestId: "stale-source", text: "MUST-NOT-SEND" }),
			/Source|source/,
		);
		assert.equal((await peer.view()).members.find((m) => m.key === "a")!.phase, "retired");
		assert.equal(m.f.requests.length, 0);
	} finally {
		await m.close();
	}
});

test("M2 MAS: reopen preserves duplicate admission without reviving old authority", async () => {
	const m = await runtimeFixture();
	let reopened: Awaited<ReturnType<typeof createRuntime>> | undefined;
	try {
		let mas: Mas = await boot(m.runtime);
		await mas.bootstrap([
			{ key: "a", owner: "operator" },
			{ key: "b", owner: "operator" },
		]);
		await mas.activate();
		const [a, b] = (await mas.view()).members,
			old = mas.connect({ principal: "a", source: a!.ref, grants: ["send"] });
		const spec = { requestId: "durable", text: "ONCE-ONLY" };
		const first = await old.send(b!.ref, spec);
		await old.wait(first.id);
		const path = m.runtime.view().sessionFile;
		await m.runtime.close();
		reopened = await createRuntime({ ...m.config, reopenSessionFile: path });
		mas = await boot(reopened);
		await assert.rejects(
			old.send(b!.ref, { requestId: "late", text: "OLD-CLOSURE" }),
			/Runtime.*(ready|closed)/,
		);
		const fresh = mas.connect({ principal: "a", source: a!.ref, grants: ["send"] });
		assert.equal((await fresh.send(b!.ref, spec)).id, first.id);
		assert.equal(m.f.requests.length, 1);
	} finally {
		await reopened?.close();
		await m.close();
	}
});
