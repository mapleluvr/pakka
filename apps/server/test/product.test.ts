import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createClient } from "@pakka/client";
import { bootstrapServer, decodeBootstrap } from "../src/bootstrap.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { text } from "../../../packages/agent/test/fixture.ts";

// Catches the gate's intentional default-tools inheritance leaking an optional product contribution.
test(
	"M6 product: an explicitly unselected profile advertises no inherited DevPack tools",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture({}, undefined, () => ({ text: "PLAIN-LOCAL-ANSWER" }));
		let app: Awaited<ReturnType<typeof bootstrapServer>> | undefined;
		try {
			await m.runtime.close();
			const token = "local-unselected-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
			app = await bootstrapServer(
				decodeBootstrap({
					schema: "pakka.server.v1",
					runtime: { ...m.config, profiles: [{ id: "plain", systemPrompt: "PLAIN-ONLY-INSTRUCTIONS" }] },
					mas: { namespace: "product", maxDeliveries: 8, maxPending: 2 },
					members: [
						{ key: "root", owner: "operator" },
						{ key: "plain", owner: "operator", profile: "plain" },
					],
					roles: [{ token, principal: "operator", sourceKey: null, grants: ["discover", "send", "observe"] }],
					devpack: { profiles: { default: ["discover"] } },
				}),
			);
			const client = createClient({ endpoint: app.server.endpoint, token }),
				plain = (await client.reconnect()).members.find((member) => member.key === "plain");
			assert.ok(plain);
			const sent = await client.request({
				op: "send",
				target: plain.ref,
				input: { requestId: "plain", text: "PLAIN-NO-TOOLS" },
			});
			if (sent.kind !== "receipt") assert.fail("No plain admission");
			const done = await client.request({ op: "wait", id: sent.receipt.id });
			if (done.kind !== "receipt") assert.fail("No plain terminal");
			assert.equal(done.receipt.status, "done");
			assert.equal(m.f.requests.length, 1);
			assert.deepEqual(m.f.requests[0]!.tools ?? [], []);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await app?.close();
			await m.close();
		}
	},
);

