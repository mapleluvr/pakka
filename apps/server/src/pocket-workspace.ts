import { createHash } from "node:crypto";
import type {
	Runtime,
	RuntimeView,
	CatalogOptions,
	ConversationRef,
	ConversationReadOptions,
	ConversationSnapshot,
	InputMode,
	DisplayReceipt,
	DeliveryReceipt,
	CatalogMember,
	JsonObject,
	ConversationConfigurationChange,
} from "@pakka/agent";
import type { PocketAuthority, PocketPeople, PocketPermission, PocketPerson } from "./pocket-people.ts";
import {
	listDirectories,
	resolveDirectory,
	directoryWithin,
	type PocketDirectories,
} from "./pocket-directories.ts";

export interface PocketCreate {
	readonly requestId: string;
	readonly name: string;
	readonly profile: string;
	readonly inherit?: ConversationRef;
}
export interface PocketFork extends PocketCreate {
	readonly entryId: string;
}
export interface PocketNavigation {
	readonly ref: ConversationRef;
	readonly name: string;
	readonly version: number;
	readonly archived: boolean;
}
export interface PocketMetadataInput {
	readonly requestId: string;
	readonly expectedVersion: number;
	readonly name: string;
	readonly archived: boolean;
}
export class PocketMetadataConflict extends Error {
	constructor() {
		super("WebUI conversation metadata changed");
		this.name = "PocketMetadataConflict";
	}
}
export interface PocketInput {
	readonly requestId: string;
	readonly text: string;
	readonly mode: InputMode;
}
export interface PocketInputReceipt {
	readonly id: string;
	readonly requestId: string;
	readonly actorId: string;
	readonly target: ConversationRef;
	readonly status: DeliveryReceipt["status"];
	readonly entryId?: string;
	readonly reason?: string;
}
export interface PocketConfiguration {
	readonly ref: ConversationRef;
	readonly current: { readonly model: string; readonly cwd: string };
	readonly choices: readonly { readonly id: string; readonly model: string; readonly cwd?: string }[];
	readonly canConfigure: boolean;
	readonly usage: ConversationSnapshot["usage"];
	/** Session totals are visible only to a global admin, never inferred from a single visible Conversation. */
	readonly session: { readonly limits: RuntimeView["limits"]; readonly budget: RuntimeView["budget"] } | null;
}
export interface PocketWorkspaceClient {
	configuration(ref: ConversationRef): Promise<PocketConfiguration>;
	list(): Promise<readonly ConversationRef[]>;
	navigation(): Promise<readonly PocketNavigation[]>;
	setMetadata(ref: ConversationRef, input: PocketMetadataInput): Promise<PocketNavigation>;
	/** Read original metadata result only. Missing records never re-enter mutation admission. */
	metadataReceipt(ref: ConversationRef, input: PocketMetadataInput): Promise<PocketNavigation | null>;
	/** Read an original create/fork result only, under the same current scope and approved profile. */
	creationReceipt(
		input: PocketCreate,
		fork?: { readonly source: ConversationRef; readonly entryId: string },
	): Promise<ConversationRef | null>;
	create(input: PocketCreate): Promise<ConversationRef>;
	configure(ref: ConversationRef, profile: string): Promise<ConversationRef>;
	configureAgent(ref: ConversationRef, change: ConversationConfigurationChange): Promise<ConversationRef>;
	directories(
		ref: ConversationRef,
		input: { readonly path?: string; readonly places?: readonly string[] },
	): Promise<PocketDirectories>;
	fork(ref: ConversationRef, input: PocketFork): Promise<ConversationRef>;
	read(ref: ConversationRef, page?: ConversationReadOptions): Promise<ConversationSnapshot>;
	display(
		ref: ConversationRef,
		input: { readonly requestId: string; readonly kind: "chat" | "card"; readonly text: string },
	): Promise<DisplayReceipt>;
	submit(ref: ConversationRef, input: PocketInput): Promise<PocketInputReceipt>;
	receipt(id: string): Promise<PocketInputReceipt>;
	wait(id: string, signal?: AbortSignal): Promise<PocketInputReceipt>;
	withdraw(id: string): Promise<PocketInputReceipt>;
	abort(ref: ConversationRef): Promise<void>;
}
export interface PocketConversationSource {
	/** Trusted service port. It supplies currently authorized resources, never wire authority. */
	bind(actor: PocketAuthority): {
		navigation(): Promise<readonly PocketNavigation[]>;
		canManage(ref: ConversationRef): boolean;
		ownsReceipt(id: string): Promise<boolean>;
		configure(ref: ConversationRef, profile: string, check: () => void): Promise<ConversationRef>;
		configureAgent(
			ref: ConversationRef,
			change: ConversationConfigurationChange,
			check: () => void,
		): Promise<ConversationRef>;
		submit(ref: ConversationRef, input: PocketInput, check: () => void): Promise<PocketInputReceipt>;
		receipt: PocketWorkspaceClient["receipt"];
		wait: PocketWorkspaceClient["wait"];
		withdraw: PocketWorkspaceClient["withdraw"];
		abort(ref: ConversationRef, check: () => void): Promise<void>;
	};
}
export interface PocketWorkspace {
	/** Trusted composition only. Unregistering a source never cancels admitted work. */
	registerResources?(source: PocketConversationSource): () => void;
	bind(actor: PocketAuthority): PocketWorkspaceClient;
	/** Trusted backend programs only; no session or browser authority is minted from a persisted person ID. */
	checkScheduledInput(actorId: string, ref: ConversationRef): void;
	submitScheduled(
		actorId: string,
		ref: ConversationRef,
		input: { readonly requestId: string; readonly text: string },
		check: () => void,
	): Promise<PocketInputReceipt>;
}
export interface PocketWorkspaceOptions {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly catalog: CatalogOptions;
	/** Host-owned selection only; the browser never supplies this ceiling. */
	readonly profileCeiling: (person: PocketPerson) => readonly string[];
	/** Host-owned synchronous collaboration/driver check; repeated at native admission, never a wire grant. */
	readonly beforeInput?: (actor: PocketAuthority, ref: ConversationRef) => void;
	/** Same current-driver guard for a persisted originating person; required when beforeInput is configured. */
	readonly beforeScheduledInput?: (actorId: string, ref: ConversationRef) => void;
}
const key = (v: unknown): v is string =>
	typeof v === "string" && /^[a-zA-Z0-9][-a-zA-Z0-9._:]{0,159}$/.test(v);
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sameRef = (a: ConversationRef, b: ConversationRef) =>
	["key", "sessionId", "conversationId", "incarnation", "profile"].every(
		(k) => a[k as keyof ConversationRef] === b[k as keyof ConversationRef],
	);
