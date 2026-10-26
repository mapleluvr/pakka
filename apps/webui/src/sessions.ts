import { createHash, randomUUID } from "node:crypto";
import type { Runtime, JsonObject, ConversationRef } from "@pakka/agent";
import type { PocketCreationDefaults, PocketDirectoryView } from "@pakka/protocol/pocket";
import type {
	PocketAuthority,
	PocketPeople,
	PocketWorkspace,
	PocketWorkspaceClient,
} from "@pakka/server/pocket";
import { resolveDirectory, listDirectories } from "@pakka/server/pocket";

export interface ManagedSession {
	readonly id: string;
	readonly name: string;
	readonly cwd?: string;
	readonly status: "ready" | "unknown" | "unavailable";
}
export interface SessionCreation {
	readonly requestId: string;
	readonly name: string;
	readonly cwd: string;
}
interface Registration extends SessionCreation {
	id: string;
	actorId: string;
	fingerprint: string;
	status: "ready" | "unknown";
}
export interface ManagedSessions {
	readonly workspace: PocketWorkspace;
	/** Trusted composition only. References remain native; this is not a combined Runtime. */
	runtimeFor(ref: Pick<ConversationRef, "sessionId">): Runtime;
	runtimes(): readonly Runtime[];
	list(actor: PocketAuthority): Promise<readonly ManagedSession[]>;
	defaults(actor: PocketAuthority): Promise<PocketCreationDefaults>;
	directories(
		actor: PocketAuthority,
		input: { readonly path?: string; readonly places?: readonly string[] },
	): Promise<PocketDirectoryView>;
	create(actor: PocketAuthority, input: SessionCreation): Promise<ManagedSession>;
	lookup(actor: PocketAuthority, input: SessionCreation): Promise<ManagedSession | null>;
	close(): Promise<void>;
}
export class SessionCreationConflict extends Error {}
export class SessionCreationRefused extends Error {}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const id = (value: unknown): value is string =>
	typeof value === "string" &&
	/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) &&
	!["constructor", "prototype", "__proto__"].includes(value);
const name = (value: unknown): value is string =>
	typeof value === "string" && !!value.trim() && value.length <= 80 && !/[\x00-\x1f\x7f]/.test(value);
const uuid = (value: unknown): value is string =>
	typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
function decode(data: JsonObject, version: number): Registration[] {
	if (version === 0 && Object.keys(data).length === 0) return [];
	if (
		Object.keys(data).sort().join(",") !== "registrations,schema" ||
		data.schema !== 1 ||
		!Array.isArray(data.registrations) ||
		data.registrations.length > 31
	)
		throw Error("Invalid managed Session registry");
	const rows: Registration[] = [];
	for (const raw of data.registrations) {
		if (
			!raw ||
			typeof raw !== "object" ||
			Array.isArray(raw) ||
			Object.keys(raw).sort().join(",") !== "actorId,cwd,fingerprint,id,name,requestId,status" ||
			!uuid(raw.id) ||
			!id(raw.actorId) ||
			!id(raw.requestId) ||
			!name(raw.name) ||
			typeof raw.cwd !== "string" ||
			!raw.cwd ||
			raw.cwd.length > 8192 ||
			typeof raw.fingerprint !== "string" ||
			!/^[a-f0-9]{64}$/.test(raw.fingerprint) ||
			!["ready", "unknown"].includes(String(raw.status))
		)
			throw Error("Invalid managed Session registration");
		rows.push({
			id: raw.id,
			actorId: raw.actorId,
			requestId: raw.requestId,
			name: raw.name,
			cwd: raw.cwd,
			fingerprint: raw.fingerprint,
			status: raw.status === "ready" ? "ready" : "unknown",
		});
	}
	if (
		new Set(rows.map((row) => row.id)).size !== rows.length ||
		new Set(rows.map((row) => JSON.stringify([row.actorId, row.requestId]))).size !== rows.length
	)
		throw Error("Duplicate managed Session registration");
	return rows;
}

