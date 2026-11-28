import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime } from "@pakka/agent";
import { createPocketSchedules } from "@pakka/server/pocket";
import { loginHttp, connectHttp } from "./consumer-webui-http.mjs";

// Real installed CLI + public extension SDK, never a repository source import.
const root = dirname(fileURLToPath(import.meta.url)),
	run = join(root, "schedules-run-" + crypto.randomUUID()),
	cwd = join(run, "cwd"),
	dataDir = join(run, "data"),
	moduleFile = join(run, "composition.mjs"),
	ownerFile = join(run, "owner.txt");
await mkdir(cwd, { recursive: true });
await mkdir(dataDir, { recursive: true });
const requests = [],
	errors = [];
const provider = createServer((req, res) => {
	void (async () => {
		const chunks = [];
		for await (const bytes of req) chunks.push(Buffer.from(bytes));
		const body = parse(Buffer.concat(chunks).toString());
		requests.push(body);
		res.writeHead(200, { "Content-Type": "text/event-stream" });
		for (const choice of [
			{ index: 0, delta: { role: "assistant", content: "INSTALLED-SCHEDULE-RESULT" }, finish_reason: null },
			{ index: 0, delta: {}, finish_reason: "stop" },
		])
			res.write(
				"data: " +
					JSON.stringify({
						id: "schedule-" + requests.length,
						object: "chat.completion.chunk",
						created: 1,
						model: "local",
						choices: [choice],
						usage: { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 },
					}) +
					"\n\n",
			);
		res.end("data: [DONE]\n\n");
	})().catch((error) => {
		errors.push(String(error));
		res.destroy();
	});
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const address = provider.address();
assert.ok(address && typeof address !== "string");
let options = {
	cwd,
	dataDir,
	endpoint: "http://127.0.0.1:" + address.port + "/v1",
	model: "local",
	apiKey: "SYNTHETIC-INSTALLED-SCHEDULE-KEY",
	limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 2 },
};
const until = async (predicate) => {
	const end = Date.now() + 12000;
	while (!(await predicate())) {
		assert.ok(Date.now() < end, "Installed schedule deadline");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
};
function parse(text) {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw Error("Invalid owned schedule JSON", { cause: error });
	}
}
let child,
	origin,
	webui = true,
	port;
async function start() {
	await writeFile(
		moduleFile,
		`import{createPocketSchedules}from'@pakka/server/pocket';import{workspaceSchedulesExtensionRoot,workspaceSchedulesService}from'@pakka/webui/workflows';const prepared=createPocketSchedules({namespace:'installed.schedules',maxSchedules:16});export default{runtime:{...${JSON.stringify(options)},jobs:[prepared.definition]},owner:'Owner',initial:[{name:'Scheduled project',profile:'default'}],${port ? `transport:{port:${port}},` : ""}extensions:[{root:workspaceSchedulesExtensionRoot,facets:${JSON.stringify(webui ? ["backend", "client", "webui"] : ["backend", "client"])}}],extensionServices:async context=>({schedules:await workspaceSchedulesService(context,prepared)})};`,
	);
	child = spawn(
		process.execPath,
		[
			join(root, "node_modules/@pakka/webui/dist/main.js"),
			"--config-module",
			moduleFile,
			"--owner-file",
			ownerFile,
			"--control-stdin",
		],
		{ stdio: ["pipe", "pipe", "pipe"] },
	);
	let out = "",
		err = "";
	child.stdout.on("data", (bytes) => (out += String(bytes)));
	child.stderr.on("data", (bytes) => (err += String(bytes)));
	child.finished = new Promise((resolve, reject) => {
		child.once("exit", resolve);
		child.once("error", reject);
	});
	child.output = () => out + err;
	await until(() => out.includes("\n") || child.exitCode !== null);
	assert.ok(out.includes("\n"), "Installed schedule startup: " + err);
	const info = parse(out.split("\n")[0]);
	let url;
	try {
		url = new URL(info.origin);
	} catch (error) {
		throw Error("Invalid owned schedule listener", { cause: error });
	}
	assert.equal(url.protocol, "http:");
	assert.equal(url.hostname, "127.0.0.1");
	assert.ok(url.port);
	assert.equal(url.pathname, "/");
	assert.equal(url.username + url.password + url.search + url.hash, "");
	assert.equal(url.origin, info.origin);
	origin = url.origin;
	assert.equal(child.output().includes(options.apiKey), false);
	return info;
}
async function stop() {
	if (!child) return;
	child.stdin.end("stop\n");
	assert.equal(await child.finished, 0, child.output());
	assert.equal(child.output().includes(options.apiKey), false);
	child = undefined;
}
const listSchedules = async (client, target) =>
	(await client.call("workspace-schedules", "list", {}, target)).value.schedules;
try {
	let info = await start();
	port = Number(new URL(origin).port);
	const token = new URLSearchParams(new URL((await readFile(ownerFile, "utf8")).trim()).hash.slice(1)).get(
		"session",
	);
	assert.ok(token);
	let owner = await loginHttp(origin, token);
	const target = (await owner.rpc({ op: "list" })).conversations[0];
	const made = await owner.call(
		"workspace-schedules",
		"add",
		{ text: "ONCE-INSTALLED-SCHEDULE", dueAt: Date.now() + 1000 },
		target,
		"installed-first",
	);
	assert.equal(made.state, "done");
	await until(async () => (await listSchedules(owner, target))[0]?.state === "done");
	const before = await listSchedules(owner, target);
	assert.equal(before.length, 1);
	assert.equal((await owner.rpc({ op: "wait", id: before[0].deliveryId })).receipt.status, "done");
	assert.equal(requests.length, 1);
	const future = await owner.call(
		"workspace-schedules",
		"add",
		{ text: "AFTER-REOPEN-WITHOUT-WEBUI-FACET", dueAt: Date.now() + 8000 },
		target,
		"installed-future",
	);
	assert.equal(future.state, "done");
	const scheduled = await listSchedules(owner, target);
	assert.equal(scheduled.length, 2);
	await stop();
	const prepared = createPocketSchedules({ namespace: "installed.schedules", maxSchedules: 16 });
	let runtime = await createRuntime({
		...options,
		reopenSessionFile: info.sessionFile,
		jobs: [prepared.definition],
	});
	let saved;
	try {
		saved = await runtime.store({ namespace: "installed.schedules", maxBytes: 1048576 }).snapshot();
		assert.equal(saved.data.rows.length, 2);
		assert.equal(runtime.view().budget.primaryAttempts, 1);
		const row = saved.data.rows[1];
		assert.equal(
			(
				await runtime
					.jobs({ namespace: "installed.schedules.jobs", maxJobs: 16, maxBytes: 1048576 })
					.receipt(row.jobId, () => {})
			).checkpoint.nextDueAt,
			row.input.dueAt,
		);
	} finally {
		await runtime.close();
	}
	options = { ...options, reopenSessionFile: info.sessionFile };
	webui = false;
	const priorOrigin = origin;
	info = await start();
	assert.equal(origin, priorOrigin);
	owner = await connectHttp(origin, owner.cookies);
	assert.ok(
		!(await owner.extensions({ op: "list", target })).registrations.some(
			(row) => row.manifest.id === "workspace-schedules" && row.facet === "webui",
		),
	);
	await until(async () => (await listSchedules(owner, target)).every((row) => row.state === "done"));
	const after = await listSchedules(owner, target);
	assert.equal(after.length, 2);
	assert.deepEqual(
		after.map((row) => row.jobId),
		saved.data.rows.map((row) => row.jobId),
	);
	for (const row of after) {
		const receipt = (await owner.rpc({ op: "wait", id: row.deliveryId })).receipt;
		assert.equal(receipt.status, "done");
		assert.deepEqual(receipt.target, target);
	}
	const recovered = await owner.operationByRequest("workspace-schedules", "installed-first", target);
	assert.equal(recovered.id, made.id);
	assert.equal(requests.length, 2);
	await stop();
	runtime = await createRuntime({ ...options, jobs: [prepared.definition] });
	try {
		assert.equal(runtime.view().budget.primaryAttempts, 2);
		assert.equal(runtime.view().sessionId, target.sessionId);
	} finally {
		await runtime.close();
	}
	assert.ok(JSON.stringify(requests[0]).includes("ONCE-INSTALLED-SCHEDULE"));
	assert.ok(JSON.stringify(requests[1]).includes("AFTER-REOPEN-WITHOUT-WEBUI-FACET"));
	assert.deepEqual(errors, []);
	await writeFile(join(run, "provider-requests.json"), JSON.stringify(requests, null, 2) + "\n");
	console.log(
		"Installed schedules HTTP passed: original operation, native jobs/checkpoint/delivery IDs preserved across reopen, work continues without WebUI; 2 local model requests.",
	);
} finally {
	if (child) {
		child.kill();
		await child.finished;
	}
	provider.closeAllConnections();
	await new Promise((resolve) => provider.close(resolve));
}
