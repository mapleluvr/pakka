import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type AgentSession,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { HostOptions, Proposal } from "./types.ts";

export type Notice =
	| { type: "changed" }
	| { type: "consumed"; id: string }
	| { type: "committed"; id: string; entryId: string }
	| { type: "unknown"; id: string; reason: string }
	| { type: "failed"; reason: string };
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
	private constructor(session: AgentSession, notify: (notice: Notice) => void) {
		this.#session = session;
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
	static async create(options: HostOptions, notify: (notice: Notice) => void): Promise<PiAdapter> {
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
		const { session } = await createAgentSession({
			cwd: options.cwd,
			agentDir: options.dataDir,
			modelRuntime: runtime,
			model,
			thinkingLevel: "off",
			resourceLoader,
			settingsManager,
			sessionManager: SessionManager.create(options.cwd, join(options.dataDir, "sessions")),
			tools: (options.tools ?? []).map((t) => t.name),
			customTools: (options.tools ?? []).map((t) => ({
				name: t.name,
				label: t.name,
				description: t.description,
				parameters: structuredClone(t.parameters) as ToolDefinition["parameters"],
				execute: async (_id, args, signal) => ({
					content: [
						{
							type: "text" as const,
							text: await t.execute(structuredClone(args) as Record<string, unknown>, signal),
						},
					],
					details: {},
				}),
			})),
		});
		if (options.steeringMode) session.setSteeringMode(options.steeringMode);
		return new PiAdapter(session, notify);
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
	async reload(): Promise<void> {
		await this.#session.reload();
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
