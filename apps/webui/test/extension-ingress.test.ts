import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { fixture } from "./fixture.ts";
import { createExtensionHost } from "../src/extension-host.ts";
import { createPocketHttp } from "../src/http.ts";
import type { ExtensionService, ExtensionIngressRequest } from "../src/backend.ts";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function setup(paused = false, timeoutMs = 1000) {
	const m = await fixture(),
		root = join(m.f.root, "incoming-example"),
		effect = join(m.f.root, "incoming-effect.bin"),
		entered = deferred(),
		release = deferred();
	let calls = 0;
	try {
		await mkdir(root, { recursive: true });
		await writeFile(
			join(root, "manifest.json"),
			JSON.stringify({
				api: 1,
				id: "incoming-example",
				version: "1.0.0",
				title: "Incoming example",
				facets: { backend: "backend.mjs" },
				services: ["incoming"],
				actions: [],
				commands: [],
				interfaces: [],
			}),
		);
		await writeFile(join(root, "backend.mjs"), "export const actions={};");
		const service = {
			permission: "read",
			bind: () => Object.freeze({}),
			ingress: {
				maxBytes: 64,
				timeoutMs,
				output: { type: "object", properties: { accepted: { type: "boolean" } }, required: ["accepted"] },
				handle: async (request: ExtensionIngressRequest) => {
					calls++;
					assert.deepEqual(request.path, ["delivery"]);
					assert.equal(request.headers.cookie, undefined);
					const expected = createHmac("sha256", "SYNTHETIC-INCOMING-SECRET")
						.update(request.body)
						.digest("hex");
					const sent = request.headers["x-test-signature"] ?? "";
					if (sent.length !== expected.length || !timingSafeEqual(Buffer.from(sent), Buffer.from(expected)))
						return { status: 404, value: { accepted: false } };
					entered.resolve();
					if (paused) await release.promise;
					request.check();
					await writeFile(effect, request.body);
					return { status: 202, value: { accepted: true } };
				},
			},
		} satisfies ExtensionService;
		const extensions = await createExtensionHost({
			runtime: m.runtime,
			people: m.people,
			workspace: m.workspace,
			sources: [{ root }],
			services: { incoming: service },
		});
		const http = await createPocketHttp({
			runtime: m.runtime,
			people: m.people,
			workspace: m.workspace,
			extensions,
		});
		const post = (bytes: Uint8Array, options: { service?: string; headers?: Record<string, string> } = {}) =>
			fetch(
				http.origin + "/pocket/ingress/incoming-example/" + (options.service ?? "incoming") + "/delivery",
				{
					method: "POST",
					headers: {
						"content-type": "application/octet-stream",
						"x-test-signature": createHmac("sha256", "SYNTHETIC-INCOMING-SECRET").update(bytes).digest("hex"),
						...options.headers,
					},
					body: new Uint8Array(bytes),
				},
			);
		return {
			...m,
			http: undefined,
			ingressHttp: http,
			extensions,
			service,
			effect,
			entered,
			release,
			post,
			calls: () => calls,
			close: async () => {
				release.resolve();
				await http.close();
				await m.close();
			},
		};
	} catch (error) {
		release.resolve();
		await m.close();
		throw error;
	}
}

test(
	"Extension ingress: an approved non-MAS service verifies exact raw bytes without Cookie authority or model dispatch",
	{ timeout: 12000 },
	async () => {
		const m = await setup();
		try {
			const bytes = Buffer.from([0x7b, 0xff, 0x00, 0x7d]);
			const response = await m.post(bytes, { headers: { Cookie: m.admin.cookies } });
			assert.equal(response.status, 202);
			assert.deepEqual(await response.json(), { accepted: true });
			assert.deepEqual(await readFile(m.effect), bytes);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);

test(
	"Extension ingress: finite bodies, declared service, transport Origin and signatures fail before any target write",
	{ timeout: 12000 },
	async () => {
		const m = await setup();
		try {
			assert.equal((await m.post(Buffer.alloc(65))).status, 413);
			assert.equal(m.calls(), 0);
			assert.equal((await m.post(Buffer.from("data"), { service: "undeclared" })).status, 404);
			assert.equal(m.calls(), 0);
			assert.equal(
				(await m.post(Buffer.from("data"), { headers: { Origin: "https://unapproved.invalid" } })).status,
				403,
			);
			assert.equal(m.calls(), 0);
			const bad = await m.post(Buffer.from("data"), { headers: { "x-test-signature": "bad" } });
			assert.equal(bad.status, 404);
			assert.equal(m.calls(), 1);
			await assert.rejects(readFile(m.effect), { code: "ENOENT" });
			assert.equal(m.f.requests.length, 0);
		} finally {
			await m.close();
		}
	},
);

test(
	"Extension ingress: closing a backend generation blocks a waiting real disk effect and prevents a later invocation",
	{ timeout: 12000 },
	async (t) => {
		const m = await setup(true);
		let response: Promise<Response> | undefined;
		try {
			response = m.post(Buffer.from("late-effect"));
			await t.waitFor(() => assert.equal(m.calls(), 1), { timeout: 2000 });
			await m.extensions.setEnabled(m.actor, "incoming-example", false);
			m.release.resolve();
			assert.equal((await response).status, 500);
			await assert.rejects(readFile(m.effect), { code: "ENOENT" });
			assert.equal((await m.post(Buffer.from("new-effect"))).status, 404);
			assert.equal(m.calls(), 1);
			assert.equal(m.f.requests.length, 0);
		} finally {
			m.release.resolve();
			await response?.catch(() => {});
			await m.close();
		}
	},
);

test(
	"Extension ingress: a finite deadline returns unknown and a late handler cannot write after its live check expires",
	{ timeout: 12000 },
	async () => {
		const m = await setup(true, 50);
		try {
			const response = await m.post(Buffer.from("deadline-effect"));
			assert.equal(response.status, 500);
			const value: unknown = await response.json();
			assert.ok(
				value &&
					typeof value === "object" &&
					"error" in value &&
					value.error &&
					typeof value.error === "object" &&
					"outcome" in value.error,
			);
			assert.equal(value.error.outcome, "unknown");
			m.release.resolve();
			await new Promise<void>((resolve) => setImmediate(resolve));
			await assert.rejects(readFile(m.effect), { code: "ENOENT" });
			assert.equal(m.calls(), 1);
			assert.equal(m.f.requests.length, 0);
		} finally {
			m.release.resolve();
			await m.close();
		}
	},
);

test(
	"Extension ingress: mutating the host's original route cannot expand its approved bound or replace its handler",
	{ timeout: 12000 },
	async () => {
		const m = await setup();
		try {
			m.service.ingress.maxBytes = 65536;
			m.service.ingress.handle = async () => ({ status: 202, value: { accepted: true } });
			assert.equal((await m.post(Buffer.alloc(65))).status, 413);
			const bytes = Buffer.from("captured-handler");
			assert.equal((await m.post(bytes)).status, 202);
			assert.deepEqual(await readFile(m.effect), bytes);
			assert.equal(m.calls(), 1);
		} finally {
			await m.close();
		}
	},
);
