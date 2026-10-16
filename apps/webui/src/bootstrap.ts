import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, type RuntimeOptions, type JsonObject } from "@pakka/agent";
import {
	createPocketPeople,
	createPocketWorkspace,
	createPocketCollaboration,
	createPocketCredentials,
	createPocketNotifications,
	type PocketNotifications,
	type PocketNotificationsOptions,
	type PocketCredentials,
	type PocketSession,
} from "@pakka/server/pocket";
import { createPocketHttp, type PocketHttpOptions } from "./http.ts";
import { createExtensionHost, type ExtensionSource } from "./extension-host.ts";
import type { ExtensionService, PocketServiceContext } from "./backend.ts";
import { observeNotifications } from "./notification-monitor.ts";
export type { PocketServiceContext } from "./backend.ts";
export interface PocketProductOptions {
	readonly runtime: RuntimeOptions;
	readonly owner: string;
	readonly initial?: readonly { readonly name: string; readonly profile: string }[];
	readonly profiles?: readonly string[];
	readonly extensions?: readonly ExtensionSource[];
	/** Host-selected push destinations and TLS authority; browser device registration cannot extend them. */
	readonly notifications?: Omit<PocketNotificationsOptions, "runtime" | "people" | "namespace">;
	/** Trusted composition only. Never an action/RPC callback; handlers receive bound services instead. */
	readonly extensionServices?:
		| Readonly<Record<string, ExtensionService>>
		| ((
				context: PocketServiceContext,
		  ) => Readonly<Record<string, ExtensionService>> | Promise<Readonly<Record<string, ExtensionService>>>);
	readonly transport?: Omit<
		PocketHttpOptions,
		| "runtime"
		| "people"
		| "workspace"
		| "collaboration"
		| "credentials"
		| "notifications"
		| "assets"
		| "extensions"
	>;
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
		["@pakka/webui/extension", "/sdk/extension.js"],
		["@pakka/webui/client", "/sdk/extension-client.js"],
		["@pakka/webui/components", "/sdk/components.js"],
		["@pakka/webui/ui", "/sdk/ui.js"],
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
	assets.set("/sdk/extension-rpc.js", {
		type: types.js!,
		body: await readFile(
			fileURLToPath(new URL("./extension-rpc.js", import.meta.resolve("@pakka/webui/client"))),
		),
	});
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
	const bootstrapCredential = options.runtime.resolveApiKey ?? (() => options.runtime.apiKey);
	let credentials: PocketCredentials | undefined;
	const runtime = await createRuntime({
		...options.runtime,
		resolveApiKey: async () => {
			if (!credentials) throw new Error("Private configuration is not yet bound");
			return credentials.resolve();
		},
	});
	let http: Awaited<ReturnType<typeof createPocketHttp>> | undefined,
		notifications: PocketNotifications | undefined,
		monitor: { close(): Promise<void> } | undefined,
		services: Readonly<Record<string, ExtensionService>> | undefined,
		servicesDisposed = false;
	async function releaseServices() {
		if (servicesDisposed) return;
		servicesDisposed = true;
		let failed = false;
		try {
			await monitor?.close();
		} catch {
			failed = true;
		}
		try {
			await notifications?.dispose();
		} catch {
			failed = true;
		}
		for (const service of [...new Set(Object.values(services ?? {}))].reverse()) {
			try {
				await service.dispose?.();
			} catch {
				failed = true;
			}
		}
		if (failed) throw Error("Pocket service shutdown unconfirmed");
	}
	try {
		const people = await createPocketPeople({ runtime, namespace: "pocket.people" }),
			collaboration = await createPocketCollaboration({ runtime, people, namespace: "pocket.collaboration" }),
			workspace = createPocketWorkspace({
				runtime,
				people,
				catalog: { namespace: "pocket.workspace", maxDeliveries: 512, maxPending: 32 },
				profileCeiling: () => profiles,
				beforeInput: (actor, ref) => collaboration.checkInput(actor, ref),
			});
		credentials = await createPocketCredentials({
			runtime,
			people,
			namespace: "pocket.credentials",
			bootstrap: bootstrapCredential,
		});
		const store = runtime.store({ namespace: "pocket.bootstrap", maxBytes: 65536 }),
			saved = await store.snapshot();
		const fingerprint = createHash("sha256")
			.update(JSON.stringify({ owner: options.owner, initial, profiles }))
			.digest("hex");
		let initialOwner: PocketSession | null = null;
		let ownerId: string;
		const ready = () => {
			if (runtime.view().phase !== "ready") throw new Error("Pocket runtime unavailable");
		};
		if (saved.version === 0) {
			if (options.runtime.reopenSessionFile)
				throw new Error("Reopened storage has no confirmed Pocket product identity");
			await store.compareAndSet(0, { schema: 1, phase: "initializing", fingerprint }, ready);
			initialOwner = await people.initializeOwner(options.owner);
			ownerId = initialOwner.person.id;
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
				{ schema: 2, phase: "ready", fingerprint, initial: ids, ownerId },
				ready,
			);
		} else {
			const data: JsonObject = saved.data;
			if (
				Object.keys(data).sort().join(",") !== "fingerprint,initial,ownerId,phase,schema" ||
				data.schema !== 2 ||
				typeof data.ownerId !== "string" ||
				!/^[a-zA-Z0-9][-a-zA-Z0-9._:]{0,127}$/.test(data.ownerId) ||
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
			ownerId = data.ownerId;
		}
		notifications = await createPocketNotifications({
			endpointOrigins: [
				"https://fcm.googleapis.com",
				"https://updates.push.services.mozilla.com",
				"https://web.push.apple.com",
			],
			...options.notifications,
			runtime,
			people,
			namespace: "pocket.notifications",
		});
		monitor = await observeNotifications(runtime, notifications);
		services =
			typeof options.extensionServices === "function"
				? await options.extensionServices(
						Object.freeze({ runtime, people, workspace, notifications, ownerId }),
					)
				: options.extensionServices;
		ready();
		const extensions = await createExtensionHost({
			runtime,
			people,
			workspace,
			sources: options.extensions ?? [],
			services,
		});
		http = await createPocketHttp({
			...options.transport,
			runtime,
			people,
			workspace,
			collaboration,
			credentials,
			notifications,
			extensions,
			assets,
		});
		let closed = false;
		return Object.freeze({
			runtime,
			people,
			workspace,
			collaboration,
			extensions,
			http,
			initialOwner,
			close: async () => {
				if (closed) return;
				closed = true;
				try {
					await http!.close();
				} finally {
					try {
						await releaseServices();
					} finally {
						await runtime.close();
					}
				}
			},
		});
	} catch (error) {
		try {
			await http?.close();
		} finally {
			try {
				await releaseServices();
			} finally {
				await runtime.close();
			}
		}
		throw error;
	}
}
