import { createHash } from "node:crypto";
import type {
	ConversationRef,
	HostOptions,
	ToolInvocationScope,
	JsonObject,
	JsonValue,
	Runtime,
	RuntimeContextSource,
	RuntimeStoreSnapshot,
} from "@pakka/agent";
import type { PocketAuthority, PocketPeople, PocketPerson } from "./pocket-people.js";

type ApprovedTool = NonNullable<HostOptions["tools"]>[number];
export interface PocketMemoryProject {
	readonly id: string;
	readonly name: string;
	/** Exact host-selected Conversation keys or IDs; '*' is permitted only for a single project. */
	readonly resources: "*" | readonly string[];
}
export interface PocketMemoryProposal {
	readonly text: string | null;
	readonly authorName: string;
	readonly byAgent: boolean;
	readonly mine: boolean;
}
export interface PocketMemoryLesson {
	readonly id: string;
	readonly text: string;
	readonly scope: "project" | "global";
	readonly version: number;
	readonly pending: boolean;
	readonly authorName: string;
	readonly byAgent: boolean;
	readonly mine: boolean;
	readonly proposal: PocketMemoryProposal | null;
}
export interface PocketMemoryView {
	readonly project: { readonly id: string; readonly name: string } | null;
	readonly enabled: boolean;
	readonly owner: boolean;
	readonly canWrite: boolean;
	readonly lessons: readonly PocketMemoryLesson[];
	readonly limits: { readonly text: number; readonly project: number; readonly global: number };
}
export interface PocketMemoryMutation {
	readonly state: "done" | "conflict";
	readonly lesson: PocketMemoryLesson | null;
	readonly enabled: boolean;
}
export interface PocketMemoryAdd {
	readonly requestId: string;
	readonly scope: "project" | "global";
	readonly text: string;
}
export interface PocketMemoryChange {
	readonly requestId: string;
	readonly id: string;
	readonly expectedVersion: number;
	readonly action: "edit" | "remove" | "approve" | "discard";
	readonly text?: string;
}
export interface PocketMemoryClient {
	read(): Promise<PocketMemoryView>;
	add(input: PocketMemoryAdd): Promise<PocketMemoryMutation>;
	change(input: PocketMemoryChange): Promise<PocketMemoryMutation>;
	setEnabled(input: { readonly requestId: string; readonly enabled: boolean }): Promise<PocketMemoryMutation>;
	/** Read the committed original mutation without applying it again. */
	operation(requestId: string): Promise<PocketMemoryMutation>;
}
export interface PocketMemory {
	bind(actor: PocketAuthority, target: ConversationRef, check?: () => void): PocketMemoryClient;
}
export interface PocketMemoryContext {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
}
export interface PocketMemoryPreparation {
	readonly source: RuntimeContextSource;
	/** Host-selected native tool contribution; loading the human facet never installs it. */
	readonly tools: readonly ApprovedTool[];
	attach(context: PocketMemoryContext): Promise<PocketMemory>;
}
type Proposal = { text: string | null; authorId: string; authorName: string; byAgent: boolean };
type Lesson = {
	id: string;
	project: string | null;
	text: string;
	version: number;
	pending: boolean;
	removed: boolean;
	authorId: string;
	authorName: string;
	byAgent: boolean;
	proposal: Proposal | null;
};
type Operation = {
	id: string;
	actorId: string;
	requestId: string;
	target: ConversationRef;
	fingerprint: string;
	requiresOwner: boolean;
	result: PocketMemoryMutation;
};
type State = {
	schema: 1;
	sessionId: string;
	policy: string;
	enabled: boolean;
	lessons: Lesson[];
	operations: Operation[];
};
const MAX_TEXT = 300,
	MAX_PROJECT = 40,
	MAX_GLOBAL = 30,
	MAX_PENDING = 20,
	MAX_RECORDS = 256,
	MAX_OPERATIONS = 512;
