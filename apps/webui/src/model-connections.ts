import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
	InMemoryCredentialStore,
	InMemoryModelsStore,
	getModelType,
	getSupportedThinkingLevels,
	isModelType,
} from "@earendil-works/pi-ai";
import type { Runtime, RuntimeRecord, JsonObject } from "@pakka/agent";
import type { PocketAuthority, PocketPeople } from "@pakka/server/pocket";
import {
	decodeModelConfigurationChange,
	decodeModelConfigurationReceipt,
	decodeWebUiCommand,
	decodeWebUiResult,
	type ModelConfigurationChange,
	type ModelConfigurationReceipt,
	type ModelConfigurationView,
	type ModelCatalogPage,
	type ModelCatalogQuery,
	type ModelCatalogItem,
} from "@pakka/protocol/webui";
import type { ProductModelSource } from "./product-models.ts";
import { assertPlainPath, privateDirectory, verifyPrivatePath, writePrivateText } from "./private-files.ts";
import {
	readModelFile,
	editModelFile,
	publicModelDocument,
	type ModelFileSnapshot,
} from "./model-configuration-file.ts";
import { WebUiServiceRefusal } from "./service-refusal.ts";

export interface ModelConnections {
	read(actor: PocketAuthority): Promise<ModelConfigurationView>;
	validate(actor: PocketAuthority, change: ModelConfigurationChange): Promise<boolean>;
	write(actor: PocketAuthority, change: ModelConfigurationChange): Promise<ModelConfigurationReceipt>;
	lookup(
		actor: PocketAuthority,
		original: ModelConfigurationChange,
	): Promise<ModelConfigurationReceipt | null>;
	reload(actor: PocketAuthority): Promise<"ready" | "unavailable">;
	catalog(actor: PocketAuthority, query: ModelCatalogQuery): Promise<ModelCatalogPage>;
	refreshCatalog(
		actor: PocketAuthority,
		input: { readonly allowNetwork: boolean; readonly provider?: string },
	): Promise<"ready" | "unavailable">;
	close(): Promise<void>;
}
interface Meta {
	readonly seal: string;
	readonly source: string;
	readonly pending: string | null;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const absent = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
function metadata(record: RuntimeRecord, source: string): Meta {
	const data = record.data;
	if (
		!data ||
		data.schema !== 1 ||
		data.source !== source ||
		typeof data.seal !== "string" ||
		!/^[a-f0-9]{64}$/.test(data.seal) ||
		(data.pending !== null &&
			(typeof data.pending !== "string" || !/^request\.[a-f0-9]{64}$/.test(data.pending))) ||
		Object.keys(data).sort().join(",") !== "pending,schema,seal,source"
	)
		throw new Error("Invalid model configuration coordinator");
	return { seal: data.seal, source, pending: data.pending };
}
const metaData = (meta: Meta): JsonObject => ({
	schema: 1,
	source: meta.source,
	seal: meta.seal,
	pending: meta.pending,
});
function version(record: RuntimeRecord, meta: Meta, file: ModelFileSnapshot): string {
	// The browser's opaque revision must not become a dictionary oracle for redacted credentials.
	return `${record.version}.${createHmac("sha256", meta.seal).update(file.digest).digest("hex")}`;
}
function operation(
	record: RuntimeRecord,
	actorId: string,
	input: ModelConfigurationChange,
): ModelConfigurationReceipt | null {
	if (record.version === 0 && record.data === null) return null;
	const data = record.data;
	if (
		!data ||
		data.schema !== 1 ||
		data.actorId !== actorId ||
		Object.keys(data).sort().join(",") !== "actorId,fingerprint,receipt,schema"
	)
		throw new Error("Invalid configuration operation record");
	if (data.fingerprint !== hash([input.expectedVersion, input.edits]))
		throw new WebUiServiceRefusal("CONFLICT");
	const receipt = decodeModelConfigurationReceipt(data.receipt);
	if (receipt.actorId !== actorId || receipt.requestId !== input.requestId)
		throw new Error("Configuration operation identity mismatch");
	return receipt;
}
function operationData(
	actorId: string,
	input: ModelConfigurationChange,
	receipt: ModelConfigurationReceipt,
): JsonObject {
	return {
		schema: 1,
		actorId,
		fingerprint: hash([input.expectedVersion, input.edits]),
		receipt: { ...receipt },
	};
}

/** Native configuration adapter. It neither owns a model registry nor accepts browser credential/callback changes. */
export async function createModelConnections({
	runtime,
	people,
	source,
}: {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly source: ProductModelSource;
}): Promise<ModelConnections> {
	const path = resolve(source.configurationPath),
		sourceId = hash(path);
	const staging = join(dirname(path), ".pakka-webui-model-edits");
	const records = runtime.records({ namespace: "webui.models." + sourceId.slice(0, 24) });
	const lifetime = new AbortController();
	let closed = false,
		pending: Promise<unknown> = Promise.resolve();
	const ready = () => {
		if (closed || runtime.view().phase !== "ready")
			throw new Error("Model configuration service unavailable");
	};
	const initial = await records.get("configuration", ready);
	if (initial.version === 0 && initial.data === null) {
		await records.commit(
			{
				requestId: "initialize",
				reads: [{ key: "configuration", version: 0 }],
				writes: [
					{
						key: "configuration",
						data: metaData({ source: sourceId, seal: randomBytes(32).toString("hex"), pending: null }),
					},
				],
				append: [],
			},
			ready,
		);
	}
	metadata(await records.get("configuration", ready), sourceId);
	let loadedDigest: string | null = null;
	try {
		loadedDigest = (await readModelFile(path)).digest;
	} catch {
		/* Invalid native files do not prevent the rest of the workbench from starting. */
	}
	let rows: readonly ModelCatalogItem[] = [],
		catalogStatus: "ready" | "unavailable" = "unavailable";
	function authority(actor: PocketAuthority, manage = false) {
		const person = people.current(actor);
		const check = () => {
			ready();
			people.current(actor);
			if (manage) {
				try {
					people.check(actor, "extensions.install");
				} catch {
					throw new WebUiServiceRefusal("FORBIDDEN");
				}
			}
		};
		check();
		return { id: person.id, check };
	}
	function serial<T>(work: () => Promise<T>): Promise<T> {
		const running = pending.then(work);
		pending = running.then(
			() => undefined,
			() => undefined,
		);
		return running;
	}
	const key = (actorId: string, requestId: string) => "request." + hash([actorId, requestId]);
	async function current(check: () => void) {
		const record = await records.get("configuration", check),
			meta = metadata(record, sourceId),
			file = await readModelFile(path);
		check();
		if ((await records.get("configuration", check)).version !== record.version)
			throw new WebUiServiceRefusal("CONFLICT");
		return { record, meta, file, version: version(record, meta, file) };
	}
	async function prepareFile(file: ModelFileSnapshot) {
		await mkdir(dirname(path), { recursive: true, mode: 0o700 });
		await assertPlainPath(dirname(path));
		await privateDirectory(staging);
		const temporary = join(staging, "candidate-" + randomUUID() + ".json");
		await writePrivateText(temporary, file.content);
		return temporary;
	}
	async function validateFile(temporary: string): Promise<boolean> {
		const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000)]);
		const candidate = await ModelRuntime.create({
			modelsPath: temporary,
			credentials: new InMemoryCredentialStore(),
			modelsStore: new InMemoryModelsStore(),
			allowModelNetwork: false,
			refreshOnCreate: false,
			signal,
		});
		return !signal.aborted && candidate.getError() === undefined;
	}
	async function removeTemporary(temporary: string) {
		try {
			await unlink(temporary);
		} catch (error) {
			if (!absent(error)) throw error;
		}
	}
	function nativeReady(owner: { id: string; check(): void }): boolean {
		return !source
			.bind(owner)
			.status()
			.issues.some((issue) => issue.source === "models");
	}
	function publishCatalog(owner: { id: string; check(): void }) {
		const providers = new Map(
			source
				.bind(owner)
				.auth.providers()
				.map((provider) => [provider.id, provider.configured]),
		);
		const next = source
			.models()
			.getAllModels()
			.map((model): ModelCatalogItem => {
				const parameters: Record<string, unknown> = { cost: model.cost };
				if (model.inputLimits) parameters.inputLimits = model.inputLimits;
				if (isModelType(model, "chat")) {
					parameters.contextWindow = model.contextWindow;
					parameters.maxTokens = model.maxTokens;
					parameters.reasoning = model.reasoning;
					for (const field of [
						"thinkingLevelMap",
						"samplingParams",
						"samplingParamsByThinkingLevel",
						"promptCache",
						"compat",
					] as const)
						if (model[field] !== undefined) parameters[field] = model[field];
				} else if (isModelType(model, "image")) parameters.output = [...model.output];
				else {
					parameters.contextWindow = model.contextWindow;
					if (model.compat) parameters.compat = model.compat;
				}
				return {
					provider: model.provider,
					id: model.id,
					name: model.name,
					type: getModelType(model),
					api: model.api,
					input: [...model.input],
					thinkingLevels: isModelType(model, "chat") ? getSupportedThinkingLevels(model) : [],
					authentication: !providers.has(model.provider)
						? "unknown"
						: providers.get(model.provider)
							? "configured"
							: "unconfigured",
					parameters: publicModelDocument(parameters).document,
				};
			})
			.sort((a, b) =>
				JSON.stringify([a.provider, a.type, a.id]).localeCompare(JSON.stringify([b.provider, b.type, b.id])),
			);
		owner.check();
		rows = next;
	}
	async function reloadNative(owner: { id: string; check(): void }): Promise<"ready" | "unavailable"> {
		owner.check();
		try {
			await source.bind(owner).refresh();
			owner.check();
			if (!nativeReady(owner)) {
				catalogStatus = "unavailable";
				return "unavailable";
			}
			loadedDigest = (await readModelFile(path)).digest;
			publishCatalog(owner);
			catalogStatus = "ready";
			return "ready";
		} catch {
			owner.check();
			catalogStatus = "unavailable";
			return "unavailable";
		}
	}
	return Object.freeze({
		read: async (actor: PocketAuthority): Promise<ModelConfigurationView> => {
			const owner = authority(actor, true),
				state = await current(owner.check);
			const visible = publicModelDocument(state.file.document);
			const result = decodeWebUiResult({
				kind: "model-configuration",
				configuration: {
					version: state.version,
					source: "models.json",
					document: visible.document,
					protectedPaths: visible.protectedPaths,
					load: loadedDigest === state.file.digest && nativeReady(owner) ? "ready" : "unavailable",
				},
			});
			if (result.kind !== "model-configuration") throw new Error("Invalid configuration result");
			owner.check();
			return result.configuration;
		},
		validate: async (actor: PocketAuthority, raw: ModelConfigurationChange) => {
			const input = decodeModelConfigurationChange(raw),
				owner = authority(actor, true),
				state = await current(owner.check);
			if (state.version !== input.expectedVersion) throw new WebUiServiceRefusal("CONFLICT");
			const candidate = editModelFile(state.file, input),
				temporary = await prepareFile(candidate);
			try {
				const valid = await validateFile(temporary);
				if ((await current(owner.check)).version !== state.version) throw new WebUiServiceRefusal("CONFLICT");
				return valid;
			} finally {
				await removeTemporary(temporary);
			}
		},
		lookup: async (actor: PocketAuthority, raw: ModelConfigurationChange) => {
			const input = decodeModelConfigurationChange(raw),
				owner = authority(actor, true);
			return operation(await records.get(key(owner.id, input.requestId), owner.check), owner.id, input);
		},
		write: (actor: PocketAuthority, raw: ModelConfigurationChange): Promise<ModelConfigurationReceipt> =>
			serial(async () => {
				const input = decodeModelConfigurationChange(raw),
					owner = authority(actor, true),
					operationKey = key(owner.id, input.requestId);
				const previousRecord = await records.get(operationKey, owner.check),
					previous = operation(previousRecord, owner.id, input);
				if (previous) return previous;
				const state = await current(owner.check);
				if (state.meta.pending) throw new WebUiServiceRefusal("UNKNOWN");
				if (state.version !== input.expectedVersion) throw new WebUiServiceRefusal("CONFLICT");
				const candidate = editModelFile(state.file, input),
					temporary = await prepareFile(candidate);
				const lockPath = join(staging, "writer.lock");
				let lock: Awaited<ReturnType<typeof open>> | undefined,
					prepared = false;
				try {
					if (!(await validateFile(temporary))) throw new WebUiServiceRefusal("INVALID_REQUEST");
					owner.check();
					try {
						lock = await open(lockPath, "wx", 0o600);
					} catch (error) {
						if (error instanceof Error && "code" in error && error.code === "EEXIST")
							throw new WebUiServiceRefusal("CONFLICT");
						throw error;
					}
					if ((await current(owner.check)).version !== state.version)
						throw new WebUiServiceRefusal("CONFLICT");
					const unknown = decodeModelConfigurationReceipt({
						requestId: input.requestId,
						actorId: owner.id,
						state: "unknown",
						version: input.expectedVersion,
						reload: "not-confirmed",
					});
					await records.commit(
						{
							requestId: "prepare." + hash([owner.id, input.requestId]),
							reads: [
								{ key: "configuration", version: state.record.version },
								{ key: operationKey, version: previousRecord.version },
							],
							writes: [
								{ key: "configuration", data: metaData({ ...state.meta, pending: operationKey }) },
								{ key: operationKey, data: operationData(owner.id, input, unknown) },
							],
							append: [],
						},
						owner.check,
					);
					prepared = true;
					// The lock coordinates this API's writers. External editors must not write concurrently.
					if ((await readModelFile(path)).digest !== state.file.digest)
						throw new Error("Native configuration changed during admission");
					owner.check();
					await rename(temporary, path);
					await verifyPrivatePath(path);
					if ((await readModelFile(path)).digest !== candidate.digest)
						throw new Error("Configuration publication unconfirmed");
					const reload = await reloadNative(owner);
					const record = await records.get("configuration", owner.check),
						meta = metadata(record, sourceId);
					const currentOperation = await records.get(operationKey, owner.check);
					if (meta.pending !== operationKey) throw new Error("Configuration admission changed");
					const receipt = decodeModelConfigurationReceipt({
						requestId: input.requestId,
						actorId: owner.id,
						state: "saved",
						version: version({ ...record, version: record.version + 1 }, meta, candidate),
						reload,
					});
					await records.commit(
						{
							requestId: "saved." + hash([owner.id, input.requestId]),
							reads: [
								{ key: "configuration", version: record.version },
								{ key: operationKey, version: currentOperation.version },
							],
							writes: [
								{ key: "configuration", data: metaData({ ...meta, pending: null }) },
								{ key: operationKey, data: operationData(owner.id, input, receipt) },
							],
							append: [],
						},
						owner.check,
					);
					owner.check();
					return receipt;
				} catch (error) {
					if (prepared) throw new WebUiServiceRefusal("UNKNOWN");
					throw error;
				} finally {
					await removeTemporary(temporary);
					if (lock) {
						const held = await lock.stat();
						await lock.close();
						const current = await lstat(lockPath);
						if (held.ino !== current.ino || held.dev !== current.dev)
							throw new Error("Model writer lock ownership changed");
						await unlink(lockPath);
					}
				}
			}),
		reload: (actor: PocketAuthority) => serial(() => reloadNative(authority(actor, true))),
		catalog: async (actor: PocketAuthority, query: ModelCatalogQuery): Promise<ModelCatalogPage> => {
			decodeWebUiCommand({ op: "model-catalog.read", query });
			const owner = authority(actor);
			if (nativeReady(owner) && catalogStatus !== "ready") {
				publishCatalog(owner);
				catalogStatus = "ready";
			}
			const revision = hash(rows);
			if (query.revision !== undefined && revision !== query.revision)
				throw new WebUiServiceRefusal("CONFLICT");
			const text = query.query?.trim().toLowerCase(),
				offset = query.offset ?? 0,
				limit = query.limit ?? 50;
			const matching = rows.filter(
				(model) =>
					(!query.type || model.type === query.type) &&
					(!query.provider || model.provider === query.provider) &&
					(!text || `${model.provider}/${model.id} ${model.name}`.toLowerCase().includes(text)),
			);
			const result = decodeWebUiResult({
				kind: "model-catalog",
				page: {
					revision,
					status: catalogStatus,
					total: matching.length,
					models: matching.slice(offset, offset + limit),
					nextOffset: offset + limit < matching.length ? offset + limit : null,
				},
			});
			if (result.kind !== "model-catalog") throw new Error("Invalid catalog result");
			owner.check();
			return result.page;
		},
		refreshCatalog: (
			actor: PocketAuthority,
			input: { readonly allowNetwork: boolean; readonly provider?: string },
		) =>
			serial(async () => {
				decodeWebUiCommand({ op: "model-catalog.refresh", ...input });
				const owner = authority(actor, true);
				if (input.provider && !source.models().getProvider(input.provider))
					throw new WebUiServiceRefusal("INVALID_REQUEST");
				const result = await source.models().refresh({
					allowNetwork: input.allowNetwork,
					force: input.allowNetwork,
					...(input.provider ? { providers: [input.provider] } : {}),
					signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000)]),
				});
				owner.check();
				catalogStatus = result.aborted || result.errors.size ? "unavailable" : "ready";
				if (catalogStatus === "ready") publishCatalog(owner);
				return catalogStatus;
			}),
		close: async () => {
			if (closed) return;
			closed = true;
			lifetime.abort();
			await pending;
		},
	});
}
