import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHost } from "@pakka/agent";
const consumer = dirname(fileURLToPath(import.meta.url));
await assert.rejects(createHost({ backend: "oracle" }), /Unsupported production backend/);
const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(import.meta.resolve("@pakka/agent"));
const versions = {};
const dependencyTree = JSON.parse(await readFile(join(consumer, "dependency-tree.json"), "utf8"));
function assertNoOracle(node) {
	assert.equal(Object.hasOwn(node.dependencies ?? {}, "@earendil-works/pi-coding-agent"), false);
	for (const child of Object.values(node.dependencies ?? {})) assertNoOracle(child);
}
assertNoOracle(dependencyTree);
assert.throws(() => runtimeRequire.resolve("@earendil-works/pi-coding-agent"), { code: "MODULE_NOT_FOUND" });
assert.throws(() => require.resolve("@earendil-works/pi-coding-agent"), { code: "MODULE_NOT_FOUND" });
for (const name of ["pi-ai", "chord", "pi-durable", "pi-telemetry"]) {
	for (const dir of runtimeRequire.resolve.paths("@earendil-works/" + name)) {
		let data;
		try {
			data = JSON.parse(await readFile(join(dir, "@earendil-works", name, "package.json"), "utf8"));
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		assert.equal(data.name, "@earendil-works/" + name);
		versions[name] = data.version;
		break;
	}
	assert.ok(versions[name], "Installed package metadata missing: " + name);
	assert.equal(versions[name], name === "pi-durable" ? "1.4.0-pakka.1" : "1.4.0");
}
await assert.rejects(import("@pakka/agent/dist/pi-adapter.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
await assert.rejects(import("@pakka/agent/dist/durable-adapter.js"), {
	code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
});
const requests = [];
const server = createServer((req, res) => {
	void (async () => {
		let body = "";
		for await (const part of req) body += part;
		let parsed;
		try {
			parsed = JSON.parse(body);
		} catch {
			res.destroy();
			return;
		}
		requests.push(parsed);
		res.writeHead(200, { "content-type": "text/event-stream" });
		const base = { id: "smoke", object: "chat.completion.chunk", created: 1, model: "local" };
		res.write(
			"data: " +
				JSON.stringify({
					...base,
					choices: [{ index: 0, delta: { role: "assistant", content: "ANSWER" }, finish_reason: null }],
				}) +
				"\n\n",
		);
		res.write(
			"data: " +
				JSON.stringify({
					...base,
					choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}) +
				"\n\n",
		);
		res.end("data: [DONE]\n\n");
	})().catch((e) => res.destroy(e));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const cwd = join(consumer, "workspace"),
	dataDir = join(consumer, "profile");
await mkdir(cwd);
await mkdir(dataDir);
let host;
try {
	host = await createHost({
		cwd,
		dataDir,
		endpoint: "http://127.0.0.1:" + server.address().port + "/v1",
		model: "local",
		apiKey: "local-only",
		systemPrompt: "PACKED-SYSTEM",
		inference: {
			models: [
				{
					key: "summary",
					model: "summary-local",
					endpoint: "http://127.0.0.1:" + server.address().port + "/v1",
					apiKey: "local-summary-only",
					contextWindow: 8192,
					maxTokens: 512,
				},
			],
			policies: [
				{
					strategyId: "strategy",
					modelKeys: ["summary"],
					maxCalls: 2,
					maxJobCalls: 2,
					maxOutputTokens: 256,
					timeoutMs: 5000,
				},
			],
		},
	});
	const user = host.connect("user", ["input.submit"]),
		owner = host.connect("owner", ["real_context.write", "context_artifacts.write", "model.infer"]);
	owner.activateStrategy({ id: "strategy", hooks: ["real_context.write", "context_artifacts.write"] });
	const input = await user.submit({ key: "first", text: "ORIGINAL-PACKED" });
	await host.waitForIdle();
	assert.equal(user.receipt(input.id).state, "committed");
	assert.equal(
		(
			await owner.commit(owner.capture(), {
				type: "cut",
				summary: "PACKED-SUMMARY",
				firstKeptEntryId: null,
				tokensBefore: 2,
			})
		).status,
		"committed",
	);
	await user.submit({ key: "second", text: "PACKED-NEXT" });
	await host.waitForIdle();
	assert.equal(requests.length, 2);
	assert.match(JSON.stringify(requests[1]), /PACKED-SUMMARY/);
	assert.doesNotMatch(JSON.stringify(requests[1]), /ORIGINAL-PACKED/);
	const binding = owner.bindStrategy("strategy"),
		frame = binding.readFrame();
	const entryId = frame.projection.find((e) =>
		JSON.stringify(e.messages).includes("PACKED-NEXT"),
	).sourceEntryId;
	const job = binding.createJob(frame.basis, {
		planId: "packed-job",
		targetEntryIds: [entryId],
		contextEntryIds: [],
		maxCalls: 2,
	});
	const before = await readFile(host.view().sessionFile, "utf8");
	for (const cap of [64, 128]) {
		assert.equal(
			(await job.infer({ modelKey: "summary", prompt: "PACKED-AUXILIARY", maxOutputTokens: cap })).status,
			"completed",
		);
		assert.equal(requests.at(-1).max_tokens, cap);
	}
	assert.equal(await readFile(host.view().sessionFile, "utf8"), before);
	const receipt = binding.artifacts.append(job.scope, {
		expectedVersion: 0,
		records: [{ kind: "packed-record" }],
	});
	assert.equal(receipt.status, "committed");
	const remove = binding.installProjector((frame) => ({
		status: "apply",
		basis: frame.basis,
		patches: [
			{ sourceEntryId: entryId, messageIndex: 0, content: [{ type: "text", text: "PACKED-PROJECTED" }] },
		],
	}));
	await host.reload();
	await user.submit({ key: "third", text: "PACKED-THIRD" });
	await host.waitForIdle();
	assert.equal(requests.length, 5);
	assert.match(JSON.stringify(requests[4]), /PACKED-PROJECTED/);
	assert.match(JSON.stringify(requests[4]), /PACKED-SYSTEM/);
	assert.doesNotMatch(JSON.stringify(requests[4]), /PACKED-AUXILIARY|PACKED-NEXT/);
	assert.equal(binding.audit().length, 2);
	remove();
	const removeOmission = binding.installProjector((frame) => ({
		status: "apply",
		basis: frame.basis,
		replacements: [{ sourceEntryIds: [entryId], summary: null }],
	}));
	await user.submit({ key: "fourth", text: "PACKED-FOURTH" });
	await host.waitForIdle();
	assert.equal(requests.length, 6);
	assert.equal(host.view().phase, "ready");
	assert.match(JSON.stringify(requests[5]), /PACKED-SYSTEM/);
	assert.match(JSON.stringify(requests[5]), /PACKED-FOURTH/);
	assert.doesNotMatch(JSON.stringify(requests[5]), /PACKED-NEXT|PACKED-PROJECTED|Host strategy summary/);
	assert.match(await readFile(host.view().sessionFile, "utf8"), /PACKED-NEXT/);
	removeOmission();
	const unblock = binding.installProjector((frame) => ({
		status: "blocked",
		basis: frame.basis,
		reason: "PACKED-BLOCK",
	}));
	const blocked = await user.submit({ key: "blocked", text: "PACKED-BLOCKED" });
	await host.waitForIdle();
	assert.equal(requests.length, 6);
	assert.equal(user.receipt(blocked.id).state, "committed");
	assert.deepEqual(user.receipt(blocked.id).generation, { status: "blocked", reason: "PACKED-BLOCK" });
	assert.equal(host.view().phase, "ready");
	unblock();
	await user.submit({ key: "after-block", text: "PACKED-AFTER-BLOCK" });
	await host.waitForIdle();
	assert.equal(requests.length, 7);
	console.log(
		JSON.stringify({
			status: "passed",
			consumer,
			entry: import.meta.resolve("@pakka/agent"),
			versions,
			httpRequests: requests.length,
			privateSubpath: "rejected",
			auxiliaryWireCaps: requests.filter((r) => r.model === "summary-local").map((r) => r.max_tokens),
			projectorAfterReload: "verified",
			rangeOmission: "verified",
			generationBlock: "verified",
			oracleDependency: "absent",
			artifactVersion: receipt.version,
		}),
	);
} finally {
	await host?.dispose();
	server.closeAllConnections();
	await new Promise((r) => server.close(r));
}
