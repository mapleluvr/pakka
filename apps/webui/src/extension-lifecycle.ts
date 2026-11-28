import { randomUUID } from "node:crypto";
import type { JsonObject, Runtime, RuntimeRecordsCommit } from "@pakka/agent";
import type { PocketAuthority, PocketPeople } from "@pakka/server/pocket";
import { extensionId, frozen, isRecord } from "@pakka/protocol/extensions";
import type {
	ExtensionControlIdentity,
	ExtensionControlReceipt,
	ExtensionFacet,
	ExtensionFacetControl,
} from "@pakka/protocol/extensions";
import {
	decodeControlIdentity,
	decodeControlReceipt,
	decodeFacetControl,
	decodeJson,
	isExtensionFacet,
} from "@pakka/protocol/extension-rpc";
import {
	activateBackend,
	checkAgentSource,
	ExtensionRefusal,
	facetKey,
	hash,
	prepareFacets,
	refuse,
} from "./extension-source.ts";
import type { AcceptedFacet, ExtensionSource } from "./extension-source.ts";

interface FacetState {
	readonly schema: 1;
	readonly extension: string;
	readonly facet: ExtensionFacet;
	readonly hash: string;
	readonly generation: string;
	readonly enabled: boolean;
	/** Unconfirmed initialization is retained even when admission has subsequently been disabled. */
	readonly initialization: "loading" | "ready" | "unknown";
}
interface FacetLifecycleOptions {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly sources: readonly ExtensionSource[];
	readonly hasService: (name: string) => boolean;
	readonly legacy: {
		readonly disabled: readonly string[];
		readonly initializations: readonly {
			readonly extension: string;
			readonly state: "loading" | "ready" | "unknown";
		}[];
	};
	readonly initializationTimeoutMs?: number;
}
function decodeState(value: unknown, extension: string, facet: ExtensionFacet): FacetState {
	if (
		!isRecord(value) ||
		Object.keys(value).sort().join(",") !== "enabled,extension,facet,generation,hash,initialization,schema" ||
		value.schema !== 1 ||
		!extensionId(value.extension) ||
		value.extension !== extension ||
		!isExtensionFacet(value.facet) ||
		value.facet !== facet ||
		typeof value.enabled !== "boolean" ||
		typeof value.hash !== "string" ||
		!/^[a-f0-9]{64}$/.test(value.hash) ||
		typeof value.generation !== "string" ||
		!/^[A-Za-z0-9_.:-]{1,160}$/.test(value.generation) ||
		!["loading", "ready", "unknown"].some((state) => state === value.initialization)
	)
		throw Error("Invalid saved facet state");
	// SAFETY: every closed state field and its owning facet were validated above.
	return value as unknown as FacetState;
}
function data(value: unknown): JsonObject {
	const result = decodeJson(value);
	if (!isRecord(result)) throw Error("Expected facet record object");
	// SAFETY: finite public JSON was decoded above; these records contain no native objects.
	return structuredClone(result) as JsonObject;
}
const stateKey = (extension: string, facet: ExtensionFacet) => "facet:" + facetKey(extension, facet);
const controlKey = (actorId: string, requestId: string) =>
	"control:" + hash(JSON.stringify([actorId, requestId]));
const sameChange = (left: ExtensionFacetControl, right: ExtensionFacetControl) =>
	left.extension === right.extension &&
	left.facet === right.facet &&
	left.requestId === right.requestId &&
	left.action === right.action &&
	left.expectedGeneration === right.expectedGeneration;
const commands = (entry: AcceptedFacet) =>
	entry.view.manifest.commands.filter((command) =>
		entry.view.facet === "backend"
			? command.action !== undefined
			: entry.view.facet === "webui" && command.interface !== undefined,
	);