// Catches missing executable contribution wiring and descendant profile selection amplifying grants.
test(
	"M6 product: executable trusted bootstrap installs optional tools without amplifying model-created descendants",
	{ timeout: 20000 },
	async () => {
		let peer: unknown;
		const m = await runtimeFixture({}, undefined, (payload) => {
			const outputs = payload.messages.filter((message) => message.role === "tool");
			if (text(payload).includes("M6-MAKE-CHILD") && !outputs.length)
				return { tool: "mas_spawn", args: { key: "child", profile: "power", lifetime: "persistent" } };
			if (text(payload).includes("M6-RUN-CHILD") && !outputs.length)
				return {
					tool: "mas_send",
					args: { target: peer, requestId: "must-not-peer", text: "M6-UNAUTHORIZED-PEER" },
				};
			return { text: "M6-LOCAL-DONE" };
		});
		const dir = await mkdtemp(join(process.env.PAKKA_TEST_ARTIFACTS ?? tmpdir(), "product-"));
		let child: ReturnType<typeof spawn> | undefined;
		try {
			await m.runtime.close();
			const token = "local-product-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				file = join(dir, "server.json");
			await writeFile(
				file,
				JSON.stringify({
					schema: "pakka.server.v1",
					runtime: {
						...m.config,
						profiles: [
							{ id: "power", systemPrompt: "APPROVED-POWER" },
							{ id: "plain", systemPrompt: "INERT-PEER" },
						],
					},
					mas: { namespace: "product", maxDeliveries: 16, maxPending: 3 },
					members: [
						{ key: "root", owner: "operator" },
						{ key: "peer", owner: "operator", profile: "plain" },
					],
					roles: [{ token, principal: "operator", sourceKey: null, grants: ["discover", "send", "observe"] }],
					devpack: { profiles: { default: ["spawn"], power: ["send"] }, operationTimeoutMs: 1000 },
					http: { port: 0, origins: [] },
				}),
			);
			child = spawn(
				process.execPath,
				[resolve("apps/server/src/main.ts"), "--config", file, "--control-stdin"],
				{ stdio: ["pipe", "pipe", "pipe"] },
			);
			let stdout = "",
				stderr = "";
			const ready = await new Promise<{ endpoint: string }>((accept, reject) => {
				child!.once("error", reject);
				child!.once("exit", () => reject(new Error("Product exited before ready: " + stderr)));
				child!.stderr!.on("data", (chunk) => {
					stderr += chunk;
				});
				child!.stdout!.on("data", (chunk) => {
					stdout += chunk;
					if (!stdout.includes("\n")) return;
					try {
						accept(JSON.parse(stdout.split("\n")[0]!));
					} catch {
						reject(new Error("Invalid product ready"));
					}
				});
			});
			assert.notEqual(child.pid, process.pid);
			const client = createClient({ endpoint: ready.endpoint, token }),
				initial = await client.reconnect();
			peer = initial.members.find((member) => member.key === "peer")!.ref;
			const root = initial.members.find((member) => member.key === "root")!.ref;
			const run = await client.request({
				op: "send",
				target: root,
				input: { requestId: "make", text: "M6-MAKE-CHILD" },
			});
			if (run.kind !== "receipt") assert.fail("No root receipt");
			const done = await client.request({ op: "wait", id: run.receipt.id });
			if (done.kind !== "receipt") assert.fail("No root terminal");
			assert.equal(done.receipt.status, "done");
			const after = await client.reconnect(),
				created = after.members.find((member) => member.key === "child");
			assert.ok(created, JSON.stringify(m.f.requests.at(-1)?.messages));
			assert.equal(created.ref.profile, "power");
			assert.equal(created.lifetime, "persistent");
			assert.match(created.owner, /^worker-agent-/);
			assert.notEqual(created.owner, "operator");
			const childInput = await client.request({
				op: "send",
				target: created.ref,
				input: { requestId: "child", text: "M6-RUN-CHILD" },
			});
			if (childInput.kind !== "receipt") assert.fail("No child receipt");
			const childDone = await client.request({ op: "wait", id: childInput.receipt.id });
			if (childDone.kind !== "receipt") assert.fail("No child terminal");
			assert.equal(childDone.receipt.status, "done");
			const firstTools = m.f.requests[0]!.tools as { function: { name: string } }[];
			assert.ok(firstTools.some((tool) => tool.function.name === "mas_spawn"));
			assert.equal(m.f.requests.length, 4);
			assert.equal(
				m.f.requests.filter((payload) => text(payload).includes("M6-UNAUTHORIZED-PEER")).length,
				0,
			);
			assert.equal(m.f.errors.length, 0);
			assert.ok(!stdout.includes(token));
			assert.ok(!stderr.includes(token));
			assert.ok(!stdout.includes("local-only"));
			assert.ok(!stderr.includes("local-only"));
		} finally {
			if (child && child.exitCode === null) {
				const exit = new Promise<void>((accept) => child!.once("exit", () => accept()));
				child.stdin!.end("stop\n");
				await exit;
				assert.equal(child.exitCode, 0);
			}
			await m.close();
			if (!process.env.PAKKA_TEST_ARTIFACTS) await rm(dir, { recursive: true, force: true });
		}
	},
);