type MemoryBinding = {
	readonly policy: string;
	readonly people: PocketPeople;
	readonly value: Promise<PocketMemory>;
	render?: RuntimeContextSource["render"];
};
type NativeMemory = (
	target: ConversationRef,
	scope: ToolInvocationScope,
	input: Record<string, unknown>,
	signal?: AbortSignal,
) => Promise<PocketMemoryView | PocketMemoryMutation>;
const nativeExecutions = new WeakMap<PocketMemory, NativeMemory>();
const opened = new WeakMap<Runtime, Map<string, MemoryBinding>>();
function canonical(value: unknown): JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value)) return value.map(canonical);
	if (record(value))
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonical(value[key])]),
		);
	throw Error("Invalid memory fingerprint value");
}
const hash = (value: unknown) =>
	createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex");
const record = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value);
const shape = (
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): value is Record<string, unknown> =>
	record(value) &&
	required.every((key) => Object.hasOwn(value, key)) &&
	Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
const id = (value: unknown): value is string =>
	typeof value === "string" && /^[A-Za-z0-9][-A-Za-z0-9._:]{0,159}$/.test(value);
const integer = (value: unknown, min = 0): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= min;
const name = (value: unknown): value is string =>
	typeof value === "string" && !!value.trim() && value.length <= 80 && !/[\x00-\x1f\x7f]/.test(value);
const text = (value: unknown): value is string =>
	typeof value === "string" &&
	!!value.trim() &&
	value.length <= MAX_TEXT &&
	!/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\u115f\u1160\u2800\u3164\uffa0\ufe00-\ufe0f]/u.test(value);
const same = (a: ConversationRef, b: ConversationRef) =>
	["key", "sessionId", "conversationId", "incarnation", "profile"].every(
		(key) => a[key as keyof ConversationRef] === b[key as keyof ConversationRef],
	);
function frozen<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) frozen(child);
		Object.freeze(value);
	}
	return value;
}
function clone<T>(value: T): T {
	return structuredClone(value);
}
function denied(): never {
	throw Error("Memory permission denied");
}
function reference(value: unknown): value is ConversationRef {
	return (
		shape(value, ["key", "sessionId", "conversationId", "incarnation", "profile"]) &&
		Object.values(value).every((item) => typeof item === "string" && !!item && item.length <= 512)
	);
}
function proposal(value: unknown): value is Proposal {
	return (
		shape(value, ["text", "authorId", "authorName", "byAgent"]) &&
		(value.text === null || text(value.text)) &&
		id(value.authorId) &&
		name(value.authorName) &&
		typeof value.byAgent === "boolean"
	);
}
function lesson(value: unknown): value is Lesson {
	return (
		shape(value, [
			"id",
			"project",
			"text",
			"version",
			"pending",
			"removed",
			"authorId",
			"authorName",
			"byAgent",
			"proposal",
		]) &&
		id(value.id) &&
		(value.project === null || id(value.project)) &&
		text(value.text) &&
		integer(value.version, 1) &&
		typeof value.pending === "boolean" &&
		typeof value.removed === "boolean" &&
		id(value.authorId) &&
		name(value.authorName) &&
		typeof value.byAgent === "boolean" &&
		(value.proposal === null || proposal(value.proposal))
	);
}
function lessonView(value: unknown): value is PocketMemoryLesson {
	return (
		shape(value, [
			"id",
			"text",
			"scope",
			"version",
			"pending",
			"authorName",
			"byAgent",
			"mine",
			"proposal",
		]) &&
		id(value.id) &&
		text(value.text) &&
		(value.scope === "project" || value.scope === "global") &&
		integer(value.version, 1) &&
		typeof value.pending === "boolean" &&
		name(value.authorName) &&
		typeof value.byAgent === "boolean" &&
		typeof value.mine === "boolean" &&
		(value.proposal === null ||
			(shape(value.proposal, ["text", "authorName", "byAgent", "mine"]) &&
				(value.proposal.text === null || text(value.proposal.text)) &&
				name(value.proposal.authorName) &&
				typeof value.proposal.byAgent === "boolean" &&
				typeof value.proposal.mine === "boolean"))
	);
}
function mutation(value: unknown): value is PocketMemoryMutation {
	return (
		shape(value, ["state", "lesson", "enabled"]) &&
		(value.state === "done" || value.state === "conflict") &&
		typeof value.enabled === "boolean" &&
		(value.lesson === null || lessonView(value.lesson))
	);
}
function operation(value: unknown): value is Operation {
	return (
		shape(value, ["id", "actorId", "requestId", "target", "fingerprint", "requiresOwner", "result"]) &&
		id(value.id) &&
		id(value.actorId) &&
		id(value.requestId) &&
		reference(value.target) &&
		typeof value.fingerprint === "string" &&
		/^[0-9a-f]{64}$/.test(value.fingerprint) &&
		typeof value.requiresOwner === "boolean" &&
		mutation(value.result)
	);
}
function encodeResult(result: PocketMemoryMutation): JsonObject {
	return {
		state: result.state,
		enabled: result.enabled,
		lesson: result.lesson
			? { ...result.lesson, proposal: result.lesson.proposal ? { ...result.lesson.proposal } : null }
			: null,
	};
}
function encode(state: State): JsonObject {
	return {
		schema: 1,
		sessionId: state.sessionId,
		policy: state.policy,
		enabled: state.enabled,
		lessons: state.lessons.map((row) => ({ ...row, proposal: row.proposal ? { ...row.proposal } : null })),
		operations: state.operations.map((row) => ({
			...row,
			target: { ...row.target },
			result: encodeResult(row.result),
		})),
	};
}

