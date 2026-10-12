import { test } from "node:test";
import { fork } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert";
import { createBroker } from "@pakka/mas";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { fixture, text } from "../../../packages/agent/test/fixture.ts";

const ids = { one: "91383703-b5ca-441c-81de-72b487a3e2b8", two: "7210362e-e8bb-40f5-9841-cf495fc07d83" };
async function workerFixture() {
	const one = await fixture(),
		two = await fixture();
	const options = {
		maxWorkers: 2,
		startupTimeoutMs: 15000,
		requestTimeoutMs: 15000,
		placements: Object.fromEntries(
			(["one", "two"] as const).map((key) => {
				const f = key === "one" ? one : two;
				return [
					key,
					{
						runtime: {
							cwd: f.cwd,
							dataDir: f.dataDir,
							endpoint: f.endpoint,
							model: "local-model",
							apiKey: "local-only",
							systemPrompt: "WORKER-" + key,
							reservedSessionId: ids[key],
							limits: { maxConversations: 4, maxPrimaryAttempts: 8, maxAuxiliaryAttempts: 2 },
						},
						catalog: { namespace: "members", maxDeliveries: 8, maxPending: 2 },
					},
				];
			}),
		),
	};
	return {
		one,
		two,
		options,
		close: async () => {
			await one.close();
			await two.close();
		},
	};
}

// An in-process fake endpoint would fail PID checks; changing request identity on restart would send an extra real HTTP.
test(
	"M3 workers: two real isolated processes admit A2A and graceful reopen preserves identity/dedup",
	{ timeout: 45000 },
	async () => {
		const f = await workerFixture(),
			c = await runtimeFixture();
		let manager:
			| Awaited<ReturnType<typeof import("../src/worker-manager.ts").createWorkerManager>>
			| undefined;
		try {
			const { createWorkerManager } = await import("../src/worker-manager.ts");
			manager = createWorkerManager(f.options);
			const broker = await createBroker({
				namespace: "worker-crew",
				store: c.runtime.store({ namespace: "worker-crew", maxBytes: 65536 }),
				maxMembers: 4,
				maxMessages: 8,
				placements: { one: manager.placement("one"), two: manager.placement("two") },
			});
			await broker.bootstrap([
				{ key: "a", placement: "one", owner: "operator" },
				{ key: "b", placement: "two", owner: "operator" },
			]);
			assert.equal((await broker.activate()).phase, "active");
			const workers = manager.view();
			assert.equal(workers.length, 2);
			assert.notEqual(workers[0]!.pid, process.pid);
			assert.notEqual(workers[1]!.pid, process.pid);
			assert.notEqual(workers[0]!.pid, workers[1]!.pid);
			const [a, b] = (await broker.view()).members.map((member) => member.ref!);
			const client = broker.connect({ principal: "a", source: a!, grants: ["send"] });
			const input = { requestId: "real", text: "WORKER-A-TO-B" };
			const admitted = await client.send(b!, input);
			assert.equal((await client.wait(admitted.id)).status, "done");
			assert.equal(f.two.requests.length, 1);
			assert.match(text(f.two.requests[0]!), /WORKER-A-TO-B/);
			const oldEndpoint = await manager.placement("two").open(ids.two);
			const oldPid = manager.view().find((worker) => worker.key === "two")!.pid;
			await manager.stop("two");
			await assert.rejects(oldEndpoint.view(), /closed|unavailable|exit/);
			const restored = await manager.placement("two").open(ids.two);
			assert.equal((await restored.view()).sessionId, ids.two);
			assert.notEqual(manager.view().find((worker) => worker.key === "two")!.pid, oldPid);
			assert.equal((await client.send(b!, input)).id, admitted.id);
			await manager.stop("two", { force: true });
			assert.equal((await client.wait(admitted.id)).status, "done");
			assert.equal((await client.receipt(admitted.id)).status, "done");
			assert.equal(f.two.requests.length, 1);
			assert.equal(f.one.requests.length, 0);
		} finally {
			await manager?.close();
			await c.close();
			await f.close();
		}
	},
);