// Catches normal startup resetting native identity, durable dedup or spent Session quota.
test(
	"M6 product: normal closed reopen preserves real admission and spent quota without hidden replay",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture();
		let app: Awaited<ReturnType<typeof bootstrapServer>> | undefined;
		try {
			await m.runtime.close();
			const token = "local-reopen-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
			const config = {
				schema: "pakka.server.v1",
				runtime: {
					...m.config,
					limits: { maxConversations: 4, maxPrimaryAttempts: 1, maxAuxiliaryAttempts: 1 },
				},
				mas: { namespace: "product", maxDeliveries: 8, maxPending: 2 },
				members: [{ key: "root", owner: "operator" }],
				roles: [{ token, principal: "operator", sourceKey: null, grants: ["discover", "send", "observe"] }],
				devpack: { profiles: { default: ["observe"] } },
				http: { port: 0, origins: [] },
			};
			app = await bootstrapServer(decodeBootstrap(config));
			const first = createClient({ endpoint: app.server.endpoint, token }),
				view = await first.reconnect(),
				ref = view.members[0]!.ref;
			const input = { requestId: "retained-admission", text: "M6-ONE-CONSUMED-CALL" };
			const sent = await first.request({ op: "send", target: ref, input });
			if (sent.kind !== "receipt") assert.fail("No real initial admission");
			const done = await first.request({ op: "wait", id: sent.receipt.id });
			if (done.kind !== "receipt") assert.fail("No real initial terminal");
			assert.equal(done.receipt.status, "done");
			assert.equal(m.f.requests.length, 1);
			await app.close();
			app = undefined;
			app = await bootstrapServer(
				decodeBootstrap({
					...config,
					runtime: {
						...config.runtime,
						reopenSessionFile: join(config.runtime.dataDir, "sessions", view.sessionId, "main.jsonl"),
					},
				}),
			);
			const reopened = createClient({ endpoint: app.server.endpoint, token }),
				after = await reopened.reconnect();
			assert.equal(after.sessionId, view.sessionId);
			assert.deepEqual(after.members[0]!.ref, ref);
			assert.equal(m.f.requests.length, 1);
			const retry = await reopened.request({ op: "send", target: ref, input });
			if (retry.kind !== "receipt") assert.fail("No retained admission");
			assert.equal(retry.receipt.id, sent.receipt.id);
			assert.equal(m.f.requests.length, 1);
			const exhausted = await reopened.request({
				op: "send",
				target: ref,
				input: { requestId: "after-quota", text: "M6-MUST-NOT-RESET-BUDGET" },
			});
			if (exhausted.kind !== "receipt") assert.fail("No quota-blocked native admission");
			const settled = await reopened.request({ op: "wait", id: exhausted.receipt.id });
			if (settled.kind !== "receipt") assert.fail("No terminal native quota result");
			assert.ok(["done", "unanswered"].includes(settled.receipt.status));
			assert.equal(m.f.requests.length, 1);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await app?.close();
			await m.close();
		}
	},
);

// Catches startup treating a legitimate model-created persistent descendant as a conflicting new root.
test(
	"M6 product: explicit normal reopen retains authorized dynamic descendants without rewriting the bootstrap roots",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture({}, undefined, (payload) => {
			const command = String(
				payload.messages.filter((message) => message.role === "user").at(-1)?.content ?? "",
			);
			if (command.includes("MAKE-PERSISTENT") && !payload.messages.some((message) => message.role === "tool"))
				return {
					tool: "mas_spawn",
					args: { key: "persistent-child", profile: "plain", lifetime: "persistent" },
				};
			return { text: "PERSISTENT-LOCAL-DONE" };
		});
		let app: Awaited<ReturnType<typeof bootstrapServer>> | undefined;
		try {
			await m.runtime.close();
			const token = "local-dynamic-reopen-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
			const config = decodeBootstrap({
				schema: "pakka.server.v1",
				runtime: { ...m.config, profiles: [{ id: "plain", systemPrompt: "INERT-PERSISTENT" }] },
				mas: { namespace: "product", maxDeliveries: 8, maxPending: 2 },
				members: [{ key: "root", owner: "operator" }],
				roles: [{ token, principal: "operator", sourceKey: null, grants: ["discover", "send", "observe"] }],
				devpack: { profiles: { default: ["spawn", "observe"] } },
			});
			app = await bootstrapServer(config);
			const before = createClient({ endpoint: app.server.endpoint, token }),
				root = (await before.reconnect()).members[0]!.ref;
			const sent = await before.request({
				op: "send",
				target: root,
				input: { requestId: "make", text: "MAKE-PERSISTENT" },
			});
			if (sent.kind !== "receipt") assert.fail("No persistent spawn admission");
			const done = await before.request({ op: "wait", id: sent.receipt.id });
			if (done.kind !== "receipt") assert.fail("No persistent spawn terminal");
			assert.equal(done.receipt.status, "done");
			const state = await before.reconnect(),
				child = state.members.find((member) => member.key === "persistent-child");
			assert.ok(child);
			assert.equal(m.f.requests.length, 2);
			await app.close();
			app = undefined;
			const reopen = {
				...config,
				runtime: {
					...config.runtime,
					reopenSessionFile: join(config.runtime.dataDir, "sessions", state.sessionId, "main.jsonl"),
				},
			};
			await assert.rejects(
				bootstrapServer({ ...reopen, members: [{ key: "root", owner: "different-owner" }] }),
				/roots conflict/,
			);
			assert.equal(m.f.requests.length, 2);
			app = await bootstrapServer(reopen);
			const reopened = createClient({ endpoint: app.server.endpoint, token }),
				after = await reopened.reconnect();
			assert.deepEqual(
				after.members.map((member) => member.ref),
				state.members.map((member) => member.ref),
			);
			assert.equal(m.f.requests.length, 2);
			const work = await reopened.request({
				op: "send",
				target: child.ref,
				input: { requestId: "persistent-after-reopen", text: "PERSISTENT-STILL-AUTHORIZED" },
			});
			if (work.kind !== "receipt") assert.fail("No reopened descendant admission");
			const answered = await reopened.request({ op: "wait", id: work.receipt.id });
			if (answered.kind !== "receipt") assert.fail("No reopened descendant terminal");
			assert.equal(answered.receipt.status, "done");
			assert.equal(m.f.requests.length, 3);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await app?.close();
			await m.close();
		}
	},
);

