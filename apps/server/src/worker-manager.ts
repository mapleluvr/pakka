import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeliveryReceipt } from "@pakka/agent";
import type { MasView, SessionEndpoint, SessionPlacement } from "@pakka/mas";
import {
	bounded,
	configuration,
	frozen,
	identity,
	object,
	response,
	type WorkerCommand,
	type WorkerConfiguration,
} from "./worker-ipc.ts";

export interface WorkerManagerOptions {
	readonly placements: Readonly<Record<string, WorkerConfiguration>>;
	readonly maxWorkers: number;
	readonly startupTimeoutMs: number;
	readonly requestTimeoutMs: number;
}
export interface WorkerView {
	readonly key: string;
	readonly phase: "starting" | "ready" | "closed" | "unknown";
	readonly sessionId: string;
	readonly generation: string;
	readonly pid?: number;
}
export interface WorkerManager {
	placement(key: string): SessionPlacement;
	view(): readonly WorkerView[];
	stop(key: string, options?: { readonly force?: boolean }): Promise<void>;
	close(): Promise<void>;
}
type Pending = { resolve(value: unknown): void; reject(error: Error): void; cleanup(): void };
type Slot = {
	key: string;
	phase: WorkerView["phase"];
	generation: string;
	child: ChildProcess;
	config: WorkerConfiguration;
	pending: Map<string, Pending>;
	exit: Promise<void>;
	endpoint?: SessionEndpoint;
	opening?: Promise<SessionEndpoint>;
};
function masView(value: unknown): asserts value is MasView {
	if (
		!object(value) ||
		!identity(value.namespace) ||
		!Number.isSafeInteger(value.version) ||
		!["preparing", "ready", "active", "stopping", "retired", "failed", "unknown", "ended"].includes(
			String(value.phase),
		) ||
		!Array.isArray(value.members) ||
		value.members.some(
			(member) =>
				!object(member) ||
				!identity(member.key) ||
				!identity(member.owner) ||
				!object(member.ref) ||
				!["key", "sessionId", "conversationId", "incarnation", "profile"].every(
					(key) => object(member.ref) && identity(member.ref[key]),
				),
		)
	)
		throw new Error("Malformed worker membership response");
}
function nativeReceipt(value: unknown): asserts value is DeliveryReceipt {
	if (
		!object(value) ||
		!identity(value.id) ||
		!identity(value.requestId) ||
		!identity(value.principal) ||
		!object(value.target) ||
		!["key", "sessionId", "conversationId", "incarnation", "profile"].every(
			(key) => object(value.target) && identity(value.target[key]),
		) ||
		!["queued", "placed", "done", "unanswered", "unknown"].includes(String(value.status))
	)
		throw new Error("Malformed worker native receipt");
}

