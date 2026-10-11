import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage, PrepareRequest } from "@earendil-works/pi-agent-core";
import { type Model, type Api, type Usage, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { copy, hash } from "../src/artifact-journal.ts";
import type { AdapterControl, AdapterFrame, Notice } from "../src/durable-adapter.ts";
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
} from "../src/types.ts";

function clean<T>(value: unknown): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
function usageDTO(usage: Usage): UsageDTO {
	return {
		input: usage.input,
		output: usage.output,
		cacheRead: usage.cacheRead,
		cacheWrite: usage.cacheWrite,
		totalTokens: usage.totalTokens,
		cost: usage.cost.total || null,
	};
}

export function messageText(message: unknown): string {
	const m = message as { content?: unknown; summary?: string };
	if (m.summary) return m.summary;
	if (typeof m.content === "string") return m.content;
	return Array.isArray(m.content) ? m.content.map((b) => b?.text ?? "").join("\n") : "";
}

/** Internal adapter. Never return this instance or any Pi object to a client. */
export class PiAdapter {
	#session: AgentSession;
	#notify: (notice: Notice) => void;
	#run: Promise<void> | undefined;
	#primary: string | undefined;
	#owned = new Map<AgentMessage, string>();
	#kinds = new Map<AgentMessage, "steer" | "followUp">();
	#unsubscribe: () => void;
	#control: AdapterControl;
	#options: HostOptions;
	#runScope: object | undefined;
	#prepare: PrepareRequest | undefined;
	#payload: SimpleStreamOptions["onPayload"];
	#permit: { check(): void } | undefined;
	#inferenceModels = new Map<
		string,
		{ model: Model<Api>; apiKey: string; headers?: Record<string, string> }
	>();
	private constructor(
		session: AgentSession,
		notify: (notice: Notice) => void,
		options: HostOptions,
		control: AdapterControl,
	) {
		this.#session = session;
		this.#options = {
			...options,
			inference: options.inference ? structuredClone(options.inference) : undefined,
		};
		this.#control = control;
		for (const definition of options.inference?.models ?? []) {
			const provider = "pakka-summary-" + hash(definition.key).slice(0, 16);
			session.modelRuntime.registerProvider(provider, {
				api: "openai-completions",
				baseUrl: definition.endpoint,
				apiKey: definition.apiKey,
				models: [
					{
						id: definition.model,
						name: definition.name ?? definition.model,
						reasoning: definition.reasoning ?? false,
						input: ["text"],
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
						contextWindow: definition.contextWindow,
						maxTokens: definition.maxTokens,
						compat: { maxTokensField: "max_tokens", supportsMidConvoSystemMessages: true },
					},
				],
			});
			const model = session.modelRuntime.getModel(provider, definition.model);
			if (!model) throw new Error("Inference model unavailable");
			this.#inferenceModels.set(definition.key, {
				model,
				apiKey: definition.apiKey,
				headers: definition.headers ? { ...definition.headers } : undefined,
			});
		}
		this.#installGate();
		this.#notify = notify;
		// Pi's own listener is registered first. This listener runs after its append.
		this.#unsubscribe = session.agent.subscribe((event) => {
			if ((event.type === "message_start" || event.type === "message_end") && event.message.role === "user") {
				if (!this.#owned.has(event.message) && this.#primary) {
					this.#owned.set(event.message, this.#primary);
					this.#primary = undefined;
				}
				const id = this.#owned.get(event.message);
				if (id && event.type === "message_start") notify({ type: "consumed", id });
			}
			if (event.type === "message_end") {
				notify({ type: "changed" });
				this.#reconcile(false);
			}
		});
	}
	static async create(
		options: HostOptions,
		notify: (notice: Notice) => void,
		control: AdapterControl,
	): Promise<PiAdapter> {
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
			const endpoint = new URL(model.endpoint);
			if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("Unsupported inference endpoint");
			modelKeys.add(model.key);
		}
		for (const policy of options.inference?.policies ?? [])
			if (policy.modelKeys.some((key) => !modelKeys.has(key)))
				throw new Error("Inference model policy is not allowlisted");
		await mkdir(options.dataDir, { recursive: true });
		const settingsManager = SettingsManager.inMemory(
			{ compaction: { enabled: false }, retry: { enabled: false }, defaultProjectTrust: "never" },
			{ projectTrusted: false },
		);
		const resourceLoader = new DefaultResourceLoader({
			cwd: options.cwd,
			agentDir: options.dataDir,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			systemPrompt: options.systemPrompt ?? "You are a Pakka assistant.",
		});
		await resourceLoader.reload();
		const runtime = await ModelRuntime.create({
			authPath: join(options.dataDir, "auth.json"),
			modelsPath: null,
			allowModelNetwork: false,
			refreshOnCreate: false,
		});
		runtime.registerProvider("pakka", {
			api: "openai-completions",
			baseUrl: options.endpoint,
			apiKey: options.apiKey,
			models: [
				{
					id: options.model,
					name: options.model,
					reasoning: false,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 4096,
				},
			],
		});
		const model = runtime.getModel("pakka", options.model);
		if (!model) throw new Error("Configured model unavailable");
		const sessions = join(options.dataDir, "sessions");
		await mkdir(sessions, { recursive: true });
		let manager: SessionManager;
		if (options.reopenSessionFile !== undefined) {
			const file = realpathSync(options.reopenSessionFile);
			const inside = relative(realpathSync(sessions), file);
			if (!inside || inside.startsWith("..") || isAbsolute(inside))
				throw new Error("Reopen must be a Pakka-owned session");
			const text = readFileSync(file, "utf8");
			if (!text.endsWith("\n")) throw new Error("Corrupt reopen session");
			const entries = text
				.trimEnd()
				.split("\n")
				.map((line) => JSON.parse(line));
			const header = entries.shift();
			if (
				header?.type !== "session" ||
				typeof header.id !== "string" ||
				resolve(header.cwd) !== resolve(options.cwd)
			)
				throw new Error("Invalid reopen header");
			const marker = JSON.parse(readFileSync(file + ".pakka.json", "utf8"));
			if (
				marker.schema !== "pakka.session.v1" ||
				marker.sessionId !== header.id ||
				marker.cwd !== resolve(options.cwd)
			)
				throw new Error("Missing Pakka reopen provenance");
			const ids = new Set<string>();
			for (const entry of entries) {
				if (!entry.id || ids.has(entry.id) || (entry.parentId !== null && !ids.has(entry.parentId)))
					throw new Error("Corrupt reopen parentage");
				ids.add(entry.id);
			}
			manager = SessionManager.open(file, sessions, options.cwd);
			if (manager.getSessionId() !== header.id || manager.getEntries().length !== entries.length)
				throw new Error("Reopen identity mismatch");
		} else manager = SessionManager.create(options.cwd, sessions);
		let adapter: PiAdapter | undefined;
		const { session } = await createAgentSession({
			cwd: options.cwd,
			agentDir: options.dataDir,
			modelRuntime: runtime,
			model,
			thinkingLevel: "off",
			resourceLoader,
			settingsManager,
			sessionManager: manager,
			tools: (options.tools ?? []).map((t) => t.name),
			customTools: (options.tools ?? []).map((t) => ({
				name: t.name,
				label: t.name,
				description: t.description,
				parameters: structuredClone(t.parameters) as ToolDefinition["parameters"],
				execute: async (_id, args, signal) => {
					if (!adapter || !adapter.#runScope) throw new Error("Tool has no run invocation scope");
					return control.invoke(adapter.#runScope, async (scope) => ({
						content: [
							{
								type: "text" as const,
								text: await t.execute(clean<Record<string, unknown>>(args), signal, scope),
							},
						],
						details: {},
					}));
				},
			})),
		});
		if (options.steeringMode) session.setSteeringMode(options.steeringMode);
		const markerPath = session.sessionFile! + ".pakka.json";
		if (!existsSync(markerPath))
			writeFileSync(
				markerPath,
				JSON.stringify({
					schema: "pakka.session.v1",
					sessionId: session.sessionId,
					cwd: resolve(options.cwd),
				}) + "\n",
				{ flag: "wx" },
			);
		adapter = new PiAdapter(session, notify, options, control);
		return adapter;
	}
	#installGate(): void {
		const agent = this.#session.agent;
		// Callback slots only. Keep Pi's canonical projection, hidden-loadout and auth chain intact.
		if (agent.prepareRequest !== this.#prepare) {
			const previous = agent.prepareRequest;
			this.#prepare = async (request, signal) => {
				this.#permit = undefined;
				const installed = await previous?.(request, signal);
				const context = installed?.context ?? request.context;
				const canonical = this.#session.sessionManager.buildSessionProjection().messages;
				if (hash(context.messages) !== hash(canonical)) throw new Error("Pi projection alignment changed");
				const permitted = await this.#control.project(signal);
				permitted.check();
				if ("block" in permitted) throw new Error(permitted.block);
				this.#permit = permitted;
				return { ...installed, context: { ...context, messages: clean<AgentMessage[]>(permitted.messages) } };
			};
			agent.prepareRequest = this.#prepare;
		}
		if (agent.onPayload !== this.#payload || !this.#payload) {
			const previous = agent.onPayload;
			this.#payload = async (payload, model) => {
				if (!this.#permit) throw new Error("Provider request has no host authorization");
				this.#permit.check();
				const result = await previous?.(payload, model);
				this.#permit.check();
				return result;
			};
			agent.onPayload = this.#payload;
		}
	}
	frame(): AdapterFrame {
		const manager = this.#session.sessionManager;
		const branch = manager.getBranch();
		const projection = manager.buildSessionProjection();
		const total: { -readonly [K in keyof UsageDTO]: UsageDTO[K] } = {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: 0,
		};
		for (const entry of branch)
			if (entry.type === "message" && entry.message.role === "assistant") {
				const usage = usageDTO(entry.message.usage);
				for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const)
					total[key] += usage[key];
				total.cost = total.cost === null || usage.cost === null ? null : total.cost + usage.cost;
			}
		const current = this.#session.model!;
		return copy({
			sessionId: this.#session.sessionId,
			cwd: manager.getCwd(),
			leafId: manager.getLeafId(),
			entries: manager.getEntries().map((entry) => ({
				id: entry.id,
				parentId: entry.parentId,
				type: entry.type,
				raw: clean<ContextFrame["entries"][number]["raw"]>(entry),
			})),
			activeEntryIds: branch.map((e) => e.id),
			projection: projection.entries.map(({ sourceEntry, messages }) => ({
				sourceEntryId: sourceEntry.id,
				messages: clean<MessageDTO[]>(messages),
				boundary: messages.some((m) => m.role === "system")
					? ("system" as const)
					: ["compaction", "branch_summary"].includes(sourceEntry.type)
						? ("host-summary" as const)
						: null,
				excluded: messages.some((m) => m.role === "bashExecution" && m.excludeFromContext === true),
				fingerprint: hash([
					sourceEntry,
					messages,
					branch.filter((e) => e.type === "context_edit" && e.targetId === sourceEntry.id),
				]),
			})),
			model: {
				key: "session",
				model: current.id,
				name: current.name,
				reasoning: current.reasoning,
				contextWindow: current.contextWindow,
				maxOutputTokens: current.maxTokens,
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
		const answer = await this.#session.modelRuntime.completeSimple(
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
		// Pi initializes missing usage to zero and exposes no presence bit. Zero
		// therefore cannot distinguish an absent report from genuinely free work.
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
			...(known ? { usage: usageDTO(answer.usage) } : {}),
		});
	}
	get busy(): boolean {
		return this.#run !== undefined || !this.#session.isIdle;
	}
	get canQueue(): boolean {
		return this.#session.isStreaming;
	}
	snapshot() {
		const manager = this.#session.sessionManager;
		return {
			sessionId: this.#session.sessionId,
			sessionFile: this.#session.sessionFile!,
			leafId: manager.getLeafId(),
			entries: manager.getEntries().map((e) => ({
				id: e.id,
				type: e.type,
				...(e.type === "message" ? { role: e.message.role, text: messageText(e.message) } : {}),
			})),
			context: manager.buildSessionProjection().messages.map((m) => ({ role: m.role, text: messageText(m) })),
			autoCompaction: this.#session.autoCompactionEnabled,
		};
	}
	start(id: string, text: string, canStart: () => boolean): void {
		if (this.busy) throw new Error("busy");
		this.#primary = id;
		this.#runScope = this.#control.runScope();
		const promise = this.#session.prompt(text, {
			expandPromptTemplates: false,
			preflightResult: (state) => {
				if (state === "started" && !canStart()) throw new Error("Start invalidated by lifecycle transition");
			},
		});
		this.#run = promise
			.then(
				() => {
					this.#reconcile(true);
					const last = this.#session.messages.at(-1);
					if (last?.role === "assistant" && last.stopReason === "error")
						this.#notify({ type: "failed", reason: last.errorMessage ?? "Provider failed" });
				},
				(error) => {
					this.#reconcile(true);
					this.#notify({ type: "failed", reason: error instanceof Error ? error.message : String(error) });
				},
			)
			.finally(() => {
				if (this.#primary) {
					this.#notify({
						type: "unknown",
						id: this.#primary,
						reason: "Prompt did not produce a verifiable entry",
					});
					this.#primary = undefined;
				}
				this.#run = undefined;
				this.#runScope = undefined;
				this.#permit = undefined;
			});
	}
	enqueue(id: string, text: string, kind: "steer" | "followUp"): void {
		if (!this.canQueue) throw new Error("No active run for native queue");
		const message: AgentMessage = { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
		this.#owned.set(message, id);
		this.#kinds.set(message, kind);
		if (kind === "steer") this.#session.agent.steer(message);
		else this.#session.agent.followUp(message);
	}
	clearQueued(selected?: ReadonlySet<string>): string[] {
		const agent = this.#session.agent;
		const steeringMode = agent.steeringMode,
			followUpMode = agent.followUpMode;
		const removed: string[] = [];
		try {
			agent.steeringMode = "all";
			agent.followUpMode = "all";
			const steering = agent.peekQueuedMessages().filter((m) => this.#kinds.get(m) === "steer");
			agent.clearSteeringQueue();
			const follow = agent.peekQueuedMessages().filter((m) => this.#kinds.get(m) === "followUp");
			agent.clearFollowUpQueue();
			for (const [kind, messages] of [
				["steer", steering],
				["followUp", follow],
			] as const) {
				for (const message of messages) {
					const id = this.#owned.get(message)!;
					if (!selected || selected.has(id)) {
						removed.push(id);
						this.#owned.delete(message);
						this.#kinds.delete(message);
					} else if (kind === "steer") agent.steer(message);
					else agent.followUp(message);
				}
			}
		} finally {
			agent.steeringMode = steeringMode;
			agent.followUpMode = followUpMode;
		}
		return removed;
	}
	#reconcile(final: boolean): void {
		for (const [message, id] of this.#owned) {
			const entry = this.#session.sessionManager
				.getEntries()
				.find((e) => e.type === "message" && e.message === message);
			try {
				if (entry && this.persisted(entry.id)) {
					this.#owned.delete(message);
					this.#kinds.delete(message);
					this.#notify({ type: "committed", id, entryId: entry.id });
					continue;
				}
			} catch {
				/* final reconciliation converts absent/unreadable evidence into unknown */
			}
			if (final) {
				this.#owned.delete(message);
				this.#kinds.delete(message);
				this.#notify({ type: "unknown", id, reason: "No physical entry receipt" });
			}
		}
	}
	persisted(id: string): boolean {
		try {
			return readFileSync(this.#session.sessionFile!, "utf8")
				.split("\n")
				.filter(Boolean)
				.some((line) => JSON.parse(line).id === id);
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw e;
		}
	}
	validate(proposal: Proposal): boolean {
		if (!proposal || typeof proposal !== "object") return false;
		const manager = this.#session.sessionManager;
		const branch = manager.getBranch();
		if (proposal.type === "cut")
			return (
				typeof proposal.summary === "string" &&
				proposal.summary.trim().length > 0 &&
				Number.isFinite(proposal.tokensBefore) &&
				proposal.tokensBefore >= 0 &&
				(proposal.firstKeptEntryId === null || branch.some((e) => e.id === proposal.firstKeptEntryId))
			);
		if (proposal.type !== "edit" || (proposal.text !== null && typeof proposal.text !== "string"))
			return false;
		return branch.some(
			(e) =>
				e.id === proposal.targetId &&
				(e.type === "custom_message" ||
					(e.type === "message" && ["user", "assistant", "toolResult"].includes(e.message.role))),
		);
	}
	commit(proposal: Proposal, author: { principal: string; strategyId: string; operationId: string }): string {
		const manager = this.#session.sessionManager;
		let entryId: string;
		if (proposal.type === "cut") {
			entryId = manager.appendCompaction(proposal.summary, proposal.firstKeptEntryId, proposal.tokensBefore, {
				pakka: author,
			});
		} else {
			// Two appends, deliberately not presented as an atomic transaction.
			manager.appendCustomEntry("pakka.context-intent", { ...author, proposal });
			entryId = manager.appendContextEdit(
				proposal.targetId,
				proposal.text === null ? null : { content: proposal.text },
			);
		}
		this.#session.refreshContext();
		if (!this.persisted(entryId)) throw new Error("Context commit has no physical receipt");
		return entryId;
	}
	branch(id: string): void {
		if (!this.#session.sessionManager.getEntry(id)) throw new Error("Unknown branch target");
		this.#session.sessionManager.branch(id);
		this.#session.refreshContext();
	}
	replacement(notify: (notice: Notice) => void, control: AdapterControl): Promise<PiAdapter> {
		return PiAdapter.create({ ...this.#options, reopenSessionFile: undefined }, notify, control);
	}
	async reload(): Promise<void> {
		await this.#session.reload();
		this.#installGate();
	}
	async abortAndIdle(): Promise<void> {
		await this.#session.abort();
		await this.idle();
	}
	async idle(): Promise<void> {
		await this.#run;
		await this.#session.waitForIdle();
	}
	async dispose(): Promise<void> {
		await this.#session.abort();
		await this.idle();
		this.#unsubscribe();
		this.#session.dispose();
	}
}