// Catches product wiring dropping native task ownership or treating temporary as a long-lived member.
for (const lifetime of ["task-bound", "temporary"] as const) {
	test(
		`M6 product: ${lifetime} model-created member cannot receive work after its creating tool task ends`,
		{ timeout: 20000 },
		async () => {
			const m = await runtimeFixture({}, undefined, (payload) => {
				const outputs = payload.messages.filter((message) => message.role === "tool");
				return outputs.length === 0
					? { tool: "mas_spawn", args: { key: "ephemeral", profile: "plain", lifetime } }
					: { text: "OWNER-TOOL-FINISHED" };
			});
			let app: Awaited<ReturnType<typeof bootstrapServer>> | undefined;
			try {
				await m.runtime.close();
				const token = "local-lifetime-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
				app = await bootstrapServer(
					decodeBootstrap({
						schema: "pakka.server.v1",
						runtime: { ...m.config, profiles: [{ id: "plain", systemPrompt: "INERT-EPHEMERAL" }] },
						mas: { namespace: "product", maxDeliveries: 8, maxPending: 2 },
						members: [{ key: "root", owner: "operator" }],
						roles: [
							{ token, principal: "operator", sourceKey: null, grants: ["discover", "send", "observe"] },
						],
						devpack: { profiles: { default: ["spawn", "observe"] } },
					}),
				);
				const client = createClient({ endpoint: app.server.endpoint, token }),
					initial = await client.reconnect();
				const sent = await client.request({
					op: "send",
					target: initial.members[0]!.ref,
					input: { requestId: "create-ephemeral", text: "CREATE-EPHEMERAL" },
				});
				if (sent.kind !== "receipt") assert.fail("No actual tool owner admission");
				const done = await client.request({ op: "wait", id: sent.receipt.id });
				if (done.kind !== "receipt") assert.fail("No owner terminal");
				assert.equal(done.receipt.status, "done");
				const child = (await client.reconnect()).members.find((member) => member.key === "ephemeral");
				assert.ok(child);
				assert.equal(child.lifetime, lifetime);
				assert.match(child.owner, /^worker-agent-/);
				const inspected = await client.request({ op: "inspect", target: child.ref });
				if (inspected.kind !== "member") assert.fail("No native readiness");
				assert.equal(inspected.member.phase, "ended");
				await assert.rejects(
					client.request({
						op: "send",
						target: child.ref,
						input: { requestId: "late", text: "NO-ENDED-CHILD-EFFECT" },
					}),
				);
				assert.equal(m.f.requests.length, 2);
				assert.equal(m.f.errors.length, 0);
			} finally {
				await app?.close();
				await m.close();
			}
		},
	);
}