test(
	"M3 workers: controlled process exit and duplicate writer cannot affect a surviving peer",
	{ timeout: 45000 },
	async () => {
		const f = await workerFixture(),
			c = await runtimeFixture();
		let manager:
				| Awaited<ReturnType<typeof import("../src/worker-manager.ts").createWorkerManager>>
				| undefined,
			competing: typeof manager;
		try {
			const { createWorkerManager } = await import("../src/worker-manager.ts");
			manager = createWorkerManager(f.options);
			const broker = await createBroker({
				namespace: "worker-crew",
				store: c.runtime.store({ namespace: "worker-crew", maxBytes: 65536 }),
				maxMembers: 4,
				maxMessages: 8,
				placements: { one: manager.placement("one"), two: manager.placement("two") },
			});
			await broker.bootstrap([
				{ key: "a", placement: "one", owner: "operator" },
				{ key: "b", placement: "two", owner: "operator" },
			]);
			await broker.activate();
			competing = createWorkerManager(f.options);
			await assert.rejects(competing.placement("two").open(ids.two), /locked|unknown|unavailable/);
			const old = await manager.placement("one").open(ids.one);
			await manager.stop("one", { force: true });
			await assert.rejects(old.view(), /exit|unknown|unavailable/);
			await assert.rejects(manager.placement("one").open(ids.one), /unknown|claim|locked/);
			const b = (await broker.view()).members[1]!.ref!;
			const operator = broker.connect({ principal: "operator", source: null, grants: ["send"] });
			assert.equal(
				(await operator.wait((await operator.send(b, { requestId: "survivor", text: "PEER-SURVIVES" })).id))
					.status,
				"done",
			);
			assert.equal(f.two.requests.length, 1);
			assert.equal(f.one.requests.length, 0);
		} finally {
			await competing?.close();
			await manager?.close();
			await c.close();
			await f.close();
		}
	},
);

test(
	"M3 workers: capacity rejects allocation before starting an extra process",
	{ timeout: 30000 },
	async () => {
		const f = await workerFixture();
		const { createWorkerManager } = await import("../src/worker-manager.ts");
		const manager = createWorkerManager({ ...f.options, maxWorkers: 1 });
		try {
			await manager.placement("one").open();
			await assert.rejects(manager.placement("two").open(), /capacity/);
			assert.equal(manager.view().length, 1);
			assert.equal(existsSync(join(f.two.dataDir, "sessions", ids.two)), false);
			assert.equal(f.one.requests.length + f.two.requests.length, 0);
		} finally {
			await manager.close();
			await f.close();
		}
	},
);

test(
	"M3 workers: private IPC rejects unsupported protocol, copied generation and unapproved lifetime",
	{ timeout: 30000 },
	async () => {
		const f = await workerFixture();
		const env: NodeJS.ProcessEnv = {};
		for (const key of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"])
			if (process.env[key]) env[key] = process.env[key];
		Object.assign(env, {
			HOME: f.one.dataDir,
			USERPROFILE: f.one.dataDir,
			PI_CODING_AGENT_DIR: join(f.one.dataDir, "isolated-profile"),
			PI_OFFLINE: "1",
			DO_NOT_TRACK: "1",
		});
		const child = fork(fileURLToPath(new URL("../src/worker.ts", import.meta.url)), [], {
			cwd: f.one.cwd,
			env,
			execArgv: [],
			stdio: ["ignore", "ignore", "ignore", "ipc"],
		});
		const generation = randomUUID(),
			exited = new Promise<void>((resolve) => {
				child.once("exit", () => resolve());
			});
		function exchange(
			command: string,
			payload: Record<string, unknown>,
			version = 1,
			gen = generation,
		): Promise<{ ok: boolean; error?: string; value?: unknown }> {
			const id = randomUUID();
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					child.removeListener("message", listener);
					reject(new Error("Private IPC test timeout"));
				}, 5000);
				const listener = (message: unknown) => {
					if (!message || typeof message !== "object" || !("id" in message) || message.id !== id) return;
					clearTimeout(timer);
					child.removeListener("message", listener);
					// SAFETY: correlation ensures this is the actual child response; assertions check response fields.
					resolve(message as unknown as { ok: boolean; error?: string; value?: unknown });
				};
				child.on("message", listener);
				child.send({ version, generation: gen, id, command, payload });
			});
		}
		try {
			assert.equal((await exchange("init", f.options.placements.one!, 999)).ok, false);
			assert.equal(existsSync(join(f.one.dataDir, "sessions", ids.one)), false);
			assert.equal((await exchange("init", f.options.placements.one!)).ok, true);
			assert.equal((await exchange("init", f.options.placements.one!)).ok, false);
			assert.equal((await exchange("view", {}, 1, randomUUID())).ok, false);
			assert.equal(
				(await exchange("prepare", { members: [{ key: "bad", owner: "operator", lifetime: "task-bound" }] }))
					.ok,
				false,
			);
			const view = await exchange("view", {});
			assert.equal(view.ok, true);
			assert.equal(JSON.stringify(view.value).includes('"members":[]'), true);
			assert.equal(f.one.requests.length + f.two.requests.length, 0);
			assert.equal((await exchange("close", {})).ok, true);
			await exited;
		} finally {
			child.kill();
			await exited;
			await f.close();
		}
	},
);
