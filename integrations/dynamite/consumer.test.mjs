import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createDynamite } from "@pakka/dynamite";
import { fixture, install, next, seed, wireText } from "./fixture.mjs";

// A missing raw-entry mapping must fail on the real next provider request,
// not pass merely because both tarballs compile against the same version.
test("installed Dynamite numbers Durable messages without changing raw history", async () => {
	const f = await fixture("numbering");
	try {
		const host = await f.start();
		const user = await seed(host);
		const { binding } = install(f);
		const before = await readFile(host.view().sessionFile, "utf8");
		const frame = binding.readFrame();
		assert.ok(frame.entries.some((entry) => entry.type === "pi.user"));
		assert.ok(frame.projection.some((entry) => wireText({ messages: entry.messages }).includes("SOURCE-1")));
		await next(host, user, "NUMBERED-NEXT");
		assert.match(wireText(f.requests.at(-1)), /\[#1\] SOURCE-1/);
		assert.match(wireText(f.requests.at(-1)), /LEADING-SYSTEM/);
		assert.ok((await readFile(host.view().sessionFile, "utf8")).startsWith(before));
		assert.doesNotMatch(await readFile(host.view().sessionFile, "utf8"), /\[#1\]/);
	} finally {
		await f.close();
	}
});

test("installed Dynamite reduce and flush omit the checked source only on wire", async () => {
	const f = await fixture("reduce");
	try {
		const host = await f.start();
		const user = await seed(host);
		const { service } = install(f);
		const before = await readFile(host.view().sessionFile, "utf8");
		const result = await service.reduce("#1");
		assert.deepEqual(
			result.accepted.map((item) => item.label),
			["#1"],
		);
		assert.equal((await service.flush()).ok, true);
		assert.equal(await readFile(host.view().sessionFile, "utf8"), before);
		await next(host, user, "REDUCED-NEXT");
		assert.match(wireText(f.requests.at(-1)), /\[#1 omitted\]/);
		assert.doesNotMatch(wireText(f.requests.at(-1)), /SOURCE-1/);
		assert.match(wireText(f.requests.at(-1)), /SOURCE-2|LEADING-SYSTEM/);
		assert.match(await readFile(host.view().sessionFile, "utf8"), /SOURCE-1/);
	} finally {
		await f.close();
	}
});

for (const cap of [64, 128]) {
	test(`installed Dynamite compression dispatches cap ${cap} and adopts a source-bound summary`, async () => {
		const f = await fixture("compression-" + cap);
		try {
			const host = await f.start();
			const user = await seed(host);
			const { binding, service } = install(f, { autoCompress: true, compressionMaxOutputTokens: cap });
			const before = await readFile(host.view().sessionFile, "utf8");
			await service.compress();
			assert.deepEqual(
				f.requests
					.filter((request) => request.model === "summary-local")
					.map((request) => request.max_tokens),
				[cap],
			);
			assert.equal(await readFile(host.view().sessionFile, "utf8"), before);
			assert.equal(binding.audit().length, 1);
			assert.equal((await service.flush()).ok, true);
			service.configure({ autoCompress: false });
			await next(host, user, "SUMMARY-NEXT");
			assert.match(wireText(f.requests.at(-1)), /Compaction:1/);
			assert.match(wireText(f.requests.at(-1)), /Preserve source decisions/);
			assert.doesNotMatch(wireText(f.requests.at(-1)), /SOURCE-1/);
			assert.match(await readFile(host.view().sessionFile, "utf8"), /SOURCE-1/);
		} finally {
			await f.close();
		}
	});
}

test("installed Dynamite reload and reopen rebuild reduction from records, not old scopes", async () => {
	const f = await fixture("reopen");
	try {
		let host = await f.start();
		let user = await seed(host);
		let { binding, service } = install(f);
		assert.deepEqual(
			(await service.reduce("#1")).accepted.map((item) => item.label),
			["#1"],
		);
		assert.equal((await service.flush()).ok, true);
		const old = binding.readFrame();
		const file = host.view().sessionFile;
		await host.reload();
		await next(host, user, "RELOADED");
		assert.doesNotMatch(wireText(f.requests.at(-1)), /SOURCE-1/);
		service.dispose();
		await host.dispose();
		host = await f.start({ reopenSessionFile: file });
		({ binding, service } = install(f));
		assert.equal(binding.readFrame().sessionId, old.sessionId);
		assert.notEqual(binding.readFrame().leaseId, old.leaseId);
		assert.deepEqual(binding.readFrame().entries.slice(0, old.entries.length), old.entries);
		user = host.connect("reopened-user", ["input.submit"]);
		await next(host, user, "REOPENED");
		assert.doesNotMatch(wireText(f.requests.at(-1)), /SOURCE-1/);
		assert.match(wireText(f.requests.at(-1)), /\[#1 omitted\]/);
		assert.equal(f.requests.filter((request) => request.model === "summary-local").length, 0);
	} finally {
		await f.close();
	}
});

test("installed Dynamite cannot acquire projection from artifact-only grants", async () => {
	const f = await fixture("permissions");
	try {
		const host = await f.start();
		const owner = host.connect("artifact-only", ["context_artifacts.write"]);
		owner.activateStrategy({ id: "default-context-strategy", hooks: ["context_artifacts.write"] });
		assert.throws(() => createDynamite(owner.bindStrategy("default-context-strategy")), /real_context/);
		assert.equal(f.requests.length, 0);
		assert.throws(() => host.connect("outsider", []).bindStrategy("default-context-strategy"), /owner/);
	} finally {
		await f.close();
	}
});