// Catches product wiring making background lifetime follow a completed tool task, or retiring only a label.
test(
	"M6 product: background member survives its creating tool and requires explicit owner retirement",
	{ timeout: 20000 },
	async () => {
		let childRef: unknown;
		const m = await runtimeFixture({}, undefined, (payload) => {
			const lastUser = payload.messages.map((message) => message.role).lastIndexOf("user");
			const command = String(payload.messages[lastUser]?.content ?? ""),
				outputs = payload.messages.slice(lastUser + 1).filter((message) => message.role === "tool");
			if (command.includes("CREATE-BACKGROUND") && outputs.length === 0)
				return { tool: "mas_spawn", args: { key: "background", profile: "plain", lifetime: "background" } };
			if (command.includes("RETIRE-BACKGROUND") && outputs.length === 0)
				return { tool: "mas_retire", args: { target: childRef } };
			return { text: "BACKGROUND-LOCAL-DONE" };
		});
		let app: Awaited<ReturnType<typeof bootstrapServer>> | undefined;
		try {
			await m.runtime.close();
			const token = "local-background-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
			app = await bootstrapServer(
				decodeBootstrap({
					schema: "pakka.server.v1",
					runtime: { ...m.config, profiles: [{ id: "plain", systemPrompt: "INERT-BACKGROUND" }] },
					mas: { namespace: "product", maxDeliveries: 12, maxPending: 2 },
					members: [{ key: "root", owner: "operator" }],
					roles: [{ token, principal: "operator", sourceKey: null, grants: ["discover", "send", "observe"] }],
					devpack: { profiles: { default: ["spawn", "observe", "retire"] } },
				}),
			);
			const client = createClient({ endpoint: app.server.endpoint, token }),
				initial = await client.reconnect(),
				root = initial.members[0]!.ref;
			const started = await client.request({
				op: "send",
				target: root,
				input: { requestId: "create", text: "CREATE-BACKGROUND" },
			});
			if (started.kind !== "receipt") assert.fail("No native create");
			const created = await client.request({ op: "wait", id: started.receipt.id });
			if (created.kind !== "receipt") assert.fail("No create terminal");
			assert.equal(created.receipt.status, "done");
			const child = (await client.reconnect()).members.find((member) => member.key === "background");
			assert.ok(child);
			childRef = child.ref;
			assert.equal(child.lifetime, "background");
			const live = await client.request({ op: "inspect", target: child.ref });
			if (live.kind !== "member") assert.fail("No background readiness");
			assert.equal(live.member.phase, "active");
			const work = await client.request({
				op: "send",
				target: child.ref,
				input: { requestId: "still-live", text: "BACKGROUND-STILL-LIVE" },
			});
			if (work.kind !== "receipt") assert.fail("No surviving background admission");
			const answered = await client.request({ op: "wait", id: work.receipt.id });
			if (answered.kind !== "receipt") assert.fail("No surviving terminal");
			assert.equal(answered.receipt.status, "done");
			const stop = await client.request({
				op: "send",
				target: root,
				input: { requestId: "retire", text: "RETIRE-BACKGROUND" },
			});
			if (stop.kind !== "receipt") assert.fail("No owner retire admission");
			const retired = await client.request({ op: "wait", id: stop.receipt.id });
			if (retired.kind !== "receipt") assert.fail("No owner retire terminal");
			assert.equal(retired.receipt.status, "done");
			const dead = await client.request({ op: "inspect", target: child.ref });
			if (dead.kind !== "member") assert.fail("No retired metadata");
			assert.equal(dead.member.phase, "retired");
			await assert.rejects(
				client.request({
					op: "send",
					target: child.ref,
					input: { requestId: "late", text: "NO-RETIRED-BACKGROUND-EFFECT" },
				}),
			);
			assert.equal(m.f.requests.length, 5);
			assert.equal(m.f.errors.length, 0);
		} finally {
			await app?.close();
			await m.close();
		}
	},
);

// Catches remote profile-selection authority amplification: unsupported config must not open storage.
test("M6 product: RPC profile-changing grants are refused before storage when model contributions are enabled", async () => {
	const m = await runtimeFixture();
	try {
		await m.runtime.close();
		for (const grant of ["spawn", "configure", "fork"] as const) {
			const dataDir = join(m.f.root, "forbidden-" + grant);
			const config = {
				schema: "pakka.server.v1" as const,
				runtime: { ...m.config, dataDir },
				mas: { namespace: "product", maxDeliveries: 8, maxPending: 2 },
				members: [{ key: "root", owner: "operator" }],
				roles: [
					{
						token: "local-forbidden-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
						principal: "operator",
						sourceKey: null,
						grants: [grant],
					},
				],
				devpack: { profiles: { default: ["spawn" as const] } },
			};
			await assert.rejects(bootstrapServer(config));
			await assert.rejects(access(dataDir));
			assert.equal(m.f.requests.length, 0);
		}
	} finally {
		await m.close();
	}
});
