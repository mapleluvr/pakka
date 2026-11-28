import { randomUUID } from "node:crypto";
import type { HostOptions } from "./types.ts";

type AgentTool = NonNullable<HostOptions["tools"]>[number];

/** Trusted code contribution; its profile ceiling is fixed before a Runtime opens. */
export interface AgentFacetDefinition {
	readonly id: string;
	readonly version: string;
	readonly profiles: readonly string[];
	readonly tools: readonly AgentTool[];
	readonly instructions?: string;
}
export interface AgentFacetStatus {
	readonly generation: string;
	readonly phase: "ready" | "disabled" | "unknown";
	/** Attached native registries, not open UI instances or running jobs. */
	readonly bindings: number;
}
/** Trusted composition/control port. Possessing this object is not browser authority. */
export interface AgentFacet {
	readonly id: string;
	readonly version: string;
	readonly profiles: readonly string[];
	status(): AgentFacetStatus;
	setEnabled(enabled: boolean): void;
	/** Re-publish this fixed definition after an unconfirmed publication; does not import code. */
	reconcile(enabled: boolean): void;
}
interface Source {
	readonly definition: AgentFacetDefinition;
	readonly listeners: Set<() => void>;
	generation: string;
	phase: AgentFacetStatus["phase"];
}
const sources = new WeakMap<AgentFacet, Source>();
function freeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

/** Starts disabled. Only explicit trusted control publishes the contribution to its bound profiles. */
export function createAgentFacet(input: AgentFacetDefinition): AgentFacet {
	if (
		!input ||
		typeof input.id !== "string" ||
		typeof input.version !== "string" ||
		!/^[a-z][a-z0-9-]{0,63}$/.test(input.id) ||
		!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(input.version) ||
		!Array.isArray(input.profiles) ||
		input.profiles.length < 1 ||
		input.profiles.length > 64 ||
		new Set(input.profiles).size !== input.profiles.length ||
		input.profiles.some((id) => typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) ||
		!Array.isArray(input.tools) ||
		input.tools.length > 64 ||
		(input.instructions !== undefined && typeof input.instructions !== "string")
	)
		throw Error("Invalid approved Agent facet");
	const tools = input.tools.map((tool) => {
		if (
			!tool ||
			typeof tool.name !== "string" ||
			!/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(tool.name) ||
			typeof tool.description !== "string" ||
			!tool.parameters ||
			typeof tool.parameters !== "object" ||
			Array.isArray(tool.parameters) ||
			typeof tool.execute !== "function"
		)
			throw Error("Invalid approved Agent tool");
		return freeze({ ...tool, parameters: structuredClone(tool.parameters) });
	});
	if (new Set(tools.map((tool) => tool.name)).size !== tools.length)
		throw Error("Duplicate Agent facet tool");
	const definition = freeze({
		id: input.id,
		version: input.version,
		profiles: [...input.profiles],
		tools,
		...(input.instructions === undefined ? {} : { instructions: input.instructions }),
	});
	const source: Source = { definition, listeners: new Set(), generation: randomUUID(), phase: "disabled" };
	let publishing = false;
	function publish(enabled: boolean, reconcile: boolean) {
		if (typeof enabled !== "boolean" || publishing) throw Error("Invalid Agent facet transition");
		if (source.phase === "unknown" && !reconcile) throw Error("Agent facet publication is unconfirmed");
		const phase = enabled ? "ready" : "disabled";
		if (!reconcile && source.phase === phase) return;
		publishing = true;
		source.generation = randomUUID();
		source.phase = phase;
		const errors: unknown[] = [];
		try {
			for (const listener of [...source.listeners]) {
				try {
					listener();
				} catch (error) {
					errors.push(error);
				}
			}
			if (errors.length) {
				source.phase = "unknown";
				for (const listener of [...source.listeners]) {
					try {
						listener();
					} catch (error) {
						errors.push(error);
					}
				}
				throw new AggregateError(errors, "Agent facet publication is unconfirmed");
			}
		} finally {
			publishing = false;
		}
	}
	const facet: AgentFacet = Object.freeze({
		id: definition.id,
		version: definition.version,
		profiles: definition.profiles,
		status: () =>
			Object.freeze({ generation: source.generation, phase: source.phase, bindings: source.listeners.size }),
		setEnabled: (enabled: boolean) => publish(enabled, false),
		reconcile: (enabled: boolean) => publish(enabled, true),
	});
	sources.set(facet, source);
	return facet;
}

export class AgentFacetRevoked extends Error {}

/** Package-internal adapter access; not a public package export and contains no Pi objects. */
export function agentFacetSource(facet: AgentFacet) {
	const source = sources.get(facet);
	if (!source) throw Error("Agent facet must be created by the public Agent SDK");
	return {
		definition: source.definition,
		check(generation: string) {
			if (source.phase !== "ready" || source.generation !== generation)
				throw new AgentFacetRevoked("Agent facet invocation is no longer active");
		},
		subscribe(listener: () => void) {
			source.listeners.add(listener);
			return () => {
				source.listeners.delete(listener);
			};
		},
	};
}
