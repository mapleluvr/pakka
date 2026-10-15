import { test } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { deferred } from "../../../packages/agent/test/fixture.ts";
import { createRuntime, type Runtime } from "@pakka/agent";
import { createPocketPeople, createPocketWorkspace } from "@pakka/server/pocket";
import { createExtensionHost } from "../src/extension-host.ts";
import type { ExtensionHost } from "../src/backend.ts";

async function initialize(runtime: Runtime) {
	const people = await createPocketPeople({ runtime, namespace: "initialization.people" });
	const workspace = createPocketWorkspace({
		runtime,
		people,
		catalog: { namespace: "initialization.workspace", maxDeliveries: 8, maxPending: 4 },
		profileCeiling: () => ["default"],
	});
	return { people, workspace };
}
async function source(root: string, content: string) {
	await mkdir(root);
	await writeFile(
		join(root, "manifest.json"),
		JSON.stringify({
			api: 1,
			id: "initialization",
			version: "1.0.0",
			title: "Initialization",
			facets: { backend: "backend.mjs" },
			actions: [],
			commands: [],
			interfaces: [],
		}),
	);
	await writeFile(join(root, "backend.mjs"), content);
	return { root };
}
async function finite<T>(value: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			value,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("Initialization observation deadline")), 2000);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

test(
	"Extension initialization: failed import stays unavailable across native writer reopen until explicit reload",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture();
		let reopened: Runtime | undefined;
		try {
			const root = join(m.f.root, "failed-import"),
				marker = join(m.f.root, "unexpected-initialization"),
				approved = await source(root, "export const actions={};");
			const services = await initialize(m.runtime),
				session = await services.people.initializeOwner("Owner"),
				actor = await services.people.authenticate(session.token);
			const host = await createExtensionHost({ runtime: m.runtime, ...services, sources: [approved] });
			await writeFile(join(root, "backend.mjs"), 'throw new Error("unconfirmed module initialization");');
			await assert.rejects(host.reload(actor, "initialization"));
			await writeFile(
				join(root, "backend.mjs"),
				`import {writeFileSync} from "node:fs";writeFileSync(new URL(${JSON.stringify(pathToFileURL(marker).href)}),"entered");export const actions={};`,
			);
			const file = m.runtime.view().sessionFile;
			await m.runtime.close();
			reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
			const nextServices = await initialize(reopened),
				nextActor = await nextServices.people.authenticate(session.token),
				next = await createExtensionHost({ runtime: reopened, ...nextServices, sources: [approved] });
			assert.equal(next.list(nextActor)[0]!.phase, "unknown");
			await assert.rejects(access(marker), { code: "ENOENT" });
			await next.reload(nextActor, "initialization");
			assert.equal(next.list(nextActor)[0]!.phase, "ready");
			await access(marker);
			assert.equal(m.f.requests.length, 0);
		} finally {
			await reopened?.close();
			await m.close();
		}
	},
);

test(
	"Extension initialization: writer closes after a real HTTP effect while import is pending; reopen does not re-enter or await it",
	{ timeout: 20000 },
	async () => {
		const m = await runtimeFixture(),
			entered = deferred();
		let response: ServerResponse | undefined,
			count = 0,
			reopened: Runtime | undefined,
			first: Promise<ExtensionHost> | undefined,
			next: Promise<ExtensionHost> | undefined;
		const server = createServer((_req, res) => {
			count++;
			response = res;
			entered.resolve();
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			assert.ok(address && typeof address === "object");
			const approved = await source(
				join(m.f.root, "pending-import"),
				`await fetch("http://127.0.0.1:${address.port}/initialization");export const actions={};`,
			);
			const services = await initialize(m.runtime),
				session = await services.people.initializeOwner("Owner");
			first = createExtensionHost({ runtime: m.runtime, ...services, sources: [approved] });
			await finite(entered.promise);
			const file = m.runtime.view().sessionFile;
			await m.runtime.close();
			reopened = await createRuntime({ ...m.config, reopenSessionFile: file });
			const nextServices = await initialize(reopened),
				actor = await nextServices.people.authenticate(session.token);
			next = createExtensionHost({ runtime: reopened, ...nextServices, sources: [approved] });
			const host = await finite(next);
			assert.equal(host.list(actor)[0]!.phase, "unknown");
			assert.equal(count, 1);
			assert.equal(m.f.requests.length, 0);
		} finally {
			response?.end("released");
			await Promise.allSettled([first, next]);
			await reopened?.close();
			await m.close();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	},
);
