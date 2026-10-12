import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { mkdir, writeFile, open, readFile, unlink } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { JsonValue as ChordJsonValue } from "@earendil-works/chord";
import {
	Harness,
	createRegistry,
	defineTool,
	defineExtension,
	section,
	hook,
	GenerationTask,
	CompactionEntry,
	defineDoc,
	configure,
	ProviderDoc,
	StorageRejected,
	ROOT_CONVERSATION_ID,
	type Tx,
	type Registry,
	type ConversationId,
	watchEvents,
	type Conversation,
	type Submission,
	type SubmissionId,
	type Cursor,
	type EntryRecord,
	type EntryDraft,
	type EntryId,
	type AgentEvent,
	type AgentEventStream,
} from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import {
	createModels,
	createProvider,
	type Models,
	type Model,
	type Api,
	type Usage,
	type Message,
	type AssistantMessage,
	type TSchema,
} from "@earendil-works/pi-ai";
import * as oac from "@earendil-works/pi-ai/api/openai-completions";
import { copy, hash } from "./artifact-journal.ts";
import {
	inspectLegacyJournals,
	legacyPrimaryReservations,
	migratedNamespace,
	verifyMigration,
	textHash,
	type JournalMapping,
} from "./journal-migration.ts";
import type {
	HostOptions,
	Proposal,
	ContextFrame,
	MessageDTO,
	ModelDTO,
	UsageDTO,
	InferenceRequest,
	InferenceResult,
	ToolInvocationScope,
	ConversationRef,
	ConversationSpec,
	RuntimeOptions,
	RuntimeView,
	ConversationProfile,
} from "./types.ts";

export type AdapterFrame = Pick<
	ContextFrame,
	| "sessionId"
	| "durableSessionId"
	| "conversationId"
	| "providerSessionId"
	| "cwd"
	| "leafId"
	| "entries"
	| "activeEntryIds"
	| "projection"
	| "model"
	| "usage"
>;

export interface RunScopeToken {}

export interface AdapterControl {
	project(
		signal?: AbortSignal,
	): Promise<{ messages: readonly MessageDTO[]; check(): void } | { block: string; check(): void }>;
	runScope(): RunScopeToken;
	invoke<T>(run: RunScopeToken, callback: (scope: ToolInvocationScope) => Promise<T>): Promise<T>;
}

export type Notice =
	| { type: "changed" }
	| { type: "consumed"; id: string }
	| { type: "committed"; id: string; entryId: string }
	| { type: "blocked"; id: string; reason: string }
	| { type: "unknown"; id: string; reason: string }
	| { type: "released"; id: string; reason: string }
	| { type: "failed"; reason: string; sessionId?: string };

function clean<T>(value: unknown): T {
	try {
		return structuredClone(value) as T;
	} catch {
		try {
			return JSON.parse(JSON.stringify(value)) as T;
		} catch {
			return value as T;
		}
	}
}

function usageDTO(usage?: Usage): UsageDTO {
	return {
		input: usage?.input ?? 0,
		output: usage?.output ?? 0,
		cacheRead: usage?.cacheRead ?? 0,
		cacheWrite: usage?.cacheWrite ?? 0,
		totalTokens: usage?.totalTokens ?? 0,
		cost: usage?.cost?.total ? usage.cost.total : null,
	};
}

export function messageText(message: unknown): string {
	const m = message as { content?: unknown; summary?: string };
	if (m.summary) return m.summary;
	if (typeof m.content === "string") return m.content;
	return Array.isArray(m.content)
		? m.content.map((b) => (b as { text?: string })?.text ?? "").join("\n")
		: "";
}

interface ProvenanceData {
	sessionId: string;
	cwd: string;
}

type MigrationRecord = {
	id: string;
	schemaVersion: 1;
	sessionId: string;
	conversationId: string;
	sourceLength: number;
	sourceSha256: string;
	primaryAttempts: number;
	auxiliaryAttempts: number;
	journals: JournalMapping[];
};
type RuntimeRecord = {
	sessionId: string;
	limits: { maxConversations: number; maxPrimaryAttempts: number; maxAuxiliaryAttempts: number };
	conversationCount: number;
	budget: { primaryAttempts: number; auxiliaryAttempts: number };
	strategyAttempts: Record<string, number>;
	journalMigration?: MigrationRecord;
	profiles: Record<string, string>;
	resources: Record<
		string,
		{ key: string; sessionId: string; conversationId: string; incarnation: string; profile: string }
	>;
};
const RuntimeDoc = defineDoc<RuntimeRecord>({
	kind: "pakka.runtime",
	version: 2,
	scope: "session",
	migrate: (value, fromVersion) => {
		if (fromVersion !== 1 || !value.budget || typeof value.budget !== "object" || Array.isArray(value.budget))
			throw new Error("Unsupported runtime schema");
		if (!value.strategyAttempts && value.budget.auxiliaryAttempts !== 0)
			throw new Error("Legacy managed strategy spending unknown; migration refused");
		return { ...value, strategyAttempts: value.strategyAttempts ?? {} } as RuntimeRecord;
	},
	initial: () => ({
		sessionId: "",
		limits: { maxConversations: 0, maxPrimaryAttempts: 0, maxAuxiliaryAttempts: 0 },
		conversationCount: 0,
		budget: { primaryAttempts: 0, auxiliaryAttempts: 0 },
		strategyAttempts: {},
		profiles: {},
		resources: {},
	}),
});
interface ManagedState {
	profiles: Map<string, HostOptions>;
	profileHashes: Record<string, string>;
	state: Readonly<RuntimeRecord>;
	closed: boolean;
	failure?: string;
	unsubscribe?: () => void;
}
/** Internal pure-command seam. Never exports a Harness, Session, registry or Tx. */
export interface ManagedAdapterPort {
	view(): RuntimeView;
	profileOptions(id: string): HostOptions;
	validateReference(ref: ConversationRef): void;
	createConversation(spec: ConversationSpec): Promise<ConversationRef>;
	attach(
		ref: ConversationRef,
		notify: (notice: Notice) => void,
		control: AdapterControl,
	): Promise<DurableAdapter>;
	waitForIdle(): Promise<void>;
	close(): Promise<void>;
}
function profileHash(options: HostOptions): string {
	return hash({
		endpoint: options.endpoint,
		model: options.model,
		cwd: resolve(options.cwd),
		systemPrompt: options.systemPrompt ?? "",
		tools: (options.tools ?? []).map(({ name, description, parameters }) => ({
			name,
			description,
			parameters,
		})),
		inference: {
			models: (options.inference?.models ?? []).map(({ apiKey: _key, headers: _headers, ...model }) => model),
			policies: options.inference?.policies ?? [],
		},
	});
}
function profileOptions(options: HostOptions, profile?: ConversationProfile): HostOptions {
	return Object.freeze({
		...options,
		systemPrompt: profile?.systemPrompt ?? options.systemPrompt,
		tools: (profile?.tools ?? options.tools)?.map((tool) =>
			Object.freeze({ ...tool, parameters: copy(tool.parameters) }),
		),
	});
}
async function claimWriter(storageDir: string): Promise<() => Promise<void>> {
	const path = join(storageDir, "pakka-writer.json"),
		nonce = randomUUID();
	let descriptor;
	try {
		descriptor = await open(path, "wx");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new Error("Pakka storage writer is locked; no implicit stale-claim recovery");
		throw error;
	}
	try {
		await descriptor.writeFile(JSON.stringify({ schema: "pakka.writer.v1", pid: process.pid, nonce }) + "\n");
		await descriptor.sync();
	} finally {
		await descriptor.close();
	}
	let released = false;
	return async () => {
		if (released) return;
		let current: { nonce?: string } | undefined;
		try {
			current = JSON.parse(await readFile(path, "utf8")) as { nonce?: string };
		} catch (error) {
			throw new Error("Pakka writer claim is unknown; release refused", { cause: error });
		}
		if (current?.nonce !== nonce) throw new Error("Pakka writer claim changed; release refused");
		await unlink(path);
		released = true;
	};
}
class MutationDenied extends Error {}
function conversationId(value: string): ConversationId {
	if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
		throw new Error("Invalid Conversation identity");
	return Number(value) as ConversationId;
}