export function createPocketMemory(options: {
	readonly namespace: string;
	readonly profiles: readonly string[];
	readonly projects: readonly PocketMemoryProject[];
}): PocketMemoryPreparation {
	if (
		!shape(options, ["namespace", "profiles", "projects"]) ||
		!id(options.namespace) ||
		!Array.isArray(options.profiles) ||
		!options.profiles.length ||
		options.profiles.length > 64 ||
		!options.profiles.every(id) ||
		new Set(options.profiles).size !== options.profiles.length ||
		!Array.isArray(options.projects) ||
		options.projects.length > 64
	)
		throw Error("Invalid finite memory configuration");
	const projects = options.projects.map((project) => {
		if (
			!shape(project, ["id", "name", "resources"]) ||
			!id(project.id) ||
			!name(project.name) ||
			(project.resources !== "*" &&
				(!Array.isArray(project.resources) ||
					!project.resources.length ||
					project.resources.length > 128 ||
					!project.resources.every(id) ||
					new Set(project.resources).size !== project.resources.length))
		)
			throw Error("Invalid approved memory project");
		return frozen({
			id: project.id,
			name: project.name,
			resources: project.resources === "*" ? ("*" as const) : [...project.resources],
		});
	});
	if (
		new Set(projects.map((project) => project.id)).size !== projects.length ||
		projects.some((project) => project.resources === "*" && projects.length !== 1)
	)
		throw Error("Conflicting memory projects");
	const membership = new Set<string>();
	for (const project of projects)
		if (project.resources !== "*")
			for (const key of project.resources) {
				if (membership.has(key)) throw Error("Conflicting memory project membership");
				membership.add(key);
			}
	const namespace = options.namespace,
		profiles = Object.freeze([...options.profiles]),
		policy = hash(projects);
	let boundRuntime: Runtime | undefined,
		value: Promise<PocketMemory> | undefined,
		render: RuntimeContextSource["render"] | undefined;
	const source: RuntimeContextSource = Object.freeze({
		id: "memory-" + hash(namespace).slice(0, 16),
		version: 1,
		profiles,
		render: async (input: Parameters<RuntimeContextSource["render"]>[0]) => {
			if (!render) throw Error("Memory service is not bound");
			return render(input);
		},
	});
	const tools: readonly ApprovedTool[] = frozen([
		{
			name: "memory",
			description:
				"Keep short lessons for this project or the current product Session. Actions: list, add, update, remove. Model changes always wait for a human owner's approval. Use a stable requestId for each change and the current expectedVersion for update/remove; never store secrets or temporary task state.",
			parameters: {
				type: "object",
				properties: {
					action: { type: "string", enum: ["list", "add", "update", "remove"] },
					requestId: { type: "string", maxLength: 160 },
					scope: { type: "string", enum: ["project", "global"] },
					text: { type: "string", maxLength: MAX_TEXT },
					id: { type: "string", maxLength: 160 },
					expectedVersion: { type: "integer", minimum: 1 },
				},
				required: ["action"],
				additionalProperties: false,
			},
			execute: async (
				args: Record<string, unknown>,
				signal: AbortSignal | undefined,
				scope: ToolInvocationScope,
			) => {
				if (!boundRuntime || !value) throw Error("Memory service is not bound to a native invocation");
				const runtime = boundRuntime,
					service = await value,
					execute = nativeExecutions.get(service);
				if (!execute) throw Error("Memory invocation is unavailable");
				const catalog = runtime.catalog({
					namespace: namespace + ".native",
					maxDeliveries: 1,
					maxPending: 1,
				});
				const target = runtime.view().conversations.find((ref) => {
					if (!profiles.includes(ref.profile)) return false;
					try {
						catalog.checkInvocation(ref, scope);
						return true;
					} catch {
						return false;
					}
				});
				if (!target) throw Error("Memory native invocation scope denied");
				const result = await execute(target, scope, args, signal);
				return JSON.stringify(result);
			},
		},
	]);
	return Object.freeze({
		source,
		tools,
		attach(context: PocketMemoryContext) {
			if (boundRuntime && boundRuntime !== context.runtime)
				throw Error("Memory preparation already belongs to another writer");
			if (value) return value;
			boundRuntime = context.runtime;
			let writers = opened.get(context.runtime);
			if (!writers) {
				writers = new Map();
				opened.set(context.runtime, writers);
			}
			const existing = writers.get(namespace);
			if (existing) {
				if (existing.policy !== policy || existing.people !== context.people)
					throw Error("Memory namespace binding conflict");
				value = existing.value.then((service) => {
					if (!existing.render) throw Error("Memory source is unconfirmed");
					render = existing.render;
					return service;
				});
			} else {
				const active = writers;
				value = openMemory(context, namespace, policy, projects, (selected) => {
					render = selected;
					const writer = active.get(namespace);
					if (writer) writer.render = selected;
				});
				writers.set(namespace, { policy, people: context.people, value });
			}
			return value;
		},
	});
}
async function openMemory(
	context: PocketMemoryContext,
	namespace: string,
	policy: string,
	projects: readonly PocketMemoryProject[],
	bindRender: (render: RuntimeContextSource["render"]) => void,
): Promise<PocketMemory> {
	const { runtime, people } = context,
		sessionId = runtime.view().sessionId,
		store = runtime.store({ namespace, maxBytes: 1048576 });
	let sealed = false,
		epoch = 0,
		busy = false,
		tail: Promise<void> = Promise.resolve();
	const current = (target?: ConversationRef) => {
		if (sealed || runtime.view().phase !== "ready") throw Error("Unconfirmed memory storage or runtime");
		if (target && !runtime.view().conversations.some((ref) => same(ref, target))) return denied();
	};
	const projectOf = (target: ConversationRef) => {
		const found = projects.filter(
			(project) =>
				project.resources === "*" ||
				project.resources.includes(target.key) ||
				project.resources.includes(target.conversationId),
		);
		if (found.length > 1) throw Error("Conflicting approved memory membership");
		return found[0] ?? null;
	};
	const initial = (): State => ({ schema: 1, sessionId, policy, enabled: true, lessons: [], operations: [] });
	function decode(snapshot: RuntimeStoreSnapshot): State {
		const data = snapshot.data;
		if (snapshot.version === 0 && Object.keys(data).length === 0) return initial();
		if (
			!shape(data, ["schema", "sessionId", "policy", "enabled", "lessons", "operations"]) ||
			data.schema !== 1 ||
			data.sessionId !== sessionId ||
			data.policy !== policy ||
			typeof data.enabled !== "boolean" ||
			!Array.isArray(data.lessons) ||
			data.lessons.length > MAX_RECORDS ||
			!data.lessons.every(lesson) ||
			!Array.isArray(data.operations) ||
			data.operations.length > MAX_OPERATIONS ||
			!data.operations.every(operation)
		)
			throw Error("Unconfirmed memory records");
		const lessons = data.lessons,
			operations = data.operations;
		if (
			new Set(lessons.map((row) => row.id)).size !== lessons.length ||
			new Set(operations.map((row) => row.id)).size !== operations.length ||
			lessons.some((row) => row.project !== null && !projects.some((project) => project.id === row.project))
		)
			throw Error("Unconfirmed memory identities");
		return {
			schema: 1,
			sessionId,
			policy,
			enabled: data.enabled,
			lessons: clone(lessons),
			operations: clone(operations),
		};
	}
	const read = async () => {
		current();
		try {
			const snapshot = await store.snapshot();
			current();
			return { version: snapshot.version, state: decode(snapshot) };
		} catch (error) {
			sealed = true;
			throw error;
		}
	};
	const isOwner = (person: PocketPerson) => person.role === "admin" && person.resources === "*";
	const inProject = (row: Lesson, project: PocketMemoryProject | null) =>
		!row.removed && (row.project === null || row.project === project?.id);
	const visible = (row: Lesson, person: PocketPerson) =>
		!row.pending || isOwner(person) || row.authorId === person.id;
	function present(row: Lesson, person: PocketPerson): PocketMemoryLesson {
		const proposed =
			row.proposal && (isOwner(person) || row.proposal.authorId === person.id) ? row.proposal : null;
		return frozen({
			id: row.id,
			text: row.text,
			scope: row.project === null ? "global" : "project",
			version: row.version,
			pending: row.pending,
			authorName: row.authorName,
			byAgent: row.byAgent,
			mine: row.authorId === person.id,
			proposal: proposed
				? {
						text: proposed.text,
						authorName: proposed.authorName,
						byAgent: proposed.byAgent,
						mine: proposed.authorId === person.id,
					}
				: null,
		});
	}
	function enforce(state: State) {
		if (state.lessons.length > MAX_RECORDS || state.operations.length > MAX_OPERATIONS)
			throw Error("Memory retained capacity exhausted");
		for (const project of [null, ...projects.map((project) => project.id)])
			if (
				state.lessons.filter((row) => !row.removed && !row.pending && row.project === project).length >
				(project === null ? MAX_GLOBAL : MAX_PROJECT)
			)
				throw Error("Approved memory capacity exhausted");
		const pending = new Map<string, number>();
		for (const row of state.lessons) {
			if (row.removed) continue;
			for (const author of [row.pending ? row.authorId : null, row.proposal?.authorId ?? null])
				if (author) {
					const count = (pending.get(author) ?? 0) + 1;
					if (count > MAX_PENDING) throw Error("Pending memory capacity exhausted");
					pending.set(author, count);
				}
		}
	}
	await read();
	bindRender(async ({ target }) => {
		await tail;
		current(target);
		const snapshot = await read(),
			captured = epoch,
			project = projectOf(target);
		const rows = snapshot.state.lessons.filter((row) => inProject(row, project) && !row.pending);
		const content =
			snapshot.state.enabled && rows.length
				? "Approved lessons for this project and the current product Session. Follow them unless the current task explicitly says otherwise.\n" +
					rows
						.map((row) => `- [${row.id}] (${row.project === null ? "global" : "project"}) ${row.text}`)
						.join("\n")
				: null;
		return {
			text: content,
			check: () => {
				current(target);
				if (busy || epoch !== captured) throw Error("Memory changed before dispatch");
			},
		};
	});
	function makeClient(
		ref: ConversationRef,
		principalId: string,
		authorize: (write?: boolean, owner?: boolean) => PocketPerson,
		byAgent = false,
	): PocketMemoryClient {
		authorize();
		const view = async (): Promise<PocketMemoryView> => {
			const snapshot = await read(),
				person = authorize(),
				project = projectOf(ref);
			return frozen({
				project: project ? { id: project.id, name: project.name } : null,
				enabled: snapshot.state.enabled,
				owner: isOwner(person),
				canWrite: person.role !== "viewer",
				lessons: snapshot.state.lessons
					.filter((row) => inProject(row, project) && visible(row, person))
					.map((row) => present(row, person)),
				limits: { text: MAX_TEXT, project: MAX_PROJECT, global: MAX_GLOBAL },
			});
		};
		function mutate(
			requestId: string,
			payload: JsonObject,
			owner: boolean,
			apply: (state: State, person: PocketPerson) => PocketMemoryMutation,
		): Promise<PocketMemoryMutation> {
			if (!id(requestId)) return Promise.reject(Error("Invalid memory request identity"));
			const request = clone(payload),
				fingerprint = hash(request),
				operationId = "memory-" + hash([principalId, ref, requestId]);
			const result = tail.then(async () => {
				const snapshot = await read(),
					person = authorize(true, owner),
					saved = snapshot.state.operations.find((row) => row.id === operationId);
				if (saved) {
					if (saved.fingerprint !== fingerprint) throw Error("Memory request conflict");
					authorize(true, saved.requiresOwner);
					return frozen(clone(saved.result));
				}
				const output = apply(snapshot.state, person),
					requiresOwner = owner || isOwner(person);
				snapshot.state.operations.push({
					id: operationId,
					actorId: person.id,
					requestId,
					target: ref,
					fingerprint,
					requiresOwner,
					result: output,
				});
				enforce(snapshot.state);
				epoch++;
				busy = true;
				try {
					await store.compareAndSet(snapshot.version, encode(snapshot.state), () => {
						authorize(true, requiresOwner);
					});
				} catch {
					try {
						const actual = await store.snapshot(),
							confirmed = decode(actual).operations.find((row) => row.id === operationId);
						if (
							!confirmed ||
							confirmed.fingerprint !== fingerprint ||
							hash(confirmed.result) !== hash(output)
						) {
							sealed = true;
							throw Error("Unconfirmed memory mutation");
						}
					} catch {
						sealed = true;
						throw Error("Unconfirmed memory mutation");
					}
				} finally {
					busy = false;
				}
				authorize(true, requiresOwner);
				return frozen(clone(output));
			});
			tail = result.then(
				() => {},
				() => {},
			);
			return result;
		}
		return Object.freeze({
			read: view,
			add(input: PocketMemoryAdd) {
				if (
					!shape(input, ["requestId", "scope", "text"]) ||
					!["project", "global"].includes(input.scope) ||
					!text(input.text)
				)
					return Promise.reject(Error("Invalid bounded memory lesson"));
				const request = { requestId: input.requestId, scope: input.scope, text: input.text };
				return mutate(
					request.requestId,
					{ action: "add", scope: request.scope, text: request.text },
					false,
					(state, person) => {
						const project = projectOf(ref);
						if (request.scope === "project" && !project) return denied();
						const row: Lesson = {
							id: "lesson-" + hash([person.id, ref, request.requestId]).slice(0, 24),
							project: request.scope === "global" ? null : project!.id,
							text: request.text,
							version: 1,
							pending: !isOwner(person),
							removed: false,
							authorId: person.id,
							authorName: person.name,
							byAgent,
							proposal: null,
						};
						state.lessons.push(row);
						return { state: "done", lesson: present(row, person), enabled: state.enabled };
					},
				);
			},
			change(input: PocketMemoryChange) {
				if (
					!shape(input, ["requestId", "id", "expectedVersion", "action"], ["text"]) ||
					!id(input.id) ||
					!integer(input.expectedVersion, 1) ||
					!["edit", "remove", "approve", "discard"].includes(input.action) ||
					(input.action === "edit" ? !text(input.text) : input.text !== undefined)
				)
					return Promise.reject(Error("Invalid memory edit"));
				const request = {
					requestId: input.requestId,
					id: input.id,
					expectedVersion: input.expectedVersion,
					action: input.action,
					...(input.text === undefined ? {} : { text: input.text }),
				};
				return mutate(request.requestId, { ...request }, request.action === "approve", (state, person) => {
					const row = state.lessons.find(
						(row) => row.id === request.id && inProject(row, projectOf(ref)) && visible(row, person),
					);
					if (!row) return denied();
					if (row.version !== request.expectedVersion)
						return { state: "conflict", lesson: present(row, person), enabled: state.enabled };
					if (request.action === "approve") {
						if (row.pending) row.pending = false;
						else if (row.proposal) {
							if (row.proposal.text === null) row.removed = true;
							else row.text = row.proposal.text;
							row.proposal = null;
						} else return { state: "conflict", lesson: present(row, person), enabled: state.enabled };
					} else if (request.action === "discard") {
						if (row.pending) {
							if (!isOwner(person) && row.authorId !== person.id) return denied();
							row.removed = true;
						} else if (row.proposal) {
							if (!isOwner(person) && row.proposal.authorId !== person.id) return denied();
							row.proposal = null;
						} else return { state: "conflict", lesson: present(row, person), enabled: state.enabled };
					} else if (isOwner(person)) {
						if (request.action === "remove") row.removed = true;
						else row.text = request.text!;
						row.proposal = null;
					} else if (row.pending) {
						if (row.authorId !== person.id) return denied();
						if (request.action === "remove") row.removed = true;
						else row.text = request.text!;
					} else {
						if (row.proposal && row.proposal.authorId !== person.id)
							return { state: "conflict", lesson: present(row, person), enabled: state.enabled };
						row.proposal = {
							text: request.action === "remove" ? null : request.text!,
							authorId: person.id,
							authorName: person.name,
							byAgent,
						};
					}
					row.version++;
					return {
						state: "done",
						lesson: row.removed ? null : present(row, person),
						enabled: state.enabled,
					};
				});
			},
			setEnabled(input: { readonly requestId: string; readonly enabled: boolean }) {
				if (!shape(input, ["requestId", "enabled"]) || typeof input.enabled !== "boolean")
					return Promise.reject(Error("Invalid memory activation"));
				const request = { requestId: input.requestId, enabled: input.enabled };
				return mutate(request.requestId, { action: "enabled", enabled: request.enabled }, true, (state) => {
					state.enabled = request.enabled;
					return { state: "done", lesson: null, enabled: state.enabled };
				});
			},
			async operation(requestId: string) {
				if (!id(requestId)) throw Error("Invalid memory request identity");
				const snapshot = await read();
				authorize();
				const saved = snapshot.state.operations.find(
					(row) => row.actorId === principalId && row.requestId === requestId && same(row.target, ref),
				);
				if (!saved) return denied();
				authorize(false, saved.requiresOwner);
				return frozen(clone(saved.result));
			},
		});
	}
	const service: PocketMemory = {
		bind(actor, target, live = () => {}) {
			const ref = frozen(clone(target));
			const authorize = (write = false, owner = false) => {
				current(ref);
				live();
				people.check(actor, write ? "send" : "read", ref.conversationId);
				const person = people.current(actor);
				if (owner && !isOwner(person)) return denied();
				projectOf(ref);
				return person;
			};
			return makeClient(ref, actor.person.id, authorize);
		},
	};
	nativeExecutions.set(service, async (target, scope, input, signal) => {
		const ref = frozen(clone(target)),
			catalog = runtime.catalog({ namespace: namespace + ".native", maxDeliveries: 1, maxPending: 1 });
		const person: PocketPerson = frozen({
			id: "agent:" + ref.conversationId,
			name: "Agent",
			role: "sender",
			resources: [ref.conversationId],
			active: true,
		});
		const authorize = (_write = false, owner = false) => {
			current(ref);
			if (signal?.aborted || owner) return denied();
			catalog.checkInvocation(ref, scope);
			projectOf(ref);
			return person;
		};
		authorize();
		if (!shape(input, ["action"], ["requestId", "scope", "text", "id", "expectedVersion"]))
			throw Error("Invalid native memory arguments");
		const client = makeClient(ref, person.id, authorize, true);
		if (input.action === "list") {
			if (!shape(input, ["action"])) throw Error("Invalid memory list arguments");
			return client.read();
		}
		if (input.action === "add") {
			if (
				!shape(input, ["action", "requestId", "text"], ["scope"]) ||
				!id(input.requestId) ||
				!text(input.text) ||
				(input.scope !== undefined && input.scope !== "project" && input.scope !== "global")
			)
				throw Error("Invalid native memory proposal");
			return client.add({
				requestId: input.requestId,
				text: input.text,
				scope: input.scope ?? (projectOf(ref) ? "project" : "global"),
			});
		}
		if (input.action === "update" || input.action === "remove") {
			if (
				!shape(
					input,
					["action", "requestId", "id", "expectedVersion"],
					input.action === "update" ? ["text"] : [],
				) ||
				!id(input.requestId) ||
				!id(input.id) ||
				!integer(input.expectedVersion, 1) ||
				(input.action === "update" && !text(input.text))
			)
				throw Error("Invalid native memory edit");
			return client.change({
				requestId: input.requestId,
				id: input.id,
				expectedVersion: input.expectedVersion,
				action: input.action === "remove" ? "remove" : "edit",
				...(input.action === "update" ? { text: input.text as string } : {}),
			});
		}
		throw Error("Native memory approval or authority selection denied");
	});
	return Object.freeze(service);
}