function frozen<T>(v: T): T {
	if (v && typeof v === "object") {
		Object.values(v).forEach(frozen);
		Object.freeze(v);
	}
	return v;
}
function denied(): never {
	throw new Error("WebUI workspace authority denied");
}

const object = (value: unknown): value is JsonObject =>
	!!value && typeof value === "object" && !Array.isArray(value);
const nameValid = (name: unknown): name is string =>
	typeof name === "string" && !!name.trim() && name.length <= 80 && !/[\x00-\x1f\x7f]/.test(name);
function metadata(row: CatalogMember): PocketNavigation {
	const state = row.data.metadata;
	if (
		!nameValid(row.data.name) ||
		(state !== undefined &&
			(!object(state) ||
				!Number.isSafeInteger(state.version) ||
				Number(state.version) < 1 ||
				Number(state.version) > 256 ||
				typeof state.archived !== "boolean" ||
				!Array.isArray(state.receipts) ||
				state.receipts.length !== state.version))
	)
		throw Error("Invalid WebUI conversation metadata");
	return frozen({
		ref: row.ref,
		name: row.data.name,
		version: object(state) ? Number(state.version) : 0,
		archived: !!(object(state) && state.archived),
	});
}

/** Human workbench metadata composes the controlled catalog; it owns no scheduler or native handles. */
export function createPocketWorkspace(options: PocketWorkspaceOptions): PocketWorkspace {
	const { runtime, people } = options,
		catalogOptions = Object.freeze({ ...options.catalog }),
		catalog = runtime.catalog(catalogOptions);
	const sources = new Set<PocketConversationSource>();
	let tail: Promise<unknown> = Promise.resolve();
	const serial = <T>(operation: () => Promise<T>): Promise<T> => {
		const running = tail.then(operation);
		tail = running.then(
			() => {},
			() => {},
		);
		return running;
	};
	const member = async (ref: ConversationRef, check: () => void): Promise<CatalogMember> => {
		check();
		const snapshot = await catalog.snapshot();
		check();
		const found = snapshot.members.find(
			(row) => row.data.kind === "pocket-workspace" && sameRef(row.ref, ref),
		);
		if (!found) return denied();
		return found;
	};
	const checkScheduledInput = (actorId: string, ref: ConversationRef) => {
		people.authorizePerson(actorId, "steer", ref.conversationId);
		if (options.beforeInput && !options.beforeScheduledInput)
			throw new Error("Scheduled collaboration authority is not configured");
		options.beforeScheduledInput?.(actorId, ref);
	};
	return Object.freeze({
		registerResources(source: PocketConversationSource) {
			if (sources.has(source)) throw Error("Conversation source already registered");
			sources.add(source);
			return () => {
				sources.delete(source);
			};
		},
		checkScheduledInput,
		submitScheduled: async (
			actorId: string,
			raw: ConversationRef,
			input: { readonly requestId: string; readonly text: string },
			check: () => void,
		): Promise<PocketInputReceipt> => {
			const ref = structuredClone(raw),
				data = structuredClone(input);
			if (
				!data ||
				Object.keys(data).some((key) => !["requestId", "text"].includes(key)) ||
				!key(data.requestId) ||
				typeof data.text !== "string" ||
				!data.text.trim() ||
				data.text.length > 8192
			)
				throw new Error("Invalid bounded scheduled input");
			const authorize = () => {
				check();
				checkScheduledInput(actorId, ref);
			};
			authorize();
			await member(ref, authorize);
			const receipt = await catalog.deliver(
				{
					requestId: data.requestId,
					principal: actorId,
					source: null,
					target: ref,
					text: data.text,
					mode: "followUp",
				},
				authorize,
			);
			authorize();
			return frozen({
				id: receipt.id,
				requestId: receipt.requestId,
				actorId,
				target: receipt.target,
				status: receipt.status,
				...(receipt.entryId ? { entryId: receipt.entryId } : {}),
			});
		},
		bind: (actor: PocketAuthority): PocketWorkspaceClient => {
			people.current(actor);
			const current = () => people.current(actor);
			const providers = () => [...sources].map((source) => source.bind(actor));
			const resource = async (ref: ConversationRef, authorize: () => void) => {
				authorize();
				const snapshot = await catalog.snapshot();
				authorize();
				if (snapshot.members.some((row) => row.data.kind === "pocket-workspace" && sameRef(row.ref, ref)))
					return undefined;
				for (const provider of providers()) {
					const rows = await provider.navigation();
					authorize();
					if (rows.some((row) => sameRef(row.ref, ref))) return provider;
				}
				return denied();
			};
			const receiptProvider = async (id: string) => {
				current();
				for (const provider of providers())
					if (await provider.ownsReceipt(id)) {
						current();
						return provider;
					}
				current();
				return undefined;
			};
			const check = (permission: PocketPermission, ref?: ConversationRef) =>
				people.check(actor, permission, ref?.conversationId);
			const profileCheck = (profile: string) => {
				const person = current();
				const allowed = options.profileCeiling(person);
				if (
					!key(profile) ||
					!Array.isArray(allowed) ||
					!allowed.length ||
					allowed.length > 64 ||
					!allowed.every(key) ||
					!allowed.includes(profile)
				)
					throw new Error("WebUI profile ceiling denied");
			};
			const ceiling = () => {
				const value = options.profileCeiling(current());
				if (!Array.isArray(value) || value.length > 64 || !value.every(key))
					throw new Error("Invalid profile ceiling");
				return value;
			};
			const roots = () => runtime.directoryRoots(ceiling());
			const create = (
				input: PocketCreate,
				source?: ConversationRef,
				entryId?: string,
				lookupOnly = false,
			): Promise<ConversationRef | null> => {
				check("create");
				if (
					!input ||
					Object.keys(input).some(
						(k) => !["requestId", "name", "profile", ...(source ? ["entryId"] : ["inherit"])].includes(k),
					) ||
					!key(input.requestId) ||
					typeof input.name !== "string" ||
					!input.name.trim() ||
					input.name.length > 80 ||
					/[\x00-\x1f\x7f]/.test(input.name) ||
					(source && (!entryId || !/^[0-9]+$/.test(entryId)))
				)
					return Promise.reject(new Error("Invalid bounded WebUI creation input"));
				const saved = Object.freeze({
						requestId: input.requestId,
						name: input.name.trim(),
						profile: input.profile,
						...(input.inherit ? { inherit: structuredClone(input.inherit) } : {}),
					}),
					from = source ? structuredClone(source) : undefined,
					personId = current().id;
				const fingerprint = hash({ ...saved, source: from ?? null, entryId: entryId ?? null }),
					id = "human-" + hash([personId, saved.requestId]).slice(0, 40);
				let inheritedConfiguration: { model: string; cwd: string } | undefined;
				const authorize = () => {
					check("create");
					profileCheck(saved.profile);
					if (from) check("manage", from);
					if (saved.inherit) check("manage", saved.inherit);
					if (
						inheritedConfiguration &&
						(!runtime
							.profileChoices()
							.some((row) => ceiling().includes(row.id) && row.model === inheritedConfiguration!.model) ||
							!directoryWithin(inheritedConfiguration.cwd, roots()))
					)
						denied();
				};
				return serial(async () => {
					authorize();
					if (from) {
						const provider = await resource(from, authorize);
						if (provider && !provider.canManage(from)) denied();
					}
					const before = await catalog.snapshot();
					authorize();
					const prior = before.members.find((m) => m.key === id);
					if (prior) {
						if (
							prior.data.kind !== "pocket-workspace" ||
							prior.data.personId !== personId ||
							prior.data.fingerprint !== fingerprint
						)
							throw new Error("WebUI creation request conflict");
						await runtime.conversation(prior.ref);
						authorize();
						return prior.ref;
					}
					if (lookupOnly) return null;
					const inheritedRef = saved.inherit ?? (from?.profile === saved.profile ? from : undefined);
					if (inheritedRef) {
						const provider = await resource(inheritedRef, authorize);
						if (provider && !provider.canManage(inheritedRef)) denied();
						const inherited = await runtime.configuration(inheritedRef);
						inheritedConfiguration = inherited;
						if (
							!runtime
								.profileChoices()
								.some((row) => ceiling().includes(row.id) && row.model === inherited.model)
						)
							denied();
						await resolveDirectory(inherited.cwd, roots());
						authorize();
					}
					const rows = await catalog.enroll(
						[
							{
								key: id,
								profile: saved.profile,
								lifetime: "persistent",
								data: {
									kind: "pocket-workspace",
									phase: "active",
									personId,
									requestId: saved.requestId,
									name: saved.name,
									fingerprint,
								},
								...(from ? { fork: { source: from, entryId: entryId! } } : {}),
								...(saved.inherit ? { inherit: saved.inherit } : {}),
							},
						],
						authorize,
					);
					authorize();
					return rows[0]!.ref;
				});
			};
			const receiptCheck = (
				value: DeliveryReceipt,
				permission: PocketPermission = "read",
			): PocketInputReceipt => {
				const person = current();
				if (value.principal !== person.id || value.source !== null) return denied();
				check(permission, value.target);
				return frozen({
					id: value.id,
					requestId: value.requestId,
					actorId: person.id,
					target: value.target,
					status: value.status,
					...(value.entryId ? { entryId: value.entryId } : {}),
					...(value.reason === undefined ? {} : { reason: value.reason }),
				});
			};
			const ownedReceipt = async (id: string, permission: PocketPermission = "read") => {
				current();
				const value = await catalog.receipt(id, () => {
					current();
				});
				receiptCheck(value, permission);
				return value;
			};
			const navigation = async () => {
				current();
				const snapshot = await catalog.snapshot();
				const person = current();
				const rows = snapshot.members.filter(
					(row) =>
						row.data.kind === "pocket-workspace" &&
						row.data.phase === "active" &&
						(person.resources === "*" || person.resources.includes(row.ref.conversationId)),
				);
				for (const row of rows) check("read", row.ref);
				const external: PocketNavigation[] = [];
				for (const provider of providers()) external.push(...(await provider.navigation()));
				for (const row of external) check("read", row.ref);
				current();
				return frozen([...rows.map(metadata), ...external]);
			};
			const changeMetadata = (
				raw: ConversationRef,
				input: PocketMetadataInput,
				lookupOnly = false,
			): Promise<PocketNavigation | null> => {
				const ref = structuredClone(raw),
					saved = structuredClone(input),
					personId = current().id;
				if (
					!saved ||
					Object.keys(saved).some((k) => !["requestId", "expectedVersion", "name", "archived"].includes(k)) ||
					!key(saved.requestId) ||
					!Number.isSafeInteger(saved.expectedVersion) ||
					saved.expectedVersion < 0 ||
					!nameValid(saved.name) ||
					typeof saved.archived !== "boolean"
				)
					return Promise.reject(Error("Invalid bounded WebUI metadata input"));
				const fingerprint = hash({ ref, ...saved, name: saved.name.trim() }),
					authorize = () => check("manage", ref);
				return serial(async () => {
					authorize();
					const snapshot = await catalog.snapshot();
					authorize();
					const row = snapshot.members.find(
						(row) => row.data.kind === "pocket-workspace" && sameRef(row.ref, ref),
					);
					if (!row) return denied();
					const currentState = metadata(row),
						state = row.data.metadata;
					const receipts = object(state) && Array.isArray(state.receipts) ? state.receipts : [];
					for (const receipt of receipts) {
						if (
							!object(receipt) ||
							!key(receipt.actorId) ||
							!key(receipt.requestId) ||
							typeof receipt.fingerprint !== "string" ||
							!/^[a-f0-9]{64}$/.test(receipt.fingerprint) ||
							!nameValid(receipt.name) ||
							typeof receipt.archived !== "boolean" ||
							!Number.isSafeInteger(receipt.version) ||
							Number(receipt.version) < 1 ||
							Number(receipt.version) > currentState.version
						)
							throw Error("Invalid WebUI metadata receipt");
						if (receipt.actorId === personId && receipt.requestId === saved.requestId) {
							if (receipt.fingerprint !== fingerprint) throw new PocketMetadataConflict();
							authorize();
							return frozen({
								ref,
								name: receipt.name,
								archived: receipt.archived,
								version: Number(receipt.version),
							});
						}
					}
					if (lookupOnly) return null;
					if (currentState.version !== saved.expectedVersion) throw new PocketMetadataConflict();
					if (receipts.length >= 256) throw Error("WebUI metadata receipt capacity reached");
					const next = {
						name: saved.name.trim(),
						archived: saved.archived,
						version: currentState.version + 1,
					};
					await catalog.update(
						row.key,
						{
							...row.data,
							name: next.name,
							metadata: {
								version: next.version,
								archived: next.archived,
								receipts: [
									...receipts,
									{ ...next, actorId: personId, requestId: saved.requestId, fingerprint },
								],
							},
						},
						snapshot.version,
						authorize,
					);
					authorize();
					return frozen({ ref, ...next });
				});
			};
			return Object.freeze({
				list: async () => frozen((await navigation()).map((row) => row.ref)),
				navigation,
				setMetadata: async (ref: ConversationRef, input: PocketMetadataInput) => {
					const result = await changeMetadata(ref, input);
					if (!result) throw Error("Metadata admission unconfirmed");
					return result;
				},
				metadataReceipt: (ref: ConversationRef, input: PocketMetadataInput) =>
					changeMetadata(ref, input, true),
				configuration: async (raw: ConversationRef): Promise<PocketConfiguration> => {
					const ref = structuredClone(raw),
						authorize = () => check("read", ref);
					authorize();
					const provider = await resource(ref, authorize);
					const snapshot = await runtime.readConversation(ref, authorize, { limit: 1 });
					const person = current(),
						ceiling = options.profileCeiling(person);
					if (!Array.isArray(ceiling) || ceiling.length > 64 || !ceiling.every(key))
						throw new Error("Invalid profile ceiling");
					const choices = runtime.profileChoices().filter((row) => ceiling.includes(row.id));
					const view = runtime.view();
					const configuration = await runtime.configuration(ref);
					authorize();
					return frozen({
						ref,
						current: configuration,
						choices,
						canConfigure: ["admin", "driver"].includes(person.role) && (!provider || provider.canManage(ref)),
						usage: snapshot.usage,
						session:
							person.role === "admin" && person.resources === "*"
								? { limits: view.limits, budget: view.budget }
								: null,
					});
				},
				create: async (input: PocketCreate) => {
					const ref = await create(input);
					if (!ref) throw Error("Creation admission unconfirmed");
					return ref;
				},
				fork: async (source: ConversationRef, input: PocketFork) => {
					const ref = await create(input, source, input.entryId);
					if (!ref) throw Error("Fork admission unconfirmed");
					return ref;
				},
				creationReceipt: (
					input: PocketCreate,
					fork?: { readonly source: ConversationRef; readonly entryId: string },
				) => create(input, fork?.source, fork?.entryId, true),
				directories: async (
					raw: ConversationRef,
					input: { readonly path?: string; readonly places?: readonly string[] },
				) => {
					const ref = structuredClone(raw),
						saved = structuredClone(input),
						authorize = () => check("manage", ref);
					authorize();
					const provider = await resource(ref, authorize);
					if (provider && !provider.canManage(ref)) denied();
					const config = await runtime.configuration(ref);
					const result = await listDirectories(roots(), config.cwd, saved, authorize);
					authorize();
					return result;
				},
				configureAgent: (raw: ConversationRef, rawChange: ConversationConfigurationChange) =>
					serial(async () => {
						let validatedCwd: string | undefined;
						const ref = structuredClone(raw),
							change = structuredClone(rawChange),
							authorize = () => {
								check("manage", ref);
								if (validatedCwd !== undefined && !directoryWithin(validatedCwd, roots())) denied();
								if (
									change?.model !== undefined &&
									!runtime
										.profileChoices()
										.some((row) => ceiling().includes(row.id) && row.model === change.model)
								)
									denied();
							};
						authorize();
						const provider = await resource(ref, authorize);
						if (change?.cwd !== undefined) validatedCwd = await resolveDirectory(change.cwd, roots());
						authorize();
						if (provider) return provider.configureAgent(ref, change, authorize);
						const result = await catalog.configureAgent(ref, change, authorize);
						authorize();
						return result.ref;
					}),
				configure: (raw: ConversationRef, profile: string) =>
					serial(async () => {
						const ref = structuredClone(raw),
							authorize = () => {
								check("manage", ref);
								profileCheck(profile);
							};
						authorize();
						const provider = await resource(ref, authorize);
						if (provider) return provider.configure(ref, profile, authorize);
						const changed = await catalog.configure(ref, profile, authorize);
						authorize();
						return changed.ref;
					}),
				read: async (ref: ConversationRef, page?: ConversationReadOptions) => {
					const saved = structuredClone(ref),
						authorize = () => check("read", saved);
					authorize();
					const snapshot = await runtime.readConversation(saved, authorize, page);
					authorize();
					const person = current();
					const entries = snapshot.entries.map((entry) => {
						if (
							!entry.sourceConversationId ||
							person.resources === "*" ||
							person.resources.includes(entry.sourceConversationId)
						)
							return entry;
						// An explicit native fork copies history, not a read grant to its source resource.
						const { sourceConversationId: _source, ...scoped } = entry;
						return scoped;
					});
					authorize();
					return frozen({ ...snapshot, entries });
				},
				display: async (
					ref: ConversationRef,
					input: { readonly requestId: string; readonly kind: "chat" | "card"; readonly text: string },
				) => {
					const saved = structuredClone(ref),
						authorize = () => check("send", saved);
					authorize();
					if (!input || Object.keys(input).some((k) => !["requestId", "kind", "text"].includes(k)))
						throw new Error("Invalid WebUI display input");
					return runtime.writeDisplay(
						saved,
						{
							namespace: catalogOptions.namespace,
							actorId: current().id,
							requestId: input.requestId,
							kind: input.kind,
							text: input.text,
						},
						authorize,
					);
				},
				submit: async (ref: ConversationRef, input: PocketInput) => {
					const saved = structuredClone(ref),
						data = structuredClone(input),
						authorize = () => {
							check(data.mode === "prompt" ? "send" : "steer", saved);
							options.beforeInput?.(actor, saved);
						};
					authorize();
					const provider = await resource(saved, authorize);
					if (!data || Object.keys(data).some((k) => !["requestId", "text", "mode"].includes(k)))
						throw new Error("Invalid WebUI input fields");
					if (provider) return provider.submit(saved, data, authorize);
					return receiptCheck(
						await catalog.deliver(
							{
								requestId: data.requestId,
								principal: current().id,
								source: null,
								target: saved,
								text: data.text,
								mode: data.mode,
							},
							authorize,
						),
					);
				},
				receipt: async (id: string) => {
					const provider = await receiptProvider(id);
					return provider ? provider.receipt(id) : receiptCheck(await ownedReceipt(id));
				},
				wait: async (id: string, signal?: AbortSignal) => {
					const provider = await receiptProvider(id);
					if (provider) return provider.wait(id, signal);
					const value = await ownedReceipt(id);
					const authorize = () => {
						current();
						check("read", value.target);
					};
					return receiptCheck(await catalog.wait(id, authorize, signal));
				},
				withdraw: async (id: string) => {
					const provider = await receiptProvider(id);
					if (provider) return provider.withdraw(id);
					const value = await ownedReceipt(id, "send");
					const authorize = () => {
						current();
						check("send", value.target);
					};
					return receiptCheck(await catalog.withdraw(id, authorize));
				},
				abort: async (ref: ConversationRef) => {
					const saved = structuredClone(ref),
						authorize = () => check("manage", saved);
					authorize();
					const provider = await resource(saved, authorize);
					if (provider) return provider.abort(saved, authorize);
					await catalog.stop(saved, authorize);
				},
			});
		},
	});
}