export class DurableAdapter {
	#harness: Harness;
	#conversation: Conversation;
	#sessionId: string;
	#sessionFile: string;
	#notify: (notice: Notice) => void;
	#control: AdapterControl;
	#options: HostOptions;
	#rawModels: Models;
	#stream: AgentEventStream | undefined;
	#run: Promise<void> | undefined;
	#primary: string | undefined;
	#runScope: RunScopeToken | undefined;
	#submissions = new Map<SubmissionId, { id: string; kind: "prompt" | "steer" | "followUp" }>();
	#submissionByPakkaId = new Map<string, SubmissionId>();
	#consumedSubmissions = new Set<string>();
	#blockedSubmissions = new Set<string>();
	#committedSubmissions = new Set<string>();
	#queued = new Map<
		string,
		{ text: string; kind: "prompt" | "steer" | "followUp"; sub?: Submission; cancelled: boolean }
	>();
	#activeRuns = 0;
	#pendingQueue = new Set<Promise<void>>();
	#activeEntries: EntryRecord[] = [];
	#allEntries: EntryRecord[] = [];
	#contributions: (readonly Message[])[] = [];
	#contextMessages: readonly Message[] = [];
	#forkPromise: Promise<void> | undefined;
	#failedReason: string | undefined;
	#failListeners: (() => void)[] = [];
	#disposed = false;
	#providerSessionId: string | undefined;
	#registry: Registry | undefined;
	#routes = new Map<ConversationId, DurableAdapter>();
	#managed: ManagedState | undefined;
	#releaseWriter: (() => Promise<void>) | undefined;
	#inferenceModels = new Map<
		string,
		{ model: Model<Api>; apiKey: string; headers?: Record<string, string> }
	>();

