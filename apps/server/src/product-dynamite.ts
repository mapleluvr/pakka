import { createHash } from "node:crypto";
import type { HostOptions, Runtime, StrategyBinding, ToolInvocationScope } from "@pakka/agent";
import type { Mas } from "@pakka/mas";
import type { BootstrapConfig } from "./bootstrap.ts";

type NativeTool = NonNullable<HostOptions["tools"]>[number];
export interface ProductDynamiteOptions {
	readonly autoCompress?: boolean;
	readonly threshold?:
		| { readonly mode: "tokens"; readonly tokens: number }
		| { readonly mode: "percentage"; readonly percentage: number };
	readonly protectedTail?: { readonly steps: number; readonly tokens: number };
	readonly queueThresholdTokens?: number;
	readonly compressionWindowTokens?: number;
	readonly compressionMaxWindowTokens?: number;
	readonly compressionMaxOutputTokens?: number;
	readonly compressionContextSteps?: number;
	readonly compressionAttemptsPerModel?: number;
	readonly compressionModel?: string;
}
export interface ProductDynamiteConfig {
	readonly members: readonly { readonly key: string; readonly config?: ProductDynamiteOptions }[];
}
interface Service {
	dispose(): void;
	waitForCompression(): Promise<void>;
}
interface Peer {
	readonly DEFAULT_STRATEGY_ID: string;
	createDynamite(binding: StrategyBinding, options: { readonly config: ProductDynamiteOptions }): Service;
	createDynamiteTool(resolve: () => Service | undefined): NativeTool;
}
const record = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const natural = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function validPeer(value: unknown): value is Peer {
	return (
		record(value) &&
		typeof value.DEFAULT_STRATEGY_ID === "string" &&
		typeof value.createDynamite === "function" &&
		typeof value.createDynamiteTool === "function"
	);
}
export function validProductDynamite(
	value: unknown,
	roots: BootstrapConfig["members"],
): value is ProductDynamiteConfig {
	if (
		!record(value) ||
		Object.keys(value).length !== 1 ||
		!Array.isArray(value.members) ||
		!value.members.length ||
		value.members.length > 128
	)
		return false;
	const seen = new Set<unknown>();
	return value.members.every((member) => {
		if (
			!record(member) ||
			Object.keys(member).some((key) => !["key", "config"].includes(key)) ||
			typeof member.key !== "string" ||
			seen.has(member.key) ||
			roots.filter((root) => root.key === member.key).length !== 1
		)
			return false;
		seen.add(member.key);
		if (member.config === undefined) return true;
		if (!record(member.config)) return false;
		const options = member.config;
		const numbers = [
			"queueThresholdTokens",
			"compressionWindowTokens",
			"compressionMaxWindowTokens",
			"compressionAttemptsPerModel",
		];
		const known = [
			...numbers,
			"autoCompress",
			"threshold",
			"protectedTail",
			"compressionMaxOutputTokens",
			"compressionContextSteps",
			"compressionModel",
		];
		return (
			Object.keys(options).every((key) => known.includes(key)) &&
			(options.autoCompress === undefined || typeof options.autoCompress === "boolean") &&
			(options.threshold === undefined ||
				(record(options.threshold) &&
					Object.keys(options.threshold).length === 2 &&
					((options.threshold.mode === "tokens" && positive(options.threshold.tokens)) ||
						(options.threshold.mode === "percentage" &&
							typeof options.threshold.percentage === "number" &&
							Number.isFinite(options.threshold.percentage) &&
							options.threshold.percentage > 0 &&
							options.threshold.percentage <= 80)))) &&
			numbers.every((key) => options[key] === undefined || positive(options[key])) &&
			(options.compressionMaxOutputTokens === undefined || natural(options.compressionMaxOutputTokens)) &&
			(options.compressionContextSteps === undefined || natural(options.compressionContextSteps)) &&
			(options.compressionModel === undefined ||
				(typeof options.compressionModel === "string" &&
					/^[a-zA-Z0-9._:-]{1,128}$/.test(options.compressionModel))) &&
			(options.protectedTail === undefined ||
				(record(options.protectedTail) &&
					Object.keys(options.protectedTail).length === 2 &&
					positive(options.protectedTail.steps) &&
					options.protectedTail.steps >= 2 &&
					positive(options.protectedTail.tokens)))
		);
	});
}
/** Constant optional peer only. No import when disabled, no model/RPC module path or package discovery. */
export async function productDynamite(config: BootstrapConfig) {
	if (!config.dynamite) return undefined;
	const specifier = "@pakka/dynamite";
	const loaded: unknown = await import(specifier);
	if (!validPeer(loaded)) throw new Error("Optional Dynamite peer contract unavailable");
	// Host-installed exact peer factories; authority is still the real controlled binding/scope.
	const peer = loaded;
	const selected = config.dynamite.members;
	const profiles = new Set(
		selected.map((selection) => {
			const root = config.members.find((candidate) => candidate.key === selection.key);
			if (!root) throw new Error("Selected product Dynamite root missing");
			return root.profile ?? "default";
		}),
	);
	const rows = new Map<
		string,
		{
			readonly service: Service;
			readonly tool: NativeTool;
			readonly ref: import("@pakka/agent").ConversationRef;
			revoke(): void;
		}
	>();
	const draining = new Set<Service>();
	let runtime: Runtime | undefined,
		mas: Mas | undefined,
		closed = false;
	const declaration = peer.createDynamiteTool(() => undefined);
	const tool: NativeTool = Object.freeze({
		name: declaration.name,
		description: declaration.description,
		parameters: declaration.parameters,
		async execute(
			args: Record<string, unknown>,
			signal: AbortSignal | undefined,
			scope: ToolInvocationScope,
		) {
			if (closed || !runtime || !mas) throw new Error("Product Dynamite is not active");
			const members = (await mas.view()).members,
				catalog = runtime.catalog(config.mas);
			for (const [key, row] of rows) {
				if (
					!members.some(
						(member) =>
							member.key === key &&
							member.phase === "active" &&
							member.ref.incarnation === row.ref.incarnation,
					)
				)
					continue;
				try {
					catalog.checkInvocation(row.ref, scope);
				} catch {
					continue;
				}
				return row.tool.execute(args, signal, scope);
			}
			throw new Error("No approved product Dynamite invocation");
		},
	});
	return Object.freeze({
		tools(profile: string): readonly NativeTool[] {
			return profiles.has(profile) ? [tool] : [];
		},
		async install(ownedRuntime: Runtime, ownedMas: Mas) {
			if (runtime || closed) throw new Error("Product Dynamite already initialized");
			runtime = ownedRuntime;
			mas = ownedMas;
			const view = await mas.view();
			for (const selection of selected) {
				const member = view.members.find((candidate) => candidate.key === selection.key);
				if (!member || member.lifetime !== "persistent" || member.phase !== "active")
					throw new Error("Selected product Dynamite root unavailable");
				const host = await runtime.conversation(member.ref);
				const principal =
					"product-dynamite-" +
					createHash("sha256")
						.update(JSON.stringify([config.mas.namespace, member.ref.sessionId, member.ref.conversationId]))
						.digest("hex")
						.slice(0, 40);
				const owner = host.connect(principal, [
					"real_context.write",
					"context_artifacts.write",
					"model.infer",
				]);
				owner.activateStrategy({
					id: peer.DEFAULT_STRATEGY_ID,
					hooks: ["real_context.write", "context_artifacts.write"],
				});
				const service = peer.createDynamite(owner.bindStrategy(peer.DEFAULT_STRATEGY_ID), {
					config: { autoCompress: false, ...selection.config },
				});
				rows.set(selection.key, {
					service,
					tool: peer.createDynamiteTool(() => service),
					ref: member.ref,
					revoke: () => {
						try {
							owner.deactivateStrategy(peer.DEFAULT_STRATEGY_ID);
						} finally {
							service.dispose();
						}
					},
				});
			}
		},
		/** Trusted closure only; never exposed as RPC/model configuration or fresh grant. */
		revoke(key: string): void {
			if (closed) throw new Error("Product Dynamite closed");
			const row = rows.get(key);
			if (!row) throw new Error("No selected active product Dynamite lease");
			draining.add(row.service);
			row.revoke();
			rows.delete(key);
		},
		async close(): Promise<void> {
			if (closed) return;
			closed = true;
			const failures: unknown[] = [];
			for (const row of rows.values()) {
				draining.add(row.service);
				try {
					row.revoke();
				} catch (error) {
					failures.push(error);
				}
			}
			const settled = await Promise.allSettled([...draining].map((service) => service.waitForCompression()));
			for (const result of settled) if (result.status === "rejected") failures.push(result.reason);
			rows.clear();
			draining.clear();
			if (failures.length) throw new AggregateError(failures, "Product Dynamite cleanup unconfirmed");
		},
	});
}
