import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
	createModels,
	getSupportedThinkingLevels,
	type Models,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ModelDTO } from "@pakka/agent";
import {
	createProductAuth,
	type ProductAuthControl,
	type ProductModelAuthority,
} from "./product-model-auth.ts";

export interface ProductModelDefaults {
	readonly model?: string;
	readonly thinkingLevel?: ModelThinkingLevel;
}
export interface ProductModelStatus {
	readonly sources: {
		readonly agentDir: string;
		readonly models: string;
		readonly auth: string;
		readonly settings: string;
	};
	readonly defaults: ProductModelDefaults;
	readonly issues: readonly { readonly source: "models" | "settings"; readonly code: "unavailable" }[];
}
export interface ProductModelQuery {
	readonly provider?: string;
	readonly query?: string;
	readonly availableOnly?: boolean;
	readonly offset?: number;
	readonly limit?: number;
	readonly revision?: string;
}
export interface ProductModelPage {
	readonly revision: string;
	readonly models: readonly ModelDTO[];
	readonly total: number;
	readonly nextOffset?: number;
}
export interface ProductModelControl {
	readonly auth: ProductAuthControl;
	status(): ProductModelStatus;
	catalog(query: ProductModelQuery): ProductModelPage;
	refresh(): Promise<ProductModelStatus>;
}
export interface ProductModelSource {
	/** Trusted bootstrap getter, never included in an operational DTO. */
	models(): Models;
	defaults(): ProductModelDefaults;
	bind(authority: ProductModelAuthority): ProductModelControl;
	close(): Promise<void>;
}

function frozen<T>(value: T): T {
	const result = structuredClone(value);
	function freeze(item: unknown): void {
		if (!item || typeof item !== "object") return;
		for (const child of Object.values(item)) freeze(child);
		Object.freeze(item);
	}
	freeze(result);
	return result;
}

/** Configuration loading is trusted bootstrap work; native execution/storage stay in the agent adapter. */
export async function openProductModels(options: {
	agentDir: string;
	cwd: string;
}): Promise<ProductModelSource> {
	const agentDir = resolve(options.agentDir);
	const sources = frozen({
		agentDir,
		models: join(agentDir, "models.json"),
		auth: join(agentDir, "auth.json"),
		settings: join(agentDir, "settings.json"),
	});
	const settings = SettingsManager.create(resolve(options.cwd), agentDir, { projectTrusted: false });
	const empty = createModels();
	const lifetime = new AbortController();
	let runtime: ModelRuntime | undefined;
	let modelsUnavailable = false;
	let settingsUnavailable = settings.drainErrors().length > 0;
	let rows: readonly ModelDTO[] = [];
	let revision = randomUUID();
	let closed = false;
	let pending = Promise.resolve();
	function ready() {
		if (closed) throw new Error("Model configuration is closed");
	}
	function defaults(): ProductModelDefaults {
		ready();
		const value = settings.getGlobalSettings();
		return frozen({
			...(value.defaultProvider && value.defaultModel
				? { model: `${encodeURIComponent(value.defaultProvider)}/${value.defaultModel}` }
				: {}),
			...(value.defaultThinkingLevel ? { thinkingLevel: value.defaultThinkingLevel } : {}),
		});
	}
	function publish() {
		const available = new Set(
			runtime?.getAvailableSnapshot().map((model) => `${encodeURIComponent(model.provider)}/${model.id}`),
		);
		rows = frozen(
			(runtime?.getModels() ?? [])
				.map((model): ModelDTO => {
					const key = `${encodeURIComponent(model.provider)}/${model.id}`;
					return {
						key,
						provider: model.provider,
						model: model.id,
						name: model.name,
						reasoning: model.reasoning,
						thinkingLevels: getSupportedThinkingLevels(model),
						input: [...model.input],
						contextWindow: model.contextWindow,
						maxOutputTokens: model.maxTokens,
						cost: {
							input: model.cost.input,
							output: model.cost.output,
							cacheRead: model.cost.cacheRead,
							cacheWrite: model.cost.cacheWrite,
						},
						available: available.has(key),
					};
				})
				.sort((a, b) => a.key.localeCompare(b.key)),
		);
		revision = randomUUID();
	}
	async function load() {
		const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000)]);
		try {
			if (runtime) {
				const result = await runtime.refresh({ allowNetwork: false, signal });
				modelsUnavailable = result.aborted || result.errors.size > 0 || !!runtime.getError();
			} else {
				runtime = await ModelRuntime.create({
					authPath: sources.auth,
					modelsPath: sources.models,
					allowModelNetwork: false,
					signal,
				});
				modelsUnavailable = signal.aborted || !!runtime.getError();
			}
		} catch {
			// Upstream errors can contain configuration fragments or credential objects.
			modelsUnavailable = true;
		}
		publish();
	}
	function status(): ProductModelStatus {
		ready();
		return frozen({
			sources,
			defaults: defaults(),
			issues: [
				...(modelsUnavailable ? [{ source: "models" as const, code: "unavailable" as const }] : []),
				...(settingsUnavailable ? [{ source: "settings" as const, code: "unavailable" as const }] : []),
			],
		});
	}
	function catalog(query: ProductModelQuery): ProductModelPage {
		ready();
		const offset = query.offset ?? 0,
			limit = query.limit ?? 50;
		if (
			!Number.isSafeInteger(offset) ||
			offset < 0 ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > 100 ||
			(query.query !== undefined && (typeof query.query !== "string" || query.query.length > 256)) ||
			(query.provider !== undefined && (typeof query.provider !== "string" || query.provider.length > 256))
		)
			throw new Error("Invalid model catalogue query");
		if (query.revision !== undefined && query.revision !== revision)
			throw new Error("Model catalogue changed; restart the search");
		const search = query.query?.trim().toLowerCase();
		const matches = rows.filter(
			(model) =>
				(!query.provider || model.provider === query.provider) &&
				(!query.availableOnly || model.available) &&
				(!search || `${model.key} ${model.name}`.toLowerCase().includes(search)),
		);
		return frozen({
			revision,
			total: matches.length,
			models: matches.slice(offset, offset + limit),
			...(offset + limit < matches.length ? { nextOffset: offset + limit } : {}),
		});
	}
	const auth = createProductAuth({
		runtime: () => runtime,
		signal: lifetime.signal,
		changed: publish,
		getDeviceId: () => settings.getOrCreateDeviceId(),
	});
	await load();
	return Object.freeze({
		models: () => {
			ready();
			return runtime ?? empty;
		},
		defaults,
		bind: (authority: ProductModelAuthority): ProductModelControl => {
			const check = () => {
				ready();
				authority.check();
			};
			check();
			return Object.freeze({
				auth: auth.bind(authority),
				status: () => {
					check();
					return status();
				},
				catalog: (query: ProductModelQuery) => {
					check();
					return catalog(query);
				},
				refresh: async () => {
					check();
					const update = pending.then(async () => {
						check();
						await settings.reload();
						settingsUnavailable = settings.drainErrors().length > 0;
						check();
						await load();
						check();
					});
					pending = update.catch(() => {});
					await update;
					return status();
				},
			});
		},
		close: async () => {
			if (closed) return;
			closed = true;
			lifetime.abort();
			await auth.close();
			await pending;
			await settings.flush();
		},
	});
}