	private constructor(
		harness: Harness,
		conversation: Conversation,
		sessionId: string,
		sessionFile: string,
		notify: (notice: Notice) => void,
		control: AdapterControl,
		options: HostOptions,
		rawModels: Models,
	) {
		this.#harness = harness;
		this.#conversation = conversation;
		this.#sessionId = sessionId;
		this.#sessionFile = sessionFile;
		this.#notify = notify;
		this.#control = control;
		this.#options = {
			...options,
			inference: options.inference ? structuredClone(options.inference) : undefined,
		};
		this.#rawModels = rawModels;
	}

	static async create(
		options: HostOptions,
		notify: (notice: Notice) => void,
		control: AdapterControl,
		managedOptions?: Pick<RuntimeOptions, "limits" | "profiles" | "migrateLegacy">,
	): Promise<DurableAdapter> {
		const profiles = new Map<string, HostOptions>([["default", profileOptions(options)]]);
		if (managedOptions) {
			if (managedOptions.migrateLegacy && !options.reopenSessionFile)
				throw new Error("Legacy migration requires an explicit closed storage");
			const limits = managedOptions.limits;
			if (
				!limits ||
				Object.values(limits).length !== 3 ||
				Object.values(limits).some((limit) => !Number.isSafeInteger(limit) || limit <= 0)
			)
				throw new Error("Invalid finite runtime limits");
			for (const profile of managedOptions.profiles ?? []) {
				if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(profile.id) || profiles.has(profile.id))
					throw new Error("Invalid/duplicate runtime profile");
				profiles.set(profile.id, profileOptions(options, profile));
			}
		}
		const modelKeys = new Set<string>();
		for (const model of options.inference?.models ?? []) {
			if (
				!model.key ||
				modelKeys.has(model.key) ||
				!model.model ||
				!model.apiKey ||
				[model.maxTokens, model.contextWindow].some((n) => !Number.isSafeInteger(n) || n <= 0)
			)
				throw new Error("Invalid/duplicate finite inference model definition");
			try {
				const endpoint = new URL(model.endpoint);
				if (!["http:", "https:"].includes(endpoint.protocol))
					throw new Error("Unsupported inference endpoint");
			} catch (e) {
				if (e instanceof Error && e.message === "Unsupported inference endpoint") throw e;
				throw new Error("Invalid inference model definition endpoint URL");
			}
			modelKeys.add(model.key);
		}
		for (const policy of options.inference?.policies ?? []) {
			if (policy.modelKeys.some((key) => !modelKeys.has(key)))
				throw new Error("Inference model policy is not allowlisted");
		}

		const sessionsDir = join(options.dataDir, "sessions");
		await mkdir(sessionsDir, { recursive: true });

		let sessionId: string;
		let storageDir: string;
		let sessionFile: string;

		if (options.reopenSessionFile !== undefined) {
			const file = realpathSync(options.reopenSessionFile);
			const inside = relative(realpathSync(sessionsDir), file);
			if (!inside || inside.startsWith("..") || isAbsolute(inside))
				throw new Error("Reopen must be a Pakka-owned session");

			const text = readFileSync(file, "utf8");
			if (!text.endsWith("\n")) throw new Error("Corrupt reopen session");
			const lines = text.trimEnd().split("\n");
			for (const line of lines) {
				try {
					JSON.parse(line);
				} catch {
					throw new Error("Corrupt reopen session");
				}
			}

			storageDir = dirname(file);
			const provPath = join(storageDir, "provenance.json");
			if (existsSync(provPath)) {
				try {
					const prov = JSON.parse(readFileSync(provPath, "utf8")) as ProvenanceData;
					if (resolve(prov.cwd) !== resolve(options.cwd))
						throw new Error("Reopen must match cwd and session provenance");
					sessionId = prov.sessionId;
				} catch (e) {
					if (e instanceof Error && e.message.startsWith("Reopen")) throw e;
					throw new Error("Reopen must match cwd and session provenance");
				}
			} else {
				throw new Error("Reopen must match cwd and session provenance");
			}
			sessionFile = file;
		} else {
			sessionId = randomUUID();
			storageDir = join(sessionsDir, sessionId);
			await mkdir(storageDir, { recursive: true });
			const prov: ProvenanceData = { sessionId, cwd: resolve(options.cwd) };
			await writeFile(join(storageDir, "provenance.json"), JSON.stringify(prov), "utf8");
			sessionFile = join(storageDir, "main.jsonl");
		}

		const releaseWriter = await claimWriter(storageDir);
		let openedHarness: Harness | undefined;
		let openedStorage: Awaited<ReturnType<typeof openNodeJsonlStorage>> | undefined;
		try {
			const storage = await openNodeJsonlStorage(storageDir, BACKGROUND_CONTEXT, { fsync: true });
			openedStorage = storage;

			const rawModels = createModels();
			const mainProviderId = "pakka-provider-" + hash(options.endpoint).slice(0, 12);
			const mainModelId = options.model;
			const mainApiKey = options.apiKey;

			rawModels.setProvider(
				createProvider({
					id: mainProviderId,
					name: "pakka-main",
					baseUrl: options.endpoint,
					auth: {
						apiKey: {
							name: "Main API Key",
							resolve: async () => ({
								auth: { apiKey: mainApiKey, baseUrl: options.endpoint },
							}),
						},
					},
					api: { "openai-completions": oac },
					models: [
						{
							id: mainModelId,
							name: mainModelId,
							provider: mainProviderId,
							api: "openai-completions",
							baseUrl: options.endpoint,
							reasoning: false,
							input: ["text"],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 128000,
							maxTokens: 4096,
							compat: { maxTokensField: "max_tokens", supportsMidConvoSystemMessages: true },
						},
					],
				}),
			);

			let adapterRef: DurableAdapter | undefined;

			const registry = createRegistry();

			const routes = new Map<ConversationId, DurableAdapter>();
			const extensions = new Map<string, ReturnType<typeof defineExtension>>();
			for (const [id, profile] of profiles) {
				const extension = DurableAdapter.#extension(profile, routes, id);
				registry.install(extension);
				extensions.set(id, extension);
			}
			const ext = extensions.get("default")!;

			const harness = await Harness.open(
				storage,
				{
					models: rawModels,
					registry,
					settings: {
						steeringMode: options.steeringMode ?? "one-at-a-time",
						stream: { maxRetries: 0 },
						compaction: { enabled: false },
						retry: { enabled: false },
					},
					onReport: (err) => {
						const errorObj = err instanceof Error ? err : new Error(String(err));
						if (adapterRef) adapterRef.#failSession(errorObj);
					},
				},
				BACKGROUND_CONTEXT,
			);

			openedHarness = harness;
			const storedRuntime = await harness.snapshot(RuntimeDoc, BACKGROUND_CONTEXT);
			if (!managedOptions && storedRuntime)
				throw new Error("Managed storage requires createRuntime; legacy bypass refused");
			if (managedOptions?.migrateLegacy) {
				const expected = managedOptions.migrateLegacy;
				if (expected.expectedSessionId !== sessionId) throw new Error("Legacy migration provenance mismatch");
				if (storedRuntime) {
					if (
						!storedRuntime.journalMigration ||
						storedRuntime.journalMigration.conversationId !== expected.expectedConversationId
					)
						throw new Error("Already managed storage is not the requested legacy migration");
				} else {
					const conversations = await storage.scanConversations({}, 2, undefined, BACKGROUND_CONTEXT);
					const only = conversations.items[0];
					if (
						conversations.items.length !== 1 ||
						conversations.next ||
						!only ||
						only.parent ||
						only.owner ||
						String(only.id) !== expected.expectedConversationId ||
						only.id !== ROOT_CONVERSATION_ID
					)
						throw new Error("Legacy migration requires one provably unique root Conversation");
					const pending = await harness.inspect(BACKGROUND_CONTEXT);
					if (pending.tasks.length || pending.submissions.length)
						throw new Error("Legacy migration requires settled tasks/submissions; outcome unknown");
					const source = readFileSync(sessionFile, "utf8"),
						journals = inspectLegacyJournals(
							options.dataDir,
							sessionId,
							new Set(options.inference?.policies.map((policy) => policy.strategyId) ?? []),
						);
					const primaryAttempts = legacyPrimaryReservations(source, GenerationTask.definition.name);
					if (
						primaryAttempts > managedOptions.limits.maxPrimaryAttempts ||
						journals.auxiliaryAttempts > managedOptions.limits.maxAuxiliaryAttempts
					)
						throw new Error("Legacy migration limits below already consumed spending");
					const migration: MigrationRecord = {
						id: randomUUID(),
						schemaVersion: 1,
						sessionId,
						conversationId: String(only.id),
						sourceLength: source.length,
						sourceSha256: textHash(source),
						primaryAttempts,
						auxiliaryAttempts: journals.auxiliaryAttempts,
						journals: journals.journals,
					};
					await harness.commit(async (tx) => {
						const state = await tx.doc(RuntimeDoc);
						state.sessionId = sessionId;
						state.limits = { ...managedOptions.limits };
						state.profiles = Object.fromEntries(
							[...profiles].map(([id, profile]) => [id, profileHash(profile)]),
						);
						state.conversationCount = 1;
						state.budget = { primaryAttempts, auxiliaryAttempts: journals.auxiliaryAttempts };
						state.strategyAttempts = { ...journals.strategyAttempts };
						state.journalMigration = migration;
						state.resources.root = {
							key: "root",
							sessionId,
							conversationId: String(only.id),
							incarnation: randomUUID(),
							profile: "default",
						};
						await configure(tx, only.id, {
							model: { provider: mainProviderId, modelId: mainModelId },
							extensions: [ext],
							instructions: options.systemPrompt,
							cwd: options.cwd,
						});
						await tx.appendEntry(only.id, {
							kind: "pakka.journal-migration",
							data: { migrationId: migration.id, sourceSha256: migration.sourceSha256 },
						});
					}, BACKGROUND_CONTEXT);
				}
			}
			let conversation = await harness.root(BACKGROUND_CONTEXT, {
				agent: {
					model: { provider: mainProviderId, modelId: mainModelId },
					extensions: [ext],
					instructions: options.systemPrompt ?? undefined,
					cwd: options.cwd,
				},
				...(managedOptions
					? {
							init: async (tx: Parameters<Parameters<Harness["commit"]>[0]>[0], created: ConversationId) => {
								const state = await tx.doc(RuntimeDoc);
								state.sessionId = sessionId;
								state.limits = { ...managedOptions.limits };
								state.profiles = Object.fromEntries(
									[...profiles].map(([id, profile]) => [id, profileHash(profile)]),
								);
								state.conversationCount = 1;
								state.resources.root = {
									key: "root",
									sessionId,
									conversationId: String(created),
									incarnation: randomUUID(),
									profile: "default",
								};
							},
						}
					: {}),
			});

			const savedRuntime = managedOptions
				? await harness.snapshot(RuntimeDoc, BACKGROUND_CONTEXT)
				: undefined;
			if (managedOptions) {
				const expected = Object.fromEntries([...profiles].map(([id, profile]) => [id, profileHash(profile)]));
				if (
					!savedRuntime ||
					savedRuntime.sessionId !== sessionId ||
					hash(savedRuntime.limits) !== hash(managedOptions.limits) ||
					hash(savedRuntime.profiles) !== hash(expected)
				) {
					await harness.close(BACKGROUND_CONTEXT);
					throw new Error("Managed runtime profile/limits mismatch or explicit legacy migration required");
				}
				if (savedRuntime.journalMigration) {
					const migration = savedRuntime.journalMigration;
					if (
						textHash(readFileSync(sessionFile, "utf8").slice(0, migration.sourceLength)) !==
						migration.sourceSha256
					)
						throw new Error("Migrated source prefix changed; storage unknown");
					verifyMigration(options.dataDir, sessionId, migration);
				}
				const activeRoot = savedRuntime.resources.root;
				if (!activeRoot) {
					await harness.close(BACKGROUND_CONTEXT);
					throw new Error("Managed root resource is missing");
				}
				const active = await harness.conversation(
					conversationId(activeRoot.conversationId),
					BACKGROUND_CONTEXT,
				);
				if (!active) {
					await harness.close(BACKGROUND_CONTEXT);
					throw new Error("Managed root Conversation is missing");
				}
				conversation = active;
			}

			const adapter = new DurableAdapter(
				harness,
				conversation,
				sessionId,
				sessionFile,
				notify,
				control,
				options,
				rawModels,
			);
			adapterRef = adapter;
			adapter.#releaseWriter = releaseWriter;
			adapter.#routes = routes;
			adapter.#registry = registry;
			routes.set(conversation.id, adapter);
			if (managedOptions) {
				const hashes = Object.fromEntries([...profiles].map(([id, profile]) => [id, profileHash(profile)]));
				adapter.#managed = { profiles, profileHashes: hashes, state: savedRuntime!, closed: false };
				adapter.#managed.unsubscribe = harness.subscribeCommits((publication) => {
					for (const change of publication.changes)
						if (change.type === "document" && change.record.kind === "pakka.runtime" && change.value)
							adapter.#managed!.state = change.value as RuntimeRecord;
				});
			}

			for (const def of options.inference?.models ?? []) {
				const auxProviderId = "pakka-aux-" + hash(def.key).slice(0, 12);
				rawModels.setProvider(
					createProvider({
						id: auxProviderId,
						name: def.name ?? def.model,
						baseUrl: def.endpoint,
						auth: {
							apiKey: {
								name: "Aux API Key",
								resolve: async () => ({
									auth: { apiKey: def.apiKey, baseUrl: def.endpoint, headers: def.headers },
								}),
							},
						},
						api: { "openai-completions": oac },
						models: [
							{
								id: def.model,
								name: def.name ?? def.model,
								provider: auxProviderId,
								api: "openai-completions",
								baseUrl: def.endpoint,
								reasoning: def.reasoning ?? false,
								input: ["text"],
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
								contextWindow: def.contextWindow,
								maxTokens: def.maxTokens,
								compat: { maxTokensField: "max_tokens", supportsMidConvoSystemMessages: true },
							},
						],
					}),
				);
				const model = rawModels.getModel(auxProviderId, def.model);
				if (!model) throw new Error("Inference model unavailable");
				adapter.#inferenceModels.set(def.key, {
					model,
					apiKey: def.apiKey,
					headers: def.headers ? { ...def.headers } : undefined,
				});
			}

			await adapter.#initStream();
			await adapter.refreshCache();
			return adapter;
		} catch (error) {
			// A claim is released only after the known writer is closed; cleanup failure retains it.
			if (openedHarness) await openedHarness.close(BACKGROUND_CONTEXT);
			else if (openedStorage) await openedStorage.close(BACKGROUND_CONTEXT);
			await releaseWriter();
			throw error;
		}
	}

	static #extension(options: HostOptions, routes: Map<ConversationId, DurableAdapter>, profile: string) {
		const resolveAdapter = (id: ConversationId) => {
			const adapter = routes.get(id);
			if (!adapter || adapter.#disposed) throw new Error("Conversation authority is not bound");
			return adapter;
		};
		return defineExtension({
			name: profile === "default" ? "pakka-core-extension" : "pakka-profile-" + profile,
			tools: (options.tools ?? []).map((tool) =>
				defineTool({
					name: tool.name,
					description: tool.description,
					// SAFETY: bootstrap tool parameters are JSON Schema; Durable validates arguments before execute.
					parameters: tool.parameters as unknown as TSchema,
					execute: async (args, api, context) => {
						const adapter = resolveAdapter(api.conversationId);
						const scope = adapter.activeRunScope ?? adapter.#control.runScope();
						const result = await adapter.#control.invoke(scope, (invocation) =>
							tool.execute(args as Record<string, unknown>, context.abortSignal, invocation),
						);
						return { content: [{ type: "text", text: result }] };
					},
				}),
			),
			sections: options.systemPrompt ? [section("system", () => options.systemPrompt, { tag: false })] : [],
			hooks: [
				hook(GenerationTask, {
					beforeRequest: async (_request, api, context) => {
						let adapter: DurableAdapter | undefined;
						try {
							adapter = resolveAdapter(api.conversationId);
							await adapter.refreshCache();
							const permitted = await adapter.#control.project(context.abortSignal);
							permitted.check();
							if ("block" in permitted) return { block: permitted.block };
							if (!(await adapter.#reserveAttempt("primary")))
								return { block: "Session primary attempt budget exhausted" };
							permitted.check();
							return { messages: clean<Message[]>(permitted.messages), check: permitted.check };
						} catch (error) {
							const failure = error instanceof Error ? error : new Error(String(error));
							adapter?.markFailed(failure);
							return { block: failure.message };
						}
					},
					afterResponse: async (message, api) => {
						if (message.stopReason === "error")
							routes
								.get(api.conversationId)
								?.markFailed(new Error(message.errorMessage ?? "Provider failed"));
					},
				}),
			],
		});
	}

	static async createManaged(
		options: RuntimeOptions,
		notify: (notice: Notice) => void,
		control: AdapterControl,
	): Promise<{ readonly adapter: DurableAdapter; readonly port: ManagedAdapterPort }> {
		const adapter = await DurableAdapter.create(options, notify, control, options);
		return Object.freeze({ adapter, port: adapter.#managedPort() });
	}
	#managedReady(): ManagedState {
		const managed = this.#managed;
		if (!managed || managed.closed || managed.failure)
			throw new Error("Runtime is " + (managed?.failure ?? "closed/unmanaged"));
		return managed;
	}
	#validateReference(ref: ConversationRef): void {
		const managed = this.#managedReady();
		const current = managed.state.resources[ref.key];
		if (!current || hash(current) !== hash(ref)) throw new Error("Stale or foreign Conversation reference");
	}
	#managedPort(): ManagedAdapterPort {
		return Object.freeze({
			view: () => {
				const managed = this.#managed!;
				return copy({
					sessionId: this.#sessionId,
					sessionFile: this.#sessionFile,
					phase: managed.closed
						? ("closed" as const)
						: managed.failure
							? ("failed" as const)
							: ("ready" as const),
					conversations: Object.values(managed.state.resources),
					limits: managed.state.limits,
					budget: managed.state.budget,
					...(managed.state.journalMigration ? { journalMigration: managed.state.journalMigration } : {}),
					...(managed.failure ? { lastError: managed.failure } : {}),
				});
			},
			profileOptions: (id: string) => {
				const profile = this.#managedReady().profiles.get(id);
				if (!profile) throw new Error("Unapproved runtime profile");
				return profile;
			},
			validateReference: (ref: ConversationRef) => this.#validateReference(ref),
			createConversation: async (spec: ConversationSpec): Promise<ConversationRef> => {
				const managed = this.#managedReady();
				const profileId = spec.profile ?? "default",
					profile = managed.profiles.get(profileId);
				if (!profile) throw new Error("Unapproved runtime profile");
				if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(spec.key)) throw new Error("Invalid Conversation key");
				await this.#persist(async (tx) => {
					const state = await tx.doc(RuntimeDoc);
					if (Object.hasOwn(state.resources, spec.key)) {
						if (state.resources[spec.key]!.profile !== profileId)
							throw new MutationDenied("Conversation profile conflict");
						return;
					}
					if (state.conversationCount >= state.limits.maxConversations)
						throw new MutationDenied("Session Conversation limit exhausted");
					const created = await tx.createConversation({ ownership: { kind: "ownerless" } });
					const extension = this.#registry!.snapshot().extension(
						profileId === "default" ? "pakka-core-extension" : "pakka-profile-" + profileId,
					)!;
					await configure(tx, created.id, {
						model: {
							provider: "pakka-provider-" + hash(profile.endpoint).slice(0, 12),
							modelId: profile.model,
						},
						extensions: [extension],
						instructions: profile.systemPrompt,
						cwd: profile.cwd,
					});
					state.conversationCount++;
					state.resources[spec.key] = {
						key: spec.key,
						sessionId: this.#sessionId,
						conversationId: String(created.id),
						incarnation: randomUUID(),
						profile: profileId,
					};
				});
				return copy(this.#managed!.state.resources[spec.key]!);
			},
			attach: async (ref: ConversationRef, notify: (notice: Notice) => void, control: AdapterControl) => {
				this.#validateReference(ref);
				const id = conversationId(ref.conversationId);
				if (this.#routes.has(id)) throw new Error("Conversation already bound");
				const conversation = await this.#harness.conversation(id, BACKGROUND_CONTEXT);
				if (!conversation) throw new Error("Managed Conversation is missing");
				const profile = this.#managed!.profiles.get(ref.profile)!;
				const adapter = new DurableAdapter(
					this.#harness,
					conversation,
					this.#sessionId,
					this.#sessionFile,
					notify,
					control,
					profile,
					this.#rawModels,
				);
				adapter.#routes = this.#routes;
				adapter.#registry = this.#registry;
				adapter.#managed = this.#managed;
				adapter.#inferenceModels = this.#inferenceModels;
				this.#routes.set(id, adapter);
				await adapter.#initStream();
				await adapter.refreshCache();
				return adapter;
			},
			waitForIdle: async () => {
				this.#managedReady();
				await this.#harness.waitForIdle(BACKGROUND_CONTEXT);
				await Promise.all([...this.#routes.values()].map((adapter) => adapter.idle()));
			},
			close: async () => {
				if (this.#managed!.closed) return;
				this.#managed!.closed = true;
				await this.#harness.close(BACKGROUND_CONTEXT);
				this.#managed!.unsubscribe?.();
				await this.#releaseWriter?.();
			},
		});
	}
	storageUnknown(reason: string): void {
		this.#failSession(new Error(reason));
	}
	journalNamespace(strategyId: string, kind: string): string | undefined {
		const receipt = this.#managed?.state.journalMigration;
		if (!receipt) return undefined;
		try {
			verifyMigration(this.#options.dataDir, this.#sessionId, receipt);
			return migratedNamespace(receipt, String(this.#conversation.id), strategyId, kind);
		} catch (error) {
			this.storageUnknown("Migration storage unknown: " + String(error));
			throw error;
		}
	}
	#failSession(error: Error): void {
		if (this.#managed) this.#managed.failure ??= error.message;
		for (const adapter of this.#routes.values()) adapter.markFailed(error);
	}
	async #persist<T>(change: (tx: Tx) => Promise<T>): Promise<T> {
		try {
			return await this.#harness.commit(change, BACKGROUND_CONTEXT);
		} catch (error) {
			if (!(error instanceof MutationDenied) && !(error instanceof StorageRejected))
				this.#failSession(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}
	async #reserveAttempt(
		kind: "primary" | "auxiliary",
		strategy?: { strategyId: string; maxCalls: number },
	): Promise<boolean> {
		if (!this.#managed) return true;
		this.#managedReady();
		try {
			return await this.#harness.commit(async (tx) => {
				const state = await tx.doc(RuntimeDoc);
				const field = kind === "primary" ? "primaryAttempts" : "auxiliaryAttempts";
				const limit =
					kind === "primary" ? state.limits.maxPrimaryAttempts : state.limits.maxAuxiliaryAttempts;
				if (state.budget[field] >= limit) return false;
				if (strategy) {
					const key = hash(strategy.strategyId),
						spent = state.strategyAttempts[key] ?? 0;
					if (spent >= strategy.maxCalls) return false;
					state.strategyAttempts[key] = spent + 1;
				}
				state.budget[field]++;
				return true;
			}, BACKGROUND_CONTEXT);
		} catch (error) {
			this.#failSession(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}
	get canReplace(): boolean {
		return !this.#managed;
	}

	markFailed(err: Error): void {
		if (this.#disposed) return;
		this.#failedReason = err.message;
		this.#activeRuns = 0;
		for (const fn of this.#failListeners) fn();
		this.#failListeners = [];
		this.#notify({ type: "failed", reason: err.message, sessionId: this.#sessionId });
	}

	get activeRunScope(): RunScopeToken | undefined {
		return this.#runScope;
	}

	async #initStream(): Promise<void> {
		if (this.#stream) {
			await this.#stream.stop().catch(() => {});
			this.#stream = undefined;
		}
		this.#stream = await watchEvents(this.#harness, this.#conversation.id, BACKGROUND_CONTEXT);
		this.#stream.start(async (batch) => {
			for (const event of batch) {
				this.#handleEvent(event);
			}
		});
	}

	#handleEvent(event: AgentEvent): void {
		if (event.type === "run_start") {
			this.#activeRuns++;
		} else if (event.type === "run_end") {
			if (this.#activeRuns > 0) this.#activeRuns--;
		} else if (event.type === "message_end" || event.type === "entry_appended") {
			this.#notify({ type: "changed" });
		} else if (event.type === "task_failed") {
			this.markFailed(new Error(event.message));
		} else if (event.type === "submission") {
			this.#observeSubmission(event.record);
		}
	}

	#observeSubmission(sub: Awaited<ReturnType<Submission["status"]>>): void {
		const meta = this.#submissions.get(sub.id);
		if (!meta) return;
		if (sub.status === "unanswered" && sub.entry === undefined && sub.reason === "aborted") {
			this.#queued.delete(meta.id);
			this.#submissions.delete(sub.id);
			this.#submissionByPakkaId.delete(meta.id);
			this.#notify({
				type: "released",
				id: meta.id,
				reason: "Durable confirmed withdrawal before placement",
			});
			return;
		}
		if (sub.entry !== undefined) {
			this.#queued.delete(meta.id);
			if (!this.#consumedSubmissions.has(meta.id)) {
				this.#consumedSubmissions.add(meta.id);
				this.#notify({ type: "consumed", id: meta.id });
			}
			if (!this.#committedSubmissions.has(meta.id)) {
				this.#committedSubmissions.add(meta.id);
				this.#notify({ type: "committed", id: meta.id, entryId: String(sub.entry) });
			}
		}
		if (sub.status === "unanswered" && sub.reason === "blocked" && !this.#blockedSubmissions.has(meta.id)) {
			this.#blockedSubmissions.add(meta.id);
			this.#notify({ type: "blocked", id: meta.id, reason: String(sub.detail ?? "Generation blocked") });
		}
	}

	async refreshCache(): Promise<void> {
		if (this.#failedReason) return;
		try {
			const ctx = await this.#conversation.context(BACKGROUND_CONTEXT);
			const provider = await this.#harness.snapshot(ProviderDoc, this.#conversation.id, BACKGROUND_CONTEXT);
			this.#providerSessionId = provider?.sessionId;
			this.#activeEntries = [...ctx.entries];
			this.#contributions = [...ctx.contributions];
			this.#contextMessages = [...ctx.messages];
			let cursor: Cursor | undefined;
			const entries: EntryRecord[] = [];
			do {
				const page = await this.#conversation.entries({}, 1000, cursor, BACKGROUND_CONTEXT);
				entries.push(...page.items);
				cursor = page.next;
			} while (cursor !== undefined);
			this.#allEntries = entries.reverse();
		} catch (e) {
			const reason = e instanceof Error ? e.message : String(e);
			this.markFailed(new Error(reason));
		}
	}

	get busy(): boolean {
		return (
			this.#run !== undefined || this.#activeRuns > 0 || (!!this.#managed && this.#forkPromise !== undefined)
		);
	}

	get canQueue(): boolean {
		return this.#activeRuns > 0;
	}

	snapshot() {
		return {
			sessionId: this.#sessionId,
			durableSessionId: this.#sessionId,
			conversationId: String(this.#conversation.id),
			providerSessionId: this.#providerSessionId,
			sessionFile: this.#sessionFile,
			leafId: this.#activeEntries.length > 0 ? String(this.#activeEntries.at(-1)!.id) : null,
			entries: this.#allEntries.map((e) => ({
				id: String(e.id),
				type: e.kind,
				...(e.model && e.model.length > 0
					? { role: e.model[0].role, text: messageText(e.model[0]) }
					: e.data && (e.data as Record<string, unknown>).text
						? { text: String((e.data as Record<string, unknown>).text) }
						: {}),
			})),
			context: this.#contextMessages.map((m) => ({
				role: m.role,
				text: messageText(m),
			})),
			autoCompaction: false,
		};
	}

	frame(): AdapterFrame {
		const total: { -readonly [K in keyof UsageDTO]: UsageDTO[K] } = {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: 0,
		};
		for (const entry of this.#activeEntries) {
			if (entry.model) {
				for (const m of entry.model) {
					if (m.role === "assistant" && (m as AssistantMessage).usage) {
						const u = usageDTO((m as AssistantMessage).usage);
						for (const k of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const)
							total[k] += u[k];
						total.cost = total.cost === null || u.cost === null ? null : total.cost + u.cost;
					}
				}
			}
		}

		return copy({
			sessionId: this.#sessionId,
			durableSessionId: this.#sessionId,
			conversationId: String(this.#conversation.id),
			providerSessionId: this.#providerSessionId,
			cwd: this.#options.cwd,
			leafId: this.#activeEntries.length > 0 ? String(this.#activeEntries.at(-1)!.id) : null,
			entries: this.#allEntries.map((entry, index) => ({
				id: String(entry.id),
				parentId: index > 0 ? String(this.#allEntries[index - 1]!.id) : null,
				type: entry.kind,
				raw: clean<ContextFrame["entries"][number]["raw"]>(entry),
			})),
			activeEntryIds: this.#activeEntries.map((e) => String(e.id)),
			projection: this.#activeEntries.map((entry, idx) => {
				// SAFETY: Message in pi-ai contains role and structured content compatible with MessageDTO
				const msgs = (this.#contributions[idx] ?? []) as unknown as readonly MessageDTO[];
				return {
					sourceEntryId: String(entry.id),
					messages: clean<MessageDTO[]>([...msgs]),
					boundary: msgs.some((m) => m.role === "system")
						? ("system" as const)
						: ["pi.compaction", "compaction", "branch_summary"].includes(entry.kind)
							? ("host-summary" as const)
							: null,
					excluded: msgs.some(
						(m) => m.role === "bashExecution" && (m as Record<string, unknown>).excludeFromContext === true,
					),
					fingerprint: hash([entry, msgs]),
				};
			}),
			model: {
				key: "main",
				model: this.#options.model,
				name: this.#options.model,
				reasoning: false,
				contextWindow: 128000,
				maxOutputTokens: 4096,
				available: true,
			},
			usage: total,
		});
	}

	models(): readonly ModelDTO[] {
		return copy(
			[...this.#inferenceModels].map(([key, { model }]) => ({
				key,
				model: model.id,
				name: model.name,
				reasoning: model.reasoning,
				contextWindow: model.contextWindow,
				maxOutputTokens: model.maxTokens,
				available: true,
			})),
		);
	}

	async infer(
		request: InferenceRequest,
		cap: number,
		signal: AbortSignal,
		timeoutMs: number,
		check: () => void,
		strategy: { strategyId: string; maxCalls: number },
	): Promise<Omit<InferenceResult, "attemptId">> {
		const definition = this.#inferenceModels.get(request.modelKey);
		if (!definition) throw new Error("Model is not allowlisted");
		check();
		if (!(await this.#reserveAttempt("auxiliary", strategy)))
			throw new Error("Session auxiliary attempt budget exhausted");
		check();
		const model = { ...definition.model, maxTokens: Math.min(cap, definition.model.maxTokens) };
		const answer = await this.#rawModels.completeSimple(
			model,
			{
				systemPrompt: request.systemPrompt ?? "",
				messages: [{ role: "user", content: request.prompt, timestamp: Date.now() }],
			},
			{
				apiKey: definition.apiKey,
				headers: definition.headers,
				maxTokens: model.maxTokens,
				reasoning: request.thinkingLevel === "off" ? undefined : request.thinkingLevel,
				signal,
				timeoutMs,
				maxRetries: 0,
				sessionId: "pakka-aux-" + randomUUID(),
				onPayload: async () => {
					check();
				},
			},
		);
		const failed = answer.stopReason !== "stop";
		const known = [
			answer.usage.input,
			answer.usage.output,
			answer.usage.cacheRead,
			answer.usage.cacheWrite,
			answer.usage.totalTokens,
		].some((n) => Number.isFinite(n) && n > 0);
		return copy({
			status: failed ? "failed" : "completed",
			modelKey: request.modelKey,
			...(failed
				? { reason: "Auxiliary output incomplete: " + answer.stopReason }
				: { text: messageText(answer) }),
			usageStatus: known ? "known" : "unknown",
			usage: known ? usageDTO(answer.usage) : undefined,
		});
	}

	start(id: string, text: string, canStart: () => boolean): void {
		if (this.busy) throw new Error("busy");
		this.#primary = id;
		this.#runScope = this.#control.runScope();

		const runPromise = (async () => {
			if (this.#forkPromise) await this.#forkPromise;
			if (!canStart()) throw new Error("Start invalidated by lifecycle transition");
			const sub = await this.#conversation.submit(
				{
					type: "input",
					content: text,
					whenBusy: "reject",
				},
				BACKGROUND_CONTEXT,
			);
			this.#submissions.set(sub.id, { id, kind: "prompt" });
			this.#submissionByPakkaId.set(id, sub.id);

			const initialStatus = await sub.status(BACKGROUND_CONTEXT);
			if (initialStatus.status === "placed" && initialStatus.entry !== undefined) {
				if (!this.#consumedSubmissions.has(id)) {
					this.#consumedSubmissions.add(id);
					this.#notify({ type: "consumed", id });
				}
				if (!this.#committedSubmissions.has(id)) {
					this.#committedSubmissions.add(id);
					this.#notify({ type: "committed", id, entryId: String(initialStatus.entry) });
				}
			}

			let settled: Awaited<ReturnType<Submission["wait"]>>;
			try {
				settled = await sub.wait(BACKGROUND_CONTEXT);
			} catch (error) {
				this.markFailed(error instanceof Error ? error : new Error(String(error)));
				return;
			}

			this.#observeSubmission(settled);
			if (this.#failedReason) {
				return;
			}

			if (settled.status === "unanswered") {
				if (settled.reason === "blocked") return;
				if (settled.reason === "model_error" || settled.reason === "no_model") {
					const reasonStr =
						typeof settled.detail === "string"
							? settled.detail
							: settled.detail
								? JSON.stringify(settled.detail)
								: "Provider failed";
					this.#notify({ type: "failed", reason: reasonStr });
				} else {
					this.#notify({
						type: "unknown",
						id,
						reason: "Prompt did not produce a verifiable entry",
					});
				}
			}
		})();

		this.#run = runPromise
			.then(
				async () => {
					await this.refreshCache();
				},
				async (error) => {
					await this.refreshCache();
					this.markFailed(error instanceof Error ? error : new Error(String(error)));
				},
			)
			.finally(() => {
				if (this.#primary === id) {
					this.#primary = undefined;
					this.#runScope = undefined;
				}
				this.#run = undefined;
			});
	}

	enqueue(id: string, text: string, kind: "steer" | "followUp"): void {
		const entry = { text, kind, sub: undefined as Submission | undefined, cancelled: false };
		this.#queued.set(id, entry);
		const operation = (async () => {
			try {
				if (this.#forkPromise) await this.#forkPromise;
				const sub = await this.#conversation.submit(
					{
						type: "input",
						content: text,
						whenBusy: kind,
					},
					BACKGROUND_CONTEXT,
				);
				entry.sub = sub;
				this.#submissions.set(sub.id, { id, kind });
				this.#submissionByPakkaId.set(id, sub.id);
				if (entry.cancelled) await this.#withdraw(id, sub);
				else this.#observeSubmission(await sub.status(BACKGROUND_CONTEXT));
			} catch (e) {
				this.#failSession(e instanceof Error ? e : new Error(String(e)));
			}
		})();
		this.#trackQueue(operation);
	}

	#trackQueue(operation: Promise<void>): void {
		this.#pendingQueue.add(operation);
		void operation.finally(() => this.#pendingQueue.delete(operation));
	}
	async #withdraw(id: string, sub: Submission): Promise<void> {
		try {
			await this.#harness.abortSubmission(sub.id, BACKGROUND_CONTEXT, this.#conversation.id);
			// A placed input remains committed even when abort was requested.
			this.#observeSubmission(await sub.status(BACKGROUND_CONTEXT));
		} catch (error) {
			this.#notify({ type: "unknown", id, reason: "Withdrawal persistence could not be confirmed" });
			this.#failSession(error instanceof Error ? error : new Error(String(error)));
		}
	}

	clearQueued(selected?: ReadonlySet<string>): string[] {
		const cleared: string[] = [];
		for (const [id, item] of [...this.#queued.entries()]) {
			if (item.cancelled || (selected && !selected.has(id))) continue;
			cleared.push(id);
			item.cancelled = true;
			if (item.sub) this.#trackQueue(this.#withdraw(id, item.sub));
		}
		return cleared;
	}

	persisted(id: string): boolean {
		try {
			if (!existsSync(this.#sessionFile)) return false;
			const content = readFileSync(this.#sessionFile, "utf8");
			return content
				.split("\n")
				.filter(Boolean)
				.some((line) => {
					try {
						const parsed = JSON.parse(line);
						if (parsed.type === "commit" && Array.isArray(parsed.writes)) {
							return parsed.writes.some(
								(w: Record<string, unknown>) =>
									w.type === "entry" && String((w.value as Record<string, unknown>)?.id) === id,
							);
						}
						return parsed.id === id || String(parsed.id) === id;
					} catch {
						return false;
					}
				});
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw e;
		}
	}

	validate(proposal: Proposal): boolean {
		if (!proposal || typeof proposal !== "object") return false;
		if (proposal.type === "cut") {
			return (
				typeof proposal.summary === "string" &&
				proposal.summary.trim().length > 0 &&
				Number.isFinite(proposal.tokensBefore) &&
				proposal.tokensBefore >= 0 &&
				(proposal.firstKeptEntryId === null ||
					this.#activeEntries.some((e) => String(e.id) === proposal.firstKeptEntryId))
			);
		}
		if (proposal.type !== "edit" || (proposal.text !== null && typeof proposal.text !== "string"))
			return false;
		return this.#activeEntries.some(
			(e) =>
				String(e.id) === proposal.targetId &&
				(e.kind === "custom_message" ||
					e.kind === "pi.user" ||
					e.kind === "pi.assistant" ||
					e.kind === "pi.toolResult" ||
					Boolean(e.model && e.model.length > 0)),
		);
	}

	async commit(
		proposal: Proposal,
		author: { principal: string; strategyId: string; operationId: string },
	): Promise<string> {
		if (this.#forkPromise) await this.#forkPromise;
		let entryId: number;
		const authorData = clean<Record<string, unknown>>(author);

		if (proposal.type === "cut") {
			const summaryText = `The conversation history before this point was compacted into the following summary:\n\n<summary>\n${proposal.summary}\n</summary>`;
			// SAFETY: Branded EntryId is assigned by numeric cast
			const firstKeptId =
				proposal.firstKeptEntryId !== null
					? (Number(proposal.firstKeptEntryId) as unknown as EntryId)
					: "self";
			const entryDraft: EntryDraft = {
				kind: CompactionEntry.kind,
				head: firstKeptId,
				model: [{ role: "user", content: [{ type: "text", text: summaryText }], timestamp: Date.now() }],
				// SAFETY: Compaction metadata conforms to Chord JsonValue
				data: {
					summary: proposal.summary,
					firstKeptEntryId: proposal.firstKeptEntryId,
					tokensBefore: proposal.tokensBefore,
					pakka: authorData,
				} as unknown as ChordJsonValue,
			};
			entryId = await this.#persist(async (tx) => {
				const entry = await tx.appendEntry(this.#conversation.id, entryDraft);
				return entry.id;
			});
		} else {
			// Two appends: intent followed by context edit
			await this.#persist(async (tx) => {
				await tx.appendEntry(this.#conversation.id, {
					kind: "pakka.context-intent",
					// SAFETY: Intent payload conforms to Chord JsonValue
					data: { ...authorData, proposal } as unknown as ChordJsonValue,
				});
			});

			// SAFETY: Branded EntryId is assigned by numeric cast
			const targetId = Number(proposal.targetId) as unknown as EntryId;
			entryId = await this.#persist(async (tx) => {
				const entry = await tx.appendEntry(this.#conversation.id, {
					kind: "pi.context_edit",
					edits: [
						proposal.text === null
							? { target: targetId, action: "omit" }
							: {
									target: targetId,
									action: "replace",
									messages: [{ role: "user", content: proposal.text, timestamp: Date.now() }],
								},
					],
					// SAFETY: Edit metadata conforms to Chord JsonValue
					data: { ...authorData, proposal } as unknown as ChordJsonValue,
				});
				return entry.id;
			});
		}

		await this.refreshCache();

		const strId = String(entryId);
		if (!this.persisted(strId)) throw new Error("Context commit has no physical receipt");
		return strId;
	}

	branch(id: string): void {
		const targetEntry = this.#allEntries.find((e) => String(e.id) === id);
		if (!targetEntry) throw new Error("Unknown branch target");
		if (this.#managed) {
			const managed = this.#managedReady();
			if (managed.state.conversationCount >= managed.state.limits.maxConversations)
				throw new Error("Session Conversation limit exhausted");
		}
		const cutoffIndex = this.#allEntries.findIndex((e) => String(e.id) === id);
		if (cutoffIndex >= 0) {
			this.#activeEntries = this.#allEntries.slice(0, cutoffIndex + 1);
		}
		// SAFETY: Branded EntryId is assigned by numeric cast
		const branchTargetId = Number(id) as unknown as EntryId;
		const prevFork = this.#forkPromise ?? Promise.resolve();
		const forkOp = prevFork
			.then(() => {
				const source = String(this.#conversation.id);
				const resource = this.#managed
					? Object.values(this.#managedReady().state.resources).find((ref) => ref.conversationId === source)
					: undefined;
				if (this.#managed && !resource) throw new Error("Managed fork source is unregistered");
				return this.#conversation.fork(
					branchTargetId,
					{
						ownership: { kind: "ownerless" },
						...(resource
							? {
									init: async (
										tx: Parameters<Parameters<Harness["commit"]>[0]>[0],
										created: ConversationId,
									) => {
										const state = await tx.doc(RuntimeDoc);
										if (state.resources[resource.key]?.conversationId !== source)
											throw new Error("Managed fork source changed");
										if (state.conversationCount >= state.limits.maxConversations)
											throw new MutationDenied("Session Conversation limit exhausted");
										state.conversationCount++;
										state.resources[resource.key] = {
											...resource,
											conversationId: String(created),
											incarnation: randomUUID(),
										};
									},
								}
							: {}),
					},
					BACKGROUND_CONTEXT,
				);
			})
			.then(async (forked) => {
				if (this.#disposed) return;
				this.#routes.delete(this.#conversation.id);
				this.#conversation = forked;
				this.#routes.set(forked.id, this);
				await this.#initStream();
				await this.refreshCache();
			})
			.catch(async (err) => {
				if (err instanceof MutationDenied || err instanceof StorageRejected) await this.refreshCache();
				else this.#failSession(err instanceof Error ? err : new Error(String(err)));
			})
			.finally(() => {
				if (this.#forkPromise === forkOp) {
					this.#forkPromise = undefined;
				}
			});
		this.#forkPromise = forkOp;
	}

	replacement(notify: (notice: Notice) => void, control: AdapterControl): Promise<DurableAdapter> {
		return DurableAdapter.create({ ...this.#options, reopenSessionFile: undefined }, notify, control);
	}

	async reload(): Promise<void> {
		await this.refreshCache();
	}

	async abortAndIdle(): Promise<void> {
		await this.#conversation.abort(BACKGROUND_CONTEXT).catch(() => {});
		await this.idle().catch(() => {});
	}

	async idle(): Promise<void> {
		if (this.#failedReason) return;
		let resolveFailure!: () => void;
		const failure = new Promise<void>((resolve) => {
			resolveFailure = resolve;
			if (this.#failedReason) resolve();
			else this.#failListeners.push(resolve);
		});
		try {
			await Promise.race([
				Promise.all([
					this.#run,
					this.#forkPromise,
					...this.#pendingQueue,
					this.#conversation.waitForIdle(BACKGROUND_CONTEXT),
				]),
				failure,
			]);
		} finally {
			const index = this.#failListeners.indexOf(resolveFailure);
			if (index >= 0) this.#failListeners.splice(index, 1);
		}
		await this.refreshCache();
	}

	async dispose(): Promise<void> {
		await Promise.all([...this.#pendingQueue]);
		this.#disposed = true;
		if (this.#stream) {
			await this.#stream.stop().catch(() => {});
			this.#stream = undefined;
		}
		await this.#conversation.abort(BACKGROUND_CONTEXT).catch(() => {});
		this.#routes.delete(this.#conversation.id);
		if (!this.#managed) {
			await this.#harness.close(BACKGROUND_CONTEXT);
			await this.#releaseWriter?.();
		}
	}
}
