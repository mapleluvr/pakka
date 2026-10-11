import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import * as oac from "@earendil-works/pi-ai/api/openai-completions";
import { copy, hash } from "./artifact-journal.ts";
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
} from "./types.ts";

export type AdapterFrame = Pick<
	ContextFrame,
	"sessionId" | "cwd" | "leafId" | "entries" | "activeEntryIds" | "projection" | "model" | "usage"
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
	#activeEntries: EntryRecord[] = [];
	#allEntries: EntryRecord[] = [];
	#contributions: (readonly Message[])[] = [];
	#contextMessages: readonly Message[] = [];
	#forkPromise: Promise<void> | undefined;
	#failedReason: string | undefined;
	#failListeners: (() => void)[] = [];
	#disposed = false;
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
	): Promise<DurableAdapter> {
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

		const storage = await openNodeJsonlStorage(storageDir, BACKGROUND_CONTEXT, { fsync: true });

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

		const tools = (options.tools ?? []).map((t) =>
			defineTool({
				name: t.name,
				description: t.description,
				// SAFETY: Tool parameters in HostOptions are JSON-schema compatible with TSchema
				parameters: t.parameters as unknown as TSchema,
				execute: async (args, _api, ctx) => {
					const runScope = adapterRef?.activeRunScope ?? control.runScope();
					const resultString = await control.invoke(runScope, (scope) =>
						t.execute(args as Record<string, unknown>, ctx.abortSignal, scope),
					);
					return { content: [{ type: "text", text: resultString }] };
				},
			}),
		);

		const sections = options.systemPrompt
			? [section("system", () => options.systemPrompt, { tag: false })]
			: [];

		const ext = defineExtension({
			name: "pakka-core-extension",
			tools,
			sections,
			hooks: [
				hook(GenerationTask, {
					beforeRequest: async (_req, _api, ctx) => {
						try {
							await adapterRef?.refreshCache();
							const permitted = await control.project(ctx.abortSignal);
							permitted.check();
							if ("block" in permitted) return { block: permitted.block };
							return { messages: clean<Message[]>(permitted.messages), check: permitted.check };
						} catch (err) {
							// Protocol errors still fail the Profile, but never fall through to dispatch.
							const error = err instanceof Error ? err : new Error(String(err));
							adapterRef?.markFailed(error);
							return { block: error.message };
						}
					},
					afterResponse: async (msg) => {
						if (msg.stopReason === "error") {
							notify({ type: "failed", reason: msg.errorMessage ?? "Provider failed" });
						}
					},
				}),
			],
		});
		registry.install(ext);

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
					adapterRef?.markFailed(errorObj);
				},
			},
			BACKGROUND_CONTEXT,
		);

		const conversation = await harness.root(BACKGROUND_CONTEXT, {
			agent: {
				model: { provider: mainProviderId, modelId: mainModelId },
				extensions: [ext],
				instructions: options.systemPrompt ?? undefined,
				cwd: options.cwd,
			},
		});

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
		return this.#run !== undefined || this.#activeRuns > 0;
	}

	get canQueue(): boolean {
		return this.#activeRuns > 0;
	}

	snapshot() {
		return {
			sessionId: this.#sessionId,
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
	): Promise<Omit<InferenceResult, "attemptId">> {
		const definition = this.#inferenceModels.get(request.modelKey);
		if (!definition) throw new Error("Model is not allowlisted");
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
				}
				this.#run = undefined;
			});
	}

	enqueue(id: string, text: string, kind: "steer" | "followUp"): void {
		const entry = { text, kind, sub: undefined as Submission | undefined, cancelled: false };
		this.#queued.set(id, entry);
		void (async () => {
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
				if (entry.cancelled) {
					void this.#harness
						.abortSubmission(sub.id, BACKGROUND_CONTEXT, this.#conversation.id)
						.catch(() => {});
					return;
				}
				this.#submissions.set(sub.id, { id, kind });
				this.#submissionByPakkaId.set(id, sub.id);
				this.#observeSubmission(await sub.status(BACKGROUND_CONTEXT));
			} catch (e) {
				this.markFailed(e instanceof Error ? e : new Error(String(e)));
			}
		})();
	}

	clearQueued(selected?: ReadonlySet<string>): string[] {
		const cleared: string[] = [];
		for (const [id, item] of [...this.#queued.entries()]) {
			if (selected && !selected.has(id)) continue;
			cleared.push(id);
			item.cancelled = true;
			this.#queued.delete(id);
			if (item.sub) {
				this.#submissions.delete(item.sub.id);
				this.#submissionByPakkaId.delete(id);
				void this.#harness
					.abortSubmission(item.sub.id, BACKGROUND_CONTEXT, this.#conversation.id)
					.catch(() => {});
			}
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
			entryId = await this.#harness.commit(async (tx) => {
				const entry = await tx.appendEntry(this.#conversation.id, entryDraft);
				return entry.id;
			}, BACKGROUND_CONTEXT);
		} else {
			// Two appends: intent followed by context edit
			await this.#harness.commit(async (tx) => {
				await tx.appendEntry(this.#conversation.id, {
					kind: "pakka.context-intent",
					// SAFETY: Intent payload conforms to Chord JsonValue
					data: { ...authorData, proposal } as unknown as ChordJsonValue,
				});
			}, BACKGROUND_CONTEXT);

			// SAFETY: Branded EntryId is assigned by numeric cast
			const targetId = Number(proposal.targetId) as unknown as EntryId;
			entryId = await this.#harness.commit(async (tx) => {
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
			}, BACKGROUND_CONTEXT);
		}

		await this.refreshCache();

		const strId = String(entryId);
		if (!this.persisted(strId)) throw new Error("Context commit has no physical receipt");
		return strId;
	}

	branch(id: string): void {
		const targetEntry = this.#allEntries.find((e) => String(e.id) === id);
		if (!targetEntry) throw new Error("Unknown branch target");
		const cutoffIndex = this.#allEntries.findIndex((e) => String(e.id) === id);
		if (cutoffIndex >= 0) {
			this.#activeEntries = this.#allEntries.slice(0, cutoffIndex + 1);
		}
		// SAFETY: Branded EntryId is assigned by numeric cast
		const branchTargetId = Number(id) as unknown as EntryId;
		const prevFork = this.#forkPromise ?? Promise.resolve();
		const forkOp = prevFork
			.then(() =>
				this.#conversation.fork(branchTargetId, { ownership: { kind: "ownerless" } }, BACKGROUND_CONTEXT),
			)
			.then(async (forked) => {
				if (this.#disposed) return;
				this.#conversation = forked;
				await this.#initStream();
				await this.refreshCache();
			})
			.catch((err) => {
				this.markFailed(err instanceof Error ? err : new Error(String(err)));
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
				Promise.all([this.#run, this.#forkPromise, this.#harness.waitForIdle(BACKGROUND_CONTEXT)]),
				failure,
			]);
		} finally {
			const index = this.#failListeners.indexOf(resolveFailure);
			if (index >= 0) this.#failListeners.splice(index, 1);
		}
		await this.refreshCache();
	}

	async dispose(): Promise<void> {
		this.#disposed = true;
		if (this.#stream) {
			await this.#stream.stop().catch(() => {});
			this.#stream = undefined;
		}
		await this.#conversation.abort(BACKGROUND_CONTEXT).catch(() => {});
		await this.#harness.close(BACKGROUND_CONTEXT).catch(() => {});
	}
}
