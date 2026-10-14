import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createMas, MasRequestDenied } from "@pakka/mas";
import { mkdir, rename, rm } from "node:fs/promises";
import { decodeResponse } from "../../../packages/protocol/src/index.ts";
import type { Command, Response } from "../../../packages/protocol/src/index.ts";
import { createMasServer } from "../src/http-server.ts";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred, text } from "../../../packages/agent/test/fixture.ts";
const token = "local-test-alice-aaaaaaaaaaaaaaaaaaaaaaaa",
	observer = "local-test-observer-bbbbbbbbbbbbbbbbbbbb",
	peerToken = "local-test-peer-cccccccccccccccccccccccc";
async function crew(
	extra: {
		expiresAt?: number;
		expiresAfterMs?: number;
		maxPending?: number;
		respond?: Parameters<typeof runtimeFixture>[2];
	} = {},
) {
	const fixture = await runtimeFixture({}, undefined, extra.respond);
	try {
		const mas = await createMas({
			runtime: fixture.runtime,
			namespace: "remote",
			maxDeliveries: 16,
			maxPending: 4,
		});
		await mas.bootstrap([
			{ key: "alice", owner: "alice" },
			{ key: "peer", owner: "bob" },
		]);
		await mas.activate();
		const [source, target] = (await mas.view()).members.map((member) => member.ref);
		const expiresAt =
			extra.expiresAt ?? (extra.expiresAfterMs === undefined ? undefined : Date.now() + extra.expiresAfterMs);
		const server = await createMasServer({
			mas,
			sessionId: fixture.runtime.view().sessionId,
			origins: ["http://127.0.0.1:12345"],
			maxPending: extra.maxPending,
			roles: [
				{
					token,
					principal: "alice",
					source: source!,
					grants: ["discover", "send", "observe", "spawn", "steer", "abort", "retire", "configure", "fork"],
					...(expiresAt === undefined ? {} : { expiresAt }),
				},
				{ token: observer, principal: "observer", source: null, grants: ["discover", "observe"] },
				{ token: peerToken, principal: "bob", source: target!, grants: ["observe", "send"] },
			],
		});
		const endpoint = new URL(server.endpoint);
		assert.equal(endpoint.protocol, "http:");
		assert.equal(endpoint.hostname, "127.0.0.1");
		let sequence = 0;
		async function rpc(command: Command, credential = token): Promise<Response> {
			const id = "rpc-" + ++sequence;
			const response = await fetch(server.endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer " + credential },
				body: JSON.stringify({ version: 1, requestId: id, command }),
			});
			return decodeResponse(await response.json(), id);
		}
		return {
			fixture,
			mas,
			source: source!,
			target: target!,
			expiresAt,
			server,
			rpc,
			close: async () => {
				await server.close();
				await fixture.close();
			},
		};
	} catch (error) {
		await fixture.close();
		throw error;
	}
}
test(
	"M5 HTTP: host-bound source and native admission survive repeated message ID; copied receipt is not authority",
	{ timeout: 20000 },
	async () => {
		const m = await crew();
		try {
			const hello = await m.rpc({ op: "hello" });
			assert.ok("result" in hello);
			if ("result" in hello && hello.result.kind === "hello") assert.equal(hello.result.principal, "alice");
			const sent = await m.rpc({
				op: "send",
				target: m.target,
				input: { requestId: "same-input", text: "REAL-REMOTE-INPUT" },
			});
			assert.ok("result" in sent);
			if (!("result" in sent) || sent.result.kind !== "receipt") assert.fail("native receipt missing");
			assert.deepEqual(sent.result.receipt.source, m.source);
			const id = sent.result.receipt.id;
			const done = await m.rpc({ op: "wait", id });
			assert.ok("result" in done);
			if ("result" in done && done.result.kind === "receipt")
				assert.equal(done.result.receipt.status, "done");
			const repeat = await m.rpc({
				op: "send",
				target: m.target,
				input: { requestId: "same-input", text: "REAL-REMOTE-INPUT" },
			});
			assert.ok("result" in repeat);
			if ("result" in repeat && repeat.result.kind === "receipt") assert.equal(repeat.result.receipt.id, id);
			const foreign = await m.rpc({ op: "receipt", id }, observer);
			if (!("error" in foreign)) assert.fail("Foreign receipt published");
			assert.equal(foreign.error.outcome, "denied");
			assert.equal(foreign.error.code, "FORBIDDEN");
			assert.equal(m.fixture.f.requests.length, 1);
			assert.match(text(m.fixture.f.requests[0]!), /REAL-REMOTE-INPUT/);
			const snapshot = await m.rpc({ op: "snapshot" });
			assert.ok("result" in snapshot, JSON.stringify({ snapshot, view: await m.mas.view() }));
			if ("result" in snapshot && snapshot.result.kind === "snapshot")
				assert.equal(snapshot.result.sessionId, m.source.sessionId);
		} finally {
			await m.close();
		}
	},
);
test(
	"M5 HTTP: four definitive guard families return correlated denied without native effects",
	{ timeout: 20000 },
	async () => {
		const m = await crew();
		try {
			let sequence = 0;
			const endpoint = new URL(m.server.endpoint);
			assert.equal(endpoint.protocol, "http:");
			assert.equal(endpoint.hostname, "127.0.0.1");
			const denied = async (command: Command, credential = token) => {
				const id = "guard-" + ++sequence;
				const response = await fetch(endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json", Authorization: "Bearer " + credential },
					body: JSON.stringify({ version: 1, requestId: id, command }),
				});
				const reply = decodeResponse(await response.json(), id);
				assert.equal(response.status, 403);
				if (!("error" in reply)) assert.fail("Guard published a result");
				assert.equal(reply.error.code, "FORBIDDEN");
				assert.equal(reply.error.outcome, "denied");
			};
			for (const command of [
				{ op: "abort", target: m.target },
				{ op: "retire", target: m.target },
				{ op: "configure", target: m.target, profile: "default" },
				{ op: "fork", target: m.target, key: "not-owned", entryId: "not-owned" },
			] satisfies readonly Command[])
				await denied(command);
			assert.equal(m.fixture.f.requests.length, 0);
			const sent = await m.rpc({
				op: "send",
				target: m.target,
				input: { requestId: "guard-source", text: "ONLY-GUARD-SOURCE" },
			});
			if (!("result" in sent) || sent.result.kind !== "receipt") assert.fail("Missing real receipt");
			await m.rpc({ op: "wait", id: sent.result.receipt.id });
			await denied({ op: "receipt", id: sent.result.receipt.id }, observer);
			await denied({ op: "withdraw", id: sent.result.receipt.id }, peerToken);
			const spawned = await m.rpc({ op: "spawn", key: "retired-guard" });
			if (!("result" in spawned) || spawned.result.kind !== "member") assert.fail("No owned guard member");
			await m.rpc({ op: "retire", target: spawned.result.member.ref });
			await denied({
				op: "send",
				target: spawned.result.member.ref,
				input: { requestId: "no-retired-effect", text: "NO-RETIRED-EFFECT" },
			});
			assert.equal(m.fixture.f.requests.length, 1);
		} finally {
			await m.close();
		}
	},
);
for (const refusal of ["return-false", "typed-error"] as const) {
	test(
		"M5 HTTP: opaque admission " + refusal + " cannot deny prior real callback effects",
		{ timeout: 20000 },
		async () => {
			const m = await crew();
			try {
				m.mas.setAdmission(async () => {
					const host = m.fixture.runtime.root();
					await host
						.connect("callback", ["input.submit"])
						.submit({ key: "callback-effect", text: "REAL-CALLBACK-EFFECT" });
					await host.waitForIdle();
					if (refusal === "typed-error") throw new MasRequestDenied("Callback cannot establish no effects");
					return false;
				});
				const reply = await m.rpc({
					op: "send",
					target: m.target,
					input: { requestId: "callback-refusal", text: "NO-TARGET-AFTER-CALLBACK" },
				});
				if (!("error" in reply)) assert.fail("Opaque refusal published success");
				assert.equal(reply.error.outcome, "unknown");
				assert.equal(m.fixture.f.requests.length, 1);
				assert.match(text(m.fixture.f.requests[0]!), /REAL-CALLBACK-EFFECT/);
				assert.doesNotMatch(text(m.fixture.f.requests[0]!), /NO-TARGET-AFTER-CALLBACK/);
			} finally {
				await m.close();
			}
		},
	);
}
test(
	"M5 HTTP: actual native storage-write failure remains unknown rather than typed denial",
	{ timeout: 20000 },
	async () => {
		const m = await crew();
		const file = m.fixture.runtime.view().sessionFile;
		let replaced = false;
		try {
			await rename(file, file + ".saved");
			replaced = true;
			await mkdir(file);
			const reply = await m.rpc({ op: "spawn", key: "unknown-storage" });
			if (!("error" in reply)) assert.fail("Unknown persistence published success");
			assert.equal(reply.error.outcome, "unknown");
			assert.equal(m.fixture.runtime.view().phase, "failed");
			assert.equal(m.fixture.f.requests.length, 0);
		} finally {
			if (replaced) {
				await rm(file, { recursive: true, force: true });
				await rename(file + ".saved", file);
			}
			await m.close();
		}
	},
);
test(
	"M5 HTTP: invalid wire/version/authority fields and unapproved origins cause zero provider effects",
	{ timeout: 20000 },
	async () => {
		const m = await crew();
		try {
			for (const body of [
				{ version: 2, requestId: "bad", command: { op: "hello" } },
				{
					version: 1,
					requestId: "bad",
					principal: "alice",
					command: { op: "send", target: m.target, input: { requestId: "forged", text: "FORGED" } },
				},
			]) {
				const response = await fetch(m.server.endpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
					body: JSON.stringify(body),
				});
				assert.equal(response.status, 400);
				const refused = decodeResponse(await response.json(), "bad");
				if (!("error" in refused)) assert.fail("Malformed command published");
				assert.equal(refused.error.outcome, "denied");
			}
			const unauthorized = await m.rpc({ op: "hello" }, "incorrect-local-token");
			assert.ok("error" in unauthorized);
			if ("error" in unauthorized) assert.equal(unauthorized.error.code, "UNAUTHORIZED");
			const origin = await fetch(m.server.endpoint, {
				method: "POST",
				headers: { Origin: "http://unapproved.invalid", Authorization: "Bearer " + token },
				body: JSON.stringify({ version: 1, requestId: "origin", command: { op: "snapshot" } }),
			});
			assert.equal(origin.status, 403);
			const rejected = await m.rpc(
				{ op: "send", target: m.target, input: { requestId: "observer", text: "NO-SEND-GRANT" } },
				observer,
			);
			assert.ok("error" in rejected);
			if ("error" in rejected) assert.equal(rejected.error.outcome, "denied");
			assert.equal(m.fixture.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);
test(
	"M5 HTTP: malformed UTF-8 refuses instead of substituting a model-visible message",
	{ timeout: 20000 },
	async () => {
		const m = await crew();
		try {
			const encoded = JSON.stringify({
				version: 1,
				requestId: "bytes",
				command: { op: "send", target: m.target, input: { requestId: "bad-bytes", text: "BYTE-MARKER" } },
			});
			const position = encoded.indexOf("BYTE-MARKER");
			const body = Buffer.concat([
				Buffer.from(encoded.slice(0, position)),
				Buffer.from([255]),
				Buffer.from(encoded.slice(position + "BYTE-MARKER".length)),
			]);
			const allowed = new URL(m.server.endpoint);
			assert.equal(allowed.protocol, "http:");
			assert.equal(allowed.hostname, "127.0.0.1");
			const response = await fetch(allowed, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
				body,
			});
			assert.equal(response.status, 400);
			assert.equal(m.fixture.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);
test(
	"M5 HTTP: expired issuer credential cannot create effects or be restored by new connection",
	{ timeout: 20000 },
	async () => {
		const m = await crew({ expiresAt: Date.now() - 1000 });
		try {
			for (const command of [
				{ op: "hello" } as const,
				{
					op: "send",
					target: m.target,
					input: { requestId: "expired", text: "NO-EXPIRED-DISPATCH" },
				} as const,
			]) {
				const response = await m.rpc(command);
				assert.ok("error" in response);
				if ("error" in response) {
					assert.equal(response.error.code, "UNAUTHORIZED");
					assert.equal(response.error.outcome, "denied");
				}
			}
			assert.equal(m.fixture.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);
test(
	"M5 HTTP: issuer expiry during awaited admission is rechecked at the native commit boundary",
	{ timeout: 20000 },
	async () => {
		const m = await crew({ expiresAfterMs: 500 }),
			entered = deferred(),
			release = deferred();
		try {
			m.mas.setAdmission(async () => {
				entered.resolve();
				await release.promise;
				return true;
			});
			const pending = m.rpc({
				op: "send",
				target: m.target,
				input: { requestId: "late-expiry", text: "NO-EXPIRED-COMMIT" },
			});
			await entered.promise;
			await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, m.expiresAt! - Date.now()) + 10));
			release.resolve();
			const outcome = await pending;
			if (!("error" in outcome)) assert.fail("Expired awaited admission published");
			assert.equal(outcome.error.outcome, "unknown");
			assert.equal(m.fixture.f.requests.length, 0);
			const fresh = await m.rpc({ op: "hello" });
			if (!("error" in fresh)) assert.fail("Expired reconnect accepted");
			assert.equal(fresh.error.code, "UNAUTHORIZED");
		} finally {
			release.resolve();
			await m.close();
		}
	},
);
test(
	"M5 HTTP: queued native withdrawal, owner abort and retire preserve explicit effect boundaries",
	{ timeout: 20000 },
	async () => {
		const entered = deferred(),
			release = deferred(),
			m = await crew({
				respond: async () => {
					entered.resolve();
					await release.promise;
					return { text: "LOCAL-BLOCKED-ANSWER" };
				},
			});
		try {
			const created = await m.rpc({ op: "spawn", key: "owned" });
			if (!("result" in created) || created.result.kind !== "member") assert.fail("No owned member");
			const target = created.result.member.ref;
			const first = await m.rpc({
				op: "send",
				target,
				input: { requestId: "running", text: "RUNNING-REMOTE" },
			});
			if (!("result" in first) || first.result.kind !== "receipt") assert.fail("No active receipt");
			await entered.promise;
			const queued = await m.rpc({
				op: "send",
				target,
				input: { requestId: "withdraw-me", text: "MUST-NOT-DISPATCH", mode: "followUp" },
			});
			if (!("result" in queued) || queued.result.kind !== "receipt")
				assert.fail("No queued receipt: " + JSON.stringify(queued));
			assert.equal(queued.result.receipt.status, "queued");
			await m.rpc({ op: "withdraw", id: queued.result.receipt.id });
			const terminal = await m.rpc({ op: "wait", id: queued.result.receipt.id });
			if (!("result" in terminal) || terminal.result.kind !== "receipt") assert.fail("No withdrawn receipt");
			assert.equal(terminal.result.receipt.status, "unanswered");
			const foreign = await m.rpc({ op: "abort", target: m.target });
			assert.ok("error" in foreign); // send/abort grant is not target ownership.
			const stopped = await m.rpc({ op: "abort", target });
			assert.ok("result" in stopped);
			release.resolve();
			const retired = await m.rpc({ op: "retire", target });
			if (!("result" in retired) || retired.result.kind !== "member") assert.fail("No retired member");
			assert.equal(retired.result.member.phase, "retired");
			const denied = await m.rpc({
				op: "send",
				target,
				input: { requestId: "retired", text: "NO-RETIRED-DISPATCH" },
			});
			assert.ok("error" in denied);
			assert.equal(m.fixture.f.requests.length, 1);
			assert.doesNotMatch(text(m.fixture.f.requests[0]!), /MUST-NOT-DISPATCH|NO-RETIRED-DISPATCH/);
		} finally {
			release.resolve();
			await m.close();
		}
	},
);
test(
	"M5 HTTP: finite transport capacity refuses excess requests before an admission effect",
	{ timeout: 20000 },
	async () => {
		const m = await crew({ maxPending: 1 }),
			entered = deferred(),
			release = deferred();
		try {
			m.mas.setAdmission(async () => {
				entered.resolve();
				await release.promise;
				return true;
			});
			const pending = m.rpc({
				op: "send",
				target: m.target,
				input: { requestId: "capacity-first", text: "ONLY-CAPACITY-FIRST" },
			});
			await entered.promise;
			const allowed = new URL(m.server.endpoint);
			assert.equal(allowed.protocol, "http:");
			assert.equal(allowed.hostname, "127.0.0.1");
			const overflow = await fetch(allowed, {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
				body: JSON.stringify({
					version: 1,
					requestId: "overflow",
					command: {
						op: "send",
						target: m.target,
						input: { requestId: "capacity-overflow", text: "NO-CAPACITY-OVERFLOW" },
					},
				}),
			});
			assert.equal(overflow.status, 429);
			assert.equal(m.fixture.f.requests.length, 0);
			release.resolve();
			const admitted = await pending;
			if (!("result" in admitted) || admitted.result.kind !== "receipt") assert.fail("No first admission");
			await m.rpc({ op: "wait", id: admitted.result.receipt.id });
			assert.equal(m.fixture.f.requests.length, 1);
			assert.doesNotMatch(text(m.fixture.f.requests[0]!), /NO-CAPACITY-OVERFLOW/);
		} finally {
			release.resolve();
			await m.close();
		}
	},
);
test(
	"M5 HTTP: issuer revocation during admission seals pending effect and cannot be renewed by reconnect",
	{ timeout: 20000 },
	async () => {
		const m = await crew(),
			entered = deferred(),
			release = deferred();
		try {
			m.mas.setAdmission(async () => {
				entered.resolve();
				await release.promise;
				return true;
			});
			const pending = m.rpc({
				op: "send",
				target: m.target,
				input: { requestId: "late", text: "REVOKED-BEFORE-COMMIT" },
			});
			await entered.promise;
			m.server.revoke("alice");
			release.resolve();
			const refused = await pending;
			if (!("error" in refused)) assert.fail("Revoked awaited admission published");
			assert.equal(refused.error.outcome, "unknown");
			const reconnect = await m.rpc({ op: "hello" });
			assert.ok("error" in reconnect);
			if ("error" in reconnect) assert.equal(reconnect.error.code, "UNAUTHORIZED");
			assert.equal(m.fixture.f.requests.length, 0);
		} finally {
			release.resolve();
			await m.close();
		}
	},
);