/** Per-facet admission/publication. Resource-owned jobs, Backend operations and service disposal stay outside this object. */
export async function createFacetLifecycle(options: FacetLifecycleOptions) {
	const { runtime, people } = options;
	const timeoutMs = options.initializationTimeoutMs ?? 10000;
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 25 || timeoutMs > 30000)
		return refuse("INVALID_REQUEST");
	const records = runtime.records({ namespace: "pakka.extension-facets" });
	const entries = new Map<string, AcceptedFacet>();
	// Reserve names only while the admission record is committing; slow initialization never blocks other facets.
	const reservations = new Map<string, AcceptedFacet>();
	const lanes = new Map<string, Promise<void>>();
	const active = new Set<Promise<unknown>>();
	const stops = new Set<() => void>();
	let closed = false;
	let closing: Promise<void> | undefined;
	const live = () => {
		if (closed || runtime.view().phase !== "ready") return refuse();
	};
	const authority = (actor: PocketAuthority) => {
		live();
		try {
			const person = people.current(actor);
			people.check(actor, "extensions.install");
			return person;
		} catch {
			return refuse();
		}
	};
	const owned = () => {
		if (runtime.view().phase !== "ready") return refuse();
	};
	async function commit(input: Omit<RuntimeRecordsCommit, "requestId">, check: () => void) {
		const requestId = "facet-journal:" + randomUUID();
		try {
			await records.commit({ ...input, requestId }, check);
		} catch (error) {
			// A lost/post-commit response must not be mistaken for a missing write. This is read-only reconciliation.
			if (await records.receipt(requestId, owned)) return;
			throw error;
		}
	}
	async function saved(entry: AcceptedFacet, check: () => void) {
		const key = stateKey(entry.view.manifest.id, entry.view.facet),
			row = await records.get(key, check);
		return {
			key,
			version: row.version,
			value: row.data ? decodeState(row.data, entry.view.manifest.id, entry.view.facet) : null,
		};
	}
	async function original(actorId: string, requestId: string, check: () => void) {
		const key = controlKey(actorId, requestId),
			row = await records.get(key, check);
		const value = row.data ? decodeControlReceipt(row.data) : null;
		if (value && (value.actorId !== actorId || value.requestId !== requestId))
			throw Error("Foreign control receipt");
		return { key, version: row.version, value };
	}
	const state = (
		entry: AcceptedFacet,
		enabled: boolean,
		initialization: FacetState["initialization"],
	): FacetState => ({
		schema: 1,
		extension: entry.view.manifest.id,
		facet: entry.view.facet,
		hash: entry.hash,
		generation: entry.view.generation,
		enabled,
		initialization,
	});
	function collision(candidate: AcceptedFacet, except?: string) {
		const key = facetKey(candidate.view.manifest.id, candidate.view.facet);
		for (const [other, entry] of [...entries, ...reservations])
			if (
				other !== except &&
				(other === key ||
					commands(entry).some((command) => commands(candidate).some((next) => next.slash === command.slash)))
			)
				return refuse("CONFLICT");
		if (candidate.view.facet === "backend")
			for (const service of candidate.view.manifest.services ?? [])
				if (!options.hasService(service)) return refuse("UNSUPPORTED");
	}
	async function bounded(effect: (check: () => void) => Promise<void>, check: () => void) {
		let alive = true;
		let stop!: () => void;
		const interrupted = new Promise<never>((_, reject) => {
			stop = () => {
				alive = false;
				reject(Error("Unconfirmed facet initialization"));
			};
		});
		const timer = setTimeout(() => stop(), timeoutMs);
		stops.add(stop);
		try {
			await Promise.race([
				effect(() => {
					if (!alive) return refuse();
					check();
				}),
				interrupted,
			]);
		} finally {
			alive = false;
			clearTimeout(timer);
			stops.delete(stop);
		}
	}
	async function activate(entry: AcceptedFacet, enabled: boolean, reconcile: boolean, check: () => void) {
		await bounded(async (guard) => {
			guard();
			if (entry.view.facet === "agent") {
				await checkAgentSource(entry);
				guard();
				if (reconcile || entry.source.agent!.status().phase === "unknown")
					entry.source.agent!.reconcile(enabled);
				else entry.source.agent!.setEnabled(enabled);
			} else if (entry.view.facet === "backend" && enabled) await activateBackend(entry, guard);
			guard();
		}, check);
	}
	function quarantine(entry: AcceptedFacet) {
		entry.view = frozen({ ...entry.view, phase: "unknown" });
		if (entry.view.facet === "agent") {
			// Safety withdrawal is not cancellation of an admitted tool or persistent job.
			try {
				entry.source.agent!.reconcile(false);
			} catch {
				/* The native source also stays unknown and rejects new tool invocations. */
			}
		}
	}
	function serialize<T>(key: string, effect: () => Promise<T>): Promise<T> {
		const operation = (lanes.get(key) ?? Promise.resolve()).then(effect);
		const tail = operation.then(
			() => {},
			() => {},
		);
		lanes.set(key, tail);
		active.add(operation);
		void tail.then(() => {
			active.delete(operation);
			if (lanes.get(key) === tail) lanes.delete(key);
		});
		return operation;
	}
	// Preparation for the whole installation batch precedes any module/registry effects.
	const installationIds = new Set<string>();
	for (const source of options.sources) {
		const prepared = await prepareFacets(source);
		if (!prepared.length) continue;
		const id = prepared[0]!.view.manifest.id;
		if (installationIds.has(id)) return refuse("CONFLICT");
		installationIds.add(id);
		for (const entry of prepared) {
			collision(entry);
			entries.set(facetKey(id, entry.view.facet), entry);
		}
	}
	async function initialize(entry: AcceptedFacet) {
		const before = await saved(entry, live);
		const enabled = before.value?.enabled ?? !options.legacy.disabled.includes(entry.view.manifest.id);
		const uncertain = before.value
			? before.value.initialization !== "ready"
			: entry.view.facet === "backend" &&
				options.legacy.initializations.some(
					(row) => row.extension === entry.view.manifest.id && row.state !== "ready",
				);
		const needsActivation = enabled && !uncertain;
		const beginning = state(entry, enabled, uncertain ? "unknown" : needsActivation ? "loading" : "ready");
		await commit(
			{
				reads: [{ key: before.key, version: before.version }],
				writes: [{ key: before.key, data: data(beginning) }],
				append: [],
			},
			live,
		);
		entry.view = frozen({ ...entry.view, phase: enabled ? "unknown" : "disabled" });
		if (!needsActivation) {
			if (entry.view.facet === "agent") {
				try {
					entry.source.agent!.reconcile(false);
				} catch {
					quarantine(entry);
					const current = await saved(entry, owned);
					await commit(
						{
							reads: [{ key: current.key, version: current.version }],
							writes: [{ key: current.key, data: data(state(entry, enabled, "unknown")) }],
							append: [],
						},
						owned,
					);
				}
			}
			return;
		}
		try {
			await activate(entry, true, false, live);
			const current = await saved(entry, live);
			await commit(
				{
					reads: [{ key: current.key, version: current.version }],
					writes: [{ key: current.key, data: data(state(entry, true, "ready")) }],
					append: [],
				},
				live,
			);
			entry.view = frozen({ ...entry.view, phase: "ready" });
		} catch {
			quarantine(entry);
			const current = await saved(entry, owned);
			await commit(
				{
					reads: [{ key: current.key, version: current.version }],
					writes: [{ key: current.key, data: data(state(entry, true, "unknown")) }],
					append: [],
				},
				owned,
			);
		}
	}
	const initialized = await Promise.allSettled([...entries.values()].map(initialize));
	const errors = initialized.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
	if (errors.length) {
		closed = true;
		for (const entry of entries.values()) quarantine(entry);
		throw new AggregateError(errors, "Unconfirmed facet installation persistence");
	}
	async function control(
		actor: PocketAuthority,
		input: ExtensionFacetControl,
	): Promise<ExtensionControlReceipt> {
		const change = decodeFacetControl(input),
			person = authority(actor),
			key = facetKey(change.extension, change.facet);
		return serialize(key, async () => {
			const check = () => {
				if (authority(actor).id !== person.id) return refuse();
			};
			const prior = await original(person.id, change.requestId, check);
			if (prior.value) {
				if (!sameChange(prior.value, change)) return refuse("CONFLICT");
				check();
				return prior.value;
			}
			const previous = entries.get(key);
			if (!previous || previous.view.generation !== change.expectedGeneration) return refuse("CONFLICT");
			const before = await saved(previous, check);
			if (!before.value || before.value.generation !== previous.view.generation) return refuse("CONFLICT");
			if (change.action === "enable" && before.value.initialization !== "ready") return refuse("CONFLICT");
			let next: AcceptedFacet;
			if (change.action === "reload") {
				[next] = await prepareFacets(previous.source, change.facet);
				if (
					!next ||
					next.view.manifest.id !== change.extension ||
					(change.facet === "agent" && next.codeHash !== previous.codeHash)
				)
					return refuse("UNSUPPORTED");
			} else
				next = {
					...previous,
					view: frozen({ ...previous.view, generation: previous.hash + "-" + randomUUID() }),
				};
			check();
			if (entries.get(key) !== previous) return refuse("CONFLICT");
			const enabled =
				change.action === "disable" ? false : change.action === "enable" ? true : before.value.enabled;
			const unknown: ExtensionControlReceipt = frozen({ ...change, actorId: person.id, state: "unknown" });
			collision(next, key);
			reservations.set(key, next);
			try {
				await commit(
					{
						reads: [
							{ key: before.key, version: before.version },
							{ key: prior.key, version: prior.version },
						],
						writes: [
							{ key: before.key, data: data(state(next, enabled, "loading")) },
							{ key: prior.key, data: data(unknown) },
						],
						append: [],
						work: [{ key: prior.key, state: "unknown" }],
					},
					check,
				);
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "conflict") return refuse("CONFLICT");
				entries.set(key, next);
				quarantine(next);
				throw new ExtensionRefusal("CONFLICT", "unknown");
			} finally {
				reservations.delete(key);
			}
			next.view = frozen({ ...next.view, phase: "unknown" });
			entries.set(key, next);
			let receipt: ExtensionControlReceipt = unknown;
			try {
				await activate(next, enabled, change.action === "reload", () => {
					check();
					if (entries.get(key) !== next) return refuse();
				});
				check();
				const initialization =
					change.action === "disable" && before.value.initialization !== "ready" ? "unknown" : "ready";
				const publication = {
					version: next.view.manifest.version,
					generation: next.view.generation,
					phase: enabled ? ("ready" as const) : ("disabled" as const),
				};
				const done: ExtensionControlReceipt = frozen({
					...change,
					actorId: person.id,
					state: "done",
					publication,
				});
				const latest = await saved(next, check),
					operation = await original(person.id, change.requestId, check);
				if (
					latest.value?.generation !== next.view.generation ||
					operation.value?.state !== "unknown" ||
					!sameChange(operation.value, change)
				)
					throw Error("Changed facet publication identity");
				await commit(
					{
						reads: [
							{ key: latest.key, version: latest.version },
							{ key: operation.key, version: operation.version },
						],
						writes: [
							{ key: latest.key, data: data(state(next, enabled, initialization)) },
							{ key: operation.key, data: data(done) },
						],
						append: [],
						work: [{ key: operation.key, state: null }],
					},
					check,
				);
				next.view = frozen({ ...next.view, phase: publication.phase });
				receipt = done;
			} catch {
				quarantine(next);
				const latest = await saved(next, owned);
				await commit(
					{
						reads: [{ key: latest.key, version: latest.version }],
						writes: [{ key: latest.key, data: data(state(next, enabled, "unknown")) }],
						append: [],
					},
					owned,
				);
			}
			// Returning a result requires current authority; refusal here does not undo or mislabel the durable effect.
			try {
				check();
			} catch {
				throw new ExtensionRefusal("FORBIDDEN", "unknown");
			}
			return receipt;
		});
	}
	return {
		entries,
		live,
		control,
		async controlByRequest(
			actor: PocketAuthority,
			input: ExtensionControlIdentity,
		): Promise<ExtensionControlReceipt | null> {
			const request = decodeControlIdentity(input),
				person = authority(actor),
				check = () => {
					authority(actor);
				};
			const row = await original(person.id, request.requestId, check);
			if (row.value && (row.value.extension !== request.extension || row.value.facet !== request.facet))
				return refuse();
			check();
			return row.value;
		},
		close() {
			if (closing) return closing;
			closed = true;
			// Seal admission now, and retain one shutdown result even when withdrawal fails.
			closing = Promise.resolve().then(async () => {
				for (const stop of [...stops]) stop();
				const failures: unknown[] = [];
				for (const entry of entries.values()) {
					entry.view = frozen({ ...entry.view, phase: "disabled" });
					if (entry.view.facet === "agent")
						try {
							entry.source.agent!.reconcile(false);
						} catch (error) {
							failures.push(error);
						}
				}
				await Promise.allSettled([...active]);
				if (failures.length) throw new AggregateError(failures, "Unconfirmed Agent facet withdrawal");
			});
			return closing;
		},
	};
}