/** Trusted process/storage manager; no runtime handles or provider configuration escape the bound endpoints. */
export function createWorkerManager(rawOptions: WorkerManagerOptions): WorkerManager {
	if (
		![rawOptions.maxWorkers, rawOptions.startupTimeoutMs, rawOptions.requestTimeoutMs].every(
			(value) => Number.isSafeInteger(value) && value > 0,
		)
	)
		throw new Error("Invalid finite worker manager options");
	const presets = new Map(
		Object.entries(rawOptions.placements).map(([key, value]) => {
			if (!identity(key)) throw new Error("Invalid approved worker key");
			configuration(value);
			if (
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
					value.runtime.reservedSessionId,
				)
			)
				throw new Error("Worker reserved Session identity must be a UUID");
			if (
				!isAbsolute(value.runtime.cwd) ||
				!isAbsolute(value.runtime.dataDir) ||
				value.runtime.reopenSessionFile !== undefined
			)
				throw new Error("Worker storage must use a reserved absolute bootstrap placement");
			return [key, frozen(value)] as const;
		}),
	);
	const options = {
		maxWorkers: rawOptions.maxWorkers,
		startupTimeoutMs: rawOptions.startupTimeoutMs,
		requestTimeoutMs: rawOptions.requestTimeoutMs,
	};
	const slots = new Map<string, Slot>();
	let closed = false;
	function healthy(slot: Slot, starting = false) {
		if (
			closed ||
			(slot.phase !== "ready" && !(starting && slot.phase === "starting")) ||
			!slot.child.connected
		)
			throw new Error("Worker unavailable/closed; outcome unknown");
	}
	function send(
		slot: Slot,
		command: WorkerCommand,
		payload: Record<string, unknown>,
		signal?: AbortSignal,
		starting = false,
	): Promise<unknown> {
		healthy(slot, starting);
		if (signal?.aborted) return Promise.reject(new Error("Worker admission authority revoked"));
		const id = randomUUID(),
			message = { version: 1, generation: slot.generation, id, command, payload };
		bounded(message);
		return new Promise((resolve, reject) => {
			const cancel = () => {
				if (slot.child.connected)
					slot.child.send(
						{
							version: 1,
							generation: slot.generation,
							id: randomUUID(),
							command: "cancel",
							payload: { targetId: id },
						},
						() => {},
					);
			};
			const timer = setTimeout(
				() => {
					cancel();
					const pending = slot.pending.get(id);
					if (pending) {
						pending.cleanup();
						reject(new Error("Worker response timeout; delivery unknown"));
					}
				},
				starting ? options.startupTimeoutMs : options.requestTimeoutMs,
			);
			const cleanup = () => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", cancel);
				slot.pending.delete(id);
			};
			slot.pending.set(id, { resolve, reject, cleanup });
			signal?.addEventListener("abort", cancel, { once: true });
			slot.child.send(message, (error) => {
				if (error && slot.pending.has(id)) {
					cleanup();
					reject(new Error("Worker transport unknown", { cause: error }));
				}
			});
		});
	}
	async function open(key: string, expectedSessionId?: string): Promise<SessionEndpoint> {
		if (closed) throw new Error("Worker manager closed");
		const preset = presets.get(key);
		if (!preset) throw new Error("Unapproved worker placement");
		if (expectedSessionId && expectedSessionId !== preset.runtime.reservedSessionId)
			throw new Error("Worker Session identity changed");
		const existing = slots.get(key);
		if (existing?.phase === "unknown")
			throw new Error("Worker ownership/claim unknown; no replacement allowed");
		if (existing?.opening) return existing.opening;
		if (existing?.phase === "ready") {
			healthy(existing);
			return existing.endpoint!;
		}
		if (
			[...slots.values()].filter((slot) => slot.phase === "ready" || slot.phase === "starting").length >=
			options.maxWorkers
		)
			throw new Error("Worker capacity exhausted");
		let config = structuredClone(preset);
		const storage = join(config.runtime.dataDir, "sessions", config.runtime.reservedSessionId),
			file = join(storage, "main.jsonl");
		if (existsSync(storage)) {
			if (!existsSync(file)) throw new Error("Reserved worker storage initialization unknown");
			config = { ...config, runtime: { ...config.runtime, reopenSessionFile: file } };
		}
		const env: NodeJS.ProcessEnv = {};
		for (const key of ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "COMSPEC", "TEMP", "TMP"])
			if (process.env[key]) env[key] = process.env[key];
		Object.assign(env, {
			HOME: config.runtime.dataDir,
			USERPROFILE: config.runtime.dataDir,
			PI_CODING_AGENT_DIR: join(config.runtime.dataDir, "worker-profile"),
			DO_NOT_TRACK: "1",
			PI_OFFLINE: "1",
			NO_COLOR: "1",
		});
		const child = fork(
			fileURLToPath(
				new URL(import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js", import.meta.url),
			),
			[],
			{ env, cwd: config.runtime.cwd, execArgv: [], stdio: ["ignore", "ignore", "ignore", "ipc"] },
		);
		let exited!: () => void;
		const slot: Slot = {
			key,
			phase: "starting",
			generation: randomUUID(),
			child,
			config,
			pending: new Map(),
			exit: new Promise<void>((resolve) => {
				exited = resolve;
			}),
		};
		slots.set(key, slot);
		const seal = (error: Error) => {
			if (slot.phase !== "closed") slot.phase = "unknown";
			for (const pending of [...slot.pending.values()]) {
				pending.cleanup();
				pending.reject(error);
			}
		};
		child.on("error", (error) => {
			seal(new Error("Worker process unavailable", { cause: error }));
			exited();
		});
		child.once("exit", () => {
			seal(new Error("Worker exited; outcome unknown"));
			exited();
		});
		child.on("message", (raw) => {
			try {
				response(raw);
				if (raw.generation !== slot.generation) throw new Error("Worker response generation mismatch");
				const pending = slot.pending.get(raw.id);
				if (!pending) return;
				pending.cleanup();
				if (raw.ok) pending.resolve(raw.value);
				else pending.reject(new Error(raw.error));
			} catch (error) {
				seal(new Error("Worker protocol unknown", { cause: error }));
			}
		});
		const endpoint = Object.freeze<SessionEndpoint>({
			view: async () => {
				const value = await send(slot, "view", {});
				if (
					!object(value) ||
					value.sessionId !== config.runtime.reservedSessionId ||
					value.isolation !== "worker"
				)
					throw new Error("Worker Session identity response invalid");
				masView(value.mas);
				return frozen({
					sessionId: config.runtime.reservedSessionId,
					isolation: "worker" as const,
					mas: value.mas,
				});
			},
			prepare: async (members) => {
				const value = await send(slot, "prepare", { members });
				masView(value);
				return frozen(value);
			},
			activate: async () => {
				const value = await send(slot, "activate", {});
				masView(value);
				return frozen(value);
			},
			deliver: async (envelope, signal) => {
				const value = await send(slot, "deliver", { envelope }, signal);
				nativeReceipt(value);
				return frozen(value);
			},
			receipt: async (envelope, nativeId) => {
				const value = await send(slot, "receipt", { envelope, nativeId });
				nativeReceipt(value);
				return frozen(value);
			},
			wait: async (envelope, nativeId) => {
				const value = await send(slot, "wait", { envelope, nativeId });
				nativeReceipt(value);
				return frozen(value);
			},
		});
		slot.opening = (async () => {
			try {
				await send(
					slot,
					"init",
					{
						runtime: config.runtime,
						catalog: config.catalog,
						...(config.devpack ? { devpack: config.devpack } : {}),
					},
					undefined,
					true,
				);
				slot.phase = "ready";
				slot.endpoint = endpoint;
				await endpoint.view();
				return endpoint;
			} catch (error) {
				slot.phase = "unknown";
				child.kill();
				await slot.exit;
				throw new Error("Worker initialization unknown/unavailable: " + String(error));
			} finally {
				slot.opening = undefined;
			}
		})();
		return slot.opening;
	}
	async function stop(key: string, control: { readonly force?: boolean } = {}) {
		const slot = slots.get(key);
		if (!slot || slot.phase === "closed") return;
		if (control.force || slot.phase === "unknown") {
			slot.phase = "unknown";
			slot.child.kill();
			await slot.exit;
			return;
		}
		if (slot.opening) await slot.opening;
		try {
			await send(slot, "close", {});
			slot.phase = "closed";
			await slot.exit;
		} catch (error) {
			slot.phase = "unknown";
			slot.child.kill();
			await slot.exit;
			throw error;
		}
	}
	return Object.freeze({
		placement: (key: string) => {
			if (!presets.has(key)) throw new Error("Unapproved worker placement");
			return Object.freeze({ open: (expected?: string) => open(key, expected) });
		},
		view: () =>
			frozen(
				[...slots.values()].map((slot) => ({
					key: slot.key,
					phase: slot.phase,
					sessionId: slot.config.runtime.reservedSessionId,
					generation: slot.generation,
					...(slot.child.pid ? { pid: slot.child.pid } : {}),
				})),
			),
		stop,
		close: async () => {
			if (closed) return;
			const results = await Promise.allSettled([...slots.keys()].map((key) => stop(key)));
			closed = true;
			const failed = results.find((result) => result.status === "rejected");
			if (failed?.status === "rejected") throw failed.reason;
		},
	});
}
