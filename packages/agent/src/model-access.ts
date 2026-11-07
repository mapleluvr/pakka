import {
	createModels,
	createProvider,
	getSupportedThinkingLevels,
	type Api,
	type Model,
	type Models,
} from "@earendil-works/pi-ai";
import * as completions from "@earendil-works/pi-ai/api/openai-completions";
import { copy, hash } from "./artifact-journal.ts";
import type { HostOptions, ModelDTO } from "./types.ts";

/** Native provider identity, not an alias bound to an Agent profile. */
export function modelKey(model: { provider: string; id: string }): string {
	return `${encodeURIComponent(model.provider)}/${model.id}`;
}

export function modelReference(
	options: HostOptions,
	selection = options.model,
): { provider: string; modelId: string } | undefined {
	if (options.models) {
		if (!selection) return undefined;
		const split = selection.indexOf("/");
		if (split < 1 || split === selection.length - 1)
			throw new Error("Use a native provider/model identifier");
		return { provider: decodeURIComponent(selection.slice(0, split)), modelId: selection.slice(split + 1) };
	}
	return { provider: "pakka-provider-" + hash(options.endpoint).slice(0, 12), modelId: selection };
}

export function primaryModels(options: HostOptions, legacy: Models): Models {
	return typeof options.models === "function" ? options.models() : (options.models ?? legacy);
}

export function modelDTO(model: Model<Api>, key: string, available: boolean): ModelDTO {
	return copy({
		key,
		model: model.id,
		provider: model.provider,
		name: model.name,
		reasoning: model.reasoning,
		thinkingLevels: getSupportedThinkingLevels(model),
		input: [...model.input],
		cost: model.cost,
		contextWindow: model.contextWindow,
		maxOutputTokens: model.maxTokens,
		available,
	});
}

/** Compatibility only. The product passes native Models instead of inventing provider metadata. */
export function legacyModels(options: HostOptions, profiles: ReadonlyMap<string, HostOptions>) {
	const models = createModels();
	if (options.models) return models;
	const endpoint = options.endpoint;
	if (!endpoint || !options.model || (!options.apiKey && !options.resolveApiKey))
		throw new Error("Supply native Models or explicit legacy endpoint/model/credential options");
	const provider = "pakka-provider-" + hash(endpoint).slice(0, 12);
	models.setProvider(
		createProvider({
			id: provider,
			name: "pakka-main",
			baseUrl: endpoint,
			auth: {
				apiKey: {
					name: "Main API Key",
					resolve: async () => {
						try {
							const apiKey = options.resolveApiKey ? await options.resolveApiKey() : options.apiKey;
							if (
								typeof apiKey !== "string" ||
								!apiKey ||
								apiKey.length > 4096 ||
								/[\x00-\x1f\x7f]/.test(apiKey)
							)
								throw new Error("Unavailable credential");
							return { auth: { apiKey, baseUrl: endpoint } };
						} catch {
							throw new Error("Configured provider credential unavailable");
						}
					},
				},
			},
			api: { "openai-completions": completions },
			models: [...new Set([...profiles.values()].map((profile) => profile.model))].map((id) => ({
				id,
				name: id,
				provider,
				api: "openai-completions",
				baseUrl: endpoint,
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 4096,
				compat: { maxTokensField: "max_tokens", supportsMidConvoSystemMessages: true },
			})),
		}),
	);
	return models;
}