function registryData(rows: readonly Registration[]): JsonObject {
	return {
		schema: 1,
		registrations: rows.map((row) => ({
			id: row.id,
			actorId: row.actorId,
			requestId: row.requestId,
			name: row.name,
			cwd: row.cwd,
			fingerprint: row.fingerprint,
			status: row.status,
		})),
	};
}

/** Explicit Session directory: one public Runtime and one writer for each registered storage. */
export async function createManagedSessions(options: {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly workspace: PocketWorkspace;
	readonly profiles: readonly string[];
	readonly open: (input: {
		readonly id: string;
		readonly cwd: string;
		readonly reopen: boolean;
	}) => Promise<Runtime>;
	readonly workspaceFor: (runtime: Runtime) => PocketWorkspace;
}): Promise<ManagedSessions> {
	const { runtime, people } = options;
	const rootId = runtime.view().sessionId;
	const store = runtime.store({ namespace: "pocket.sessions", maxBytes: 65536 });
	const entries = new Map<string, { runtime: Runtime; workspace: PocketWorkspace; published: boolean }>([
		[rootId, { runtime, workspace: options.workspace, published: true }],
	]);
	let tail: Promise<unknown> = Promise.resolve();
	const serial = <T>(operation: () => Promise<T>): Promise<T> => {
		const running = tail.then(operation);
		tail = running.then(
			() => {},
			() => {},
		);
		return running;
	};
	const currentRows = async () => {
		const saved = await store.snapshot();
		return { version: saved.version, rows: decode(saved.data, saved.version) };
	};
	const remember = (row: Registration, opened: Runtime) => {
		if (opened.view().sessionId !== row.id || opened.view().phase !== "ready" || entries.has(row.id))
			throw Error("Managed Session identity conflict");
		entries.set(row.id, {
			runtime: opened,
			workspace: options.workspaceFor(opened),
			published: row.status === "ready",
		});
	};
	try {
		for (const row of (await currentRows()).rows) {
			// Unconfirmed initialization never re-enters native creation or clears a writer lock.
			if (row.status === "ready") {
				const opened = await options.open({ id: row.id, cwd: row.cwd, reopen: true });
				try {
					remember(row, opened);
				} catch (error) {
					await opened.close();
					throw error;
				}
			}
		}
	} catch (error) {
		await Promise.allSettled(
			[...entries.values()]
				.filter((entry) => entry.runtime !== runtime)
				.map((entry) => entry.runtime.close()),
		);
		throw error;
	}
	const entry = (ref: Pick<ConversationRef, "sessionId">) => {
		const found = entries.get(ref.sessionId);
		if (!found?.published) throw Error("Managed Session unavailable");
		return found;
	};
	const clientFor = (actor: PocketAuthority, ref: Pick<ConversationRef, "sessionId">) =>
		entry(ref).workspace.bind(actor);
	const publicRow = (row: Registration): ManagedSession =>
		Object.freeze({
			id: row.id,
			name: row.name,
			cwd: row.cwd,
			status:
				row.status === "ready" &&
				(!entries.get(row.id)?.published || entries.get(row.id)?.runtime.view().phase !== "ready")
					? "unavailable"
					: row.status,
		});
	const validInput = (raw: SessionCreation): SessionCreation => {
		if (
			!raw ||
			Object.keys(raw).sort().join(",") !== "cwd,name,requestId" ||
			!id(raw.requestId) ||
			!name(raw.name) ||
			typeof raw.cwd !== "string" ||
			!raw.cwd ||
			raw.cwd.length > 8192
		)
			throw new SessionCreationRefused("Invalid Session creation input");
		return Object.freeze({ requestId: raw.requestId, name: raw.name.trim(), cwd: raw.cwd });
	};
	const checkCreate = (actor: PocketAuthority) => people.check(actor, "create");
	const findOriginal = (rows: Registration[], actorId: string, input: SessionCreation) => {
		const found = rows.find((row) => row.actorId === actorId && row.requestId === input.requestId);
		if (found && found.fingerprint !== digest(input))
			throw new SessionCreationConflict("Session request conflict");
		return found;
	};
	// Keep native receipt IDs intact. The parent is an independent routing field, never an invented receipt alias.
	const routeReceipt = (
		actor: PocketAuthority,
		nativeId: string,
		action: "receipt" | "wait" | "withdraw",
		sessionId = rootId,
		signal?: AbortSignal,
	) => {
		const client = clientFor(actor, { sessionId });
		return action === "wait" ? client.wait(nativeId, signal) : client[action](nativeId);
	};
	const workspace = Object.freeze<PocketWorkspace>({
		registerResources: options.workspace.registerResources?.bind(options.workspace),
		checkScheduledInput: (actorId, ref) => entry(ref).workspace.checkScheduledInput(actorId, ref),
		submitScheduled: (actorId, ref, input, check) =>
			entry(ref).workspace.submitScheduled(actorId, ref, input, check),
		bind: (actor): PocketWorkspaceClient => {
			people.current(actor);
			const navigation = async () => {
				const rows = [];
				for (const item of entries.values()) {
					if (item.published && item.runtime.view().phase === "ready")
						rows.push(
							...(await item.workspace.bind(actor).navigation()).map((row) =>
								Object.freeze({ ...row, resourceId: people.resourceId(row.ref) }),
							),
						);
				}
				people.current(actor);
				return Object.freeze(rows);
			};
			const destination = (input: Parameters<PocketWorkspaceClient["create"]>[0]) => ({
				sessionId: input.sessionId ?? input.inherit?.sessionId ?? rootId,
			});
			return Object.freeze<PocketWorkspaceClient>({
				list: async () => Object.freeze((await navigation()).map((row) => row.ref)),
				navigation,
				configuration: (ref) => clientFor(actor, ref).configuration(ref),
				setMetadata: async (ref, input) =>
					Object.freeze({
						...(await clientFor(actor, ref).setMetadata(ref, input)),
						resourceId: people.resourceId(ref),
					}),
				metadataReceipt: async (ref, input) => {
					const row = await clientFor(actor, ref).metadataReceipt(ref, input);
					return row && Object.freeze({ ...row, resourceId: people.resourceId(ref) });
				},
				create: (input) => clientFor(actor, destination(input)).create(input),
				creationReceipt: (input, fork) =>
					clientFor(actor, fork?.source ?? destination(input)).creationReceipt(input, fork),
				configure: (ref, profile) => clientFor(actor, ref).configure(ref, profile),
				configureAgent: (ref, change) => clientFor(actor, ref).configureAgent(ref, change),
				directories: (ref, input) => clientFor(actor, ref).directories(ref, input),
				fork: (ref, input) => clientFor(actor, ref).fork(ref, input),
				read: (ref, page) => clientFor(actor, ref).read(ref, page),
				display: (ref, input) => clientFor(actor, ref).display(ref, input),
				submit: (ref, input) => clientFor(actor, ref).submit(ref, input),
				receipt: (nativeId, sessionId) => routeReceipt(actor, nativeId, "receipt", sessionId),
				wait: (nativeId, signal, sessionId) => routeReceipt(actor, nativeId, "wait", sessionId, signal),
				withdraw: (nativeId, sessionId) => routeReceipt(actor, nativeId, "withdraw", sessionId),
				abort: (ref) => clientFor(actor, ref).abort(ref),
			});
		},
	});
	const creationDefaults = async (actor: PocketAuthority): Promise<PocketCreationDefaults> => {
		checkCreate(actor);
		const profile = options.profiles[0]!;
		const template =
			profile === "default"
				? await runtime.configuration(runtime.view().conversations.find((ref) => ref.key === "root")!)
				: runtime.profileChoices().find((row) => row.id === profile)!;
		checkCreate(actor);
		const models = new Map<string, { readonly id: string; readonly model: string }>();
		for (const row of runtime.profileChoices())
			if (!models.has(row.model)) models.set(row.model, Object.freeze({ id: row.id, model: row.model }));
		const choices = Object.freeze([...models.values()]);
		return Object.freeze({ profile, model: template.model, cwd: template.cwd, choices });
	};
	return Object.freeze<ManagedSessions>({
		workspace,
		runtimeFor: (ref) => entry(ref).runtime,
		runtimes: () =>
			Object.freeze([...entries.values()].filter((value) => value.published).map((value) => value.runtime)),
		list: async (actor) => {
			const person = people.current(actor);
			const rows: ManagedSession[] = [];
			let showCwd = false;
			try {
				people.check(actor, "create");
				showCwd = true;
			} catch {
				people.current(actor);
			}
			const view = (row: ManagedSession): ManagedSession => {
				if (showCwd) return row;
				const { cwd: _cwd, ...visible } = row;
				return Object.freeze(visible);
			};
			const rootNavigation = await options.workspace.bind(actor).navigation();
			if (rootNavigation.length)
				rows.push(
					view(
						Object.freeze({
							id: rootId,
							name: "Workspace Session",
							...(showCwd
								? {
										cwd: (
											await runtime.configuration(
												runtime.view().conversations.find((ref) => ref.key === "root")!,
											)
										).cwd,
									}
								: {}),
							status: "ready",
						}),
					),
				);
			for (const row of (await currentRows()).rows) {
				if (
					person.resources === "*" ||
					entries
						.get(row.id)
						?.runtime.view()
						.conversations.some((ref) => person.resources.includes(people.resourceId(ref)))
				)
					rows.push(view(publicRow(row)));
			}
			people.current(actor);
			return Object.freeze(rows);
		},
		defaults: creationDefaults,
		directories: async (actor, input) => {
			const defaults = await creationDefaults(actor);
			return listDirectories(runtime.directoryRoots(options.profiles), defaults.cwd, input, () =>
				checkCreate(actor),
			);
		},
		create: (actor, raw) => {
			const input = validInput(raw);
			return serial(async () => {
				checkCreate(actor);
				const actorId = people.current(actor).id;
				const saved = await currentRows();
				checkCreate(actor);
				const prior = findOriginal(saved.rows, actorId, input);
				if (prior) return publicRow(prior);
				if (saved.rows.length >= 31) throw new SessionCreationRefused("Managed Session capacity reached");
				await resolveDirectory(input.cwd, runtime.directoryRoots(options.profiles));
				checkCreate(actor);
				const row: Registration = {
					...input,
					id: randomUUID(),
					actorId,
					fingerprint: digest(input),
					status: "unknown",
				};
				await store.compareAndSet(saved.version, registryData([...saved.rows, row]), () =>
					checkCreate(actor),
				);
				const opened = await options.open({ id: row.id, cwd: row.cwd, reopen: false });
				try {
					remember(row, opened);
				} catch (error) {
					await opened.close();
					throw error;
				}
				checkCreate(actor);
				const ready = await currentRows();
				const confirmed = { ...row, status: "ready" as const };
				await store.compareAndSet(
					ready.version,
					registryData(ready.rows.map((value) => (value.id === row.id ? confirmed : value))),
					() => checkCreate(actor),
				);
				entries.get(row.id)!.published = true;
				checkCreate(actor);
				return publicRow(confirmed);
			});
		},
		lookup: async (actor, raw) => {
			const input = validInput(raw);
			checkCreate(actor);
			const actorId = people.current(actor).id;
			const saved = await currentRows();
			checkCreate(actor);
			const prior = findOriginal(saved.rows, actorId, input);
			return prior ? publicRow(prior) : null;
		},
		close: async () => {
			await tail;
			const closed = await Promise.allSettled(
				[...entries.values()]
					.filter((value) => value.runtime !== runtime)
					.map((value) => value.runtime.close()),
			);
			const failure = closed.find((value) => value.status === "rejected");
			if (failure?.status === "rejected") throw failure.reason;
		},
	});
}
