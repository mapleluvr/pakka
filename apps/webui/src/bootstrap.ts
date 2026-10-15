import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, type RuntimeOptions, type JsonObject } from "@pakka/agent";
import { createPocketPeople, createPocketWorkspace, type PocketSession } from "@pakka/server/pocket";
import { createPocketHttp, type PocketHttpOptions } from "./http.ts";

export interface PocketProductOptions {
	readonly runtime: RuntimeOptions;
	readonly owner: string;
	readonly initial?: readonly { readonly name: string; readonly profile: string }[];
	readonly profiles?: readonly string[];
	readonly transport?: Omit<PocketHttpOptions, "runtime" | "people" | "workspace" | "assets">;
}
const types: Readonly<Record<string, string>> = {
	html: "text/html; charset=utf-8",
	js: "text/javascript; charset=utf-8",
	css: "text/css; charset=utf-8",
	svg: "image/svg+xml",
	png: "image/png",
	woff2: "font/woff2",
	txt: "text/plain; charset=utf-8",
	webmanifest: "application/manifest+json",
};
async function publicAssets() {
	const directory = fileURLToPath(new URL("../web/", import.meta.url)),
		assets = new Map<string, { type: string; body: Uint8Array }>();
	let bytes = 0;
	async function walk(folder: string): Promise<void> {
		for (const name of await readdir(folder)) {
			if (name.startsWith(".") || name.includes(":")) throw new Error("Invalid public Pocket asset");
			const path = join(folder, name),
				stat = await lstat(path);
			if (stat.isSymbolicLink()) throw new Error("Public Pocket asset link refused");
			if (stat.isDirectory()) {
				await walk(path);
				continue;
			}
			const type = types[name.split(".").at(-1)!];
			if (
				!stat.isFile() ||
				!type ||
				stat.size > 2 * 1024 * 1024 ||
				(bytes += stat.size) > 16 * 1024 * 1024 ||
				assets.size >= 128
			)
				throw new Error("Invalid bounded public Pocket assets");
			const key = "/" + relative(directory, path).replaceAll("\\", "/");
			assets.set(key === "/index.html" ? "/" : key, { type, body: await readFile(path) });
		}
	}
	await walk(directory);
	// Browser/client entry points are copied from built public exports; never source or native runtime modules.
	for (const [specifier, key] of [
		["@pakka/client/pocket", "/client/pocket.js"],
		["@pakka/protocol/pocket", "/protocol/pocket.js"],
		["@pakka/protocol", "/protocol/index.js"],
		["preact", "/vendor/preact.mjs"],
		["preact/hooks", "/vendor/hooks.mjs"],
		["htm", "/vendor/htm.mjs"],
		["marked", "/vendor/marked.mjs"],
		["dompurify", "/vendor/purify.mjs"],
	]) {
		assets.set(key!, {
			type: types.js!,
			body: await readFile(fileURLToPath(import.meta.resolve(specifier!))),
		});
	}
	return assets;
}

/** Trusted composition entry. initialOwner is delivered to the local caller only, never an unauthenticated HTTP response. */
export async function startPocket(options: PocketProductOptions) {
	const initial = options.initial ?? [],
		profiles = [...(options.profiles ?? ["default"])];
	if (
		!options.owner.trim() ||
		initial.length > 64 ||
		!profiles.length ||
		profiles.length > 64 ||
		new Set(profiles).size !== profiles.length ||
		profiles.some(
			(profile) => !["default", ...(options.runtime.profiles?.map((p) => p.id) ?? [])].includes(profile),
		) ||
		initial.some((row) => !profiles.includes(row.profile))
	)
		throw new Error("Invalid approved Pocket product configuration");
	const assets = await publicAssets();
	const runtime = await createRuntime(options.runtime);
	let http: Awaited<ReturnType<typeof createPocketHttp>> | undefined;
	try {
		const people = await createPocketPeople({ runtime, namespace: "pocket.people" }),
			workspace = createPocketWorkspace({
				runtime,
				people,
				catalog: { namespace: "pocket.workspace", maxDeliveries: 512, maxPending: 32 },
				profileCeiling: () => profiles,
			});
		const store = runtime.store({ namespace: "pocket.bootstrap", maxBytes: 65536 }),
			saved = await store.snapshot();
		const fingerprint = createHash("sha256")
			.update(JSON.stringify({ owner: options.owner, initial, profiles }))
			.digest("hex");
		let initialOwner: PocketSession | null = null;
		const ready = () => {
			if (runtime.view().phase !== "ready") throw new Error("Pocket runtime unavailable");
		};
		if (saved.version === 0) {
			if (options.runtime.reopenSessionFile)
				throw new Error("Reopened storage has no confirmed Pocket product identity");
			await store.compareAndSet(0, { schema: 1, phase: "initializing", fingerprint }, ready);
			initialOwner = await people.initializeOwner(options.owner);
			const actor = await people.authenticate(initialOwner.token),
				client = workspace.bind(actor),
				ids: string[] = [];
			for (let index = 0; index < initial.length; index++) {
				const ref = await client.create({ requestId: "initial." + index, ...initial[index]! });
				ids.push(ref.conversationId);
			}
			const current = await store.snapshot();
			await store.compareAndSet(
				current.version,
				{ schema: 1, phase: "ready", fingerprint, initial: ids },
				ready,
			);
		} else {
			const data: JsonObject = saved.data;
			if (
				Object.keys(data).sort().join(",") !== "fingerprint,initial,phase,schema" ||
				data.schema !== 1 ||
				data.phase !== "ready" ||
				data.fingerprint !== fingerprint ||
				!Array.isArray(data.initial) ||
				data.initial.length !== initial.length ||
				data.initial.some(
					(id) =>
						typeof id !== "string" || !runtime.view().conversations.some((ref) => ref.conversationId === id),
				)
			)
				throw new Error(
					"Pocket initialization unavailable or configuration conflict; explicit reconciliation required",
				);
		}
		http = await createPocketHttp({ ...options.transport, runtime, people, workspace, assets });
		let closed = false;
		return Object.freeze({
			runtime,
			people,
			workspace,
			http,
			initialOwner,
			close: async () => {
				if (closed) return;
				closed = true;
				try {
					await http!.close();
				} finally {
					await runtime.close();
				}
			},
		});
	} catch (error) {
		try {
			await http?.close();
		} finally {
			await runtime.close();
		}
		throw error;
	}
}
