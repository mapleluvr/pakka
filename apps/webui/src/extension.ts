/** Inert, browser-safe public extension declarations. No server, Pi or provider imports. */
export type ExtensionJson =
	| null
	| boolean
	| number
	| string
	| readonly ExtensionJson[]
	| { readonly [key: string]: ExtensionJson };
export type Schema =
	| { readonly type: "null" | "boolean" }
	| { readonly type: "string"; readonly maxLength: number; readonly minLength?: number }
	| { readonly type: "number" | "integer"; readonly minimum: number; readonly maximum: number }
	| { readonly type: "array"; readonly items: Schema; readonly maxItems: number }
	| {
			readonly type: "object";
			readonly properties: Readonly<Record<string, Schema>>;
			readonly required: readonly string[];
	  }
	| { readonly enum: readonly (null | boolean | number | string)[] }
	| { readonly anyOf: readonly Schema[] };
export type ExtensionPermission = "read" | "send" | "steer" | "manage" | "extensions.install";
export interface ExtensionAction {
	readonly id: string;
	readonly version: number;
	readonly scope: "app" | "conversation";
	readonly permission: ExtensionPermission;
	readonly effect: "read" | "write" | "model";
	readonly timeoutMs: number;
	readonly input: Schema;
	readonly output: Schema;
}
export interface ExtensionCommand {
	readonly id: string;
	readonly title: string;
	readonly slash: string;
	readonly action?: string;
	readonly interface?: string;
}
export interface ExtensionInterface {
	readonly id: string;
	readonly title: string;
	readonly slot: "page" | "sheet" | "panel" | "settings";
	readonly scope: "app" | "conversation";
	readonly export: string;
	readonly navigation: boolean;
}
export type ExtensionFacet = "agent" | "backend" | "webui" | "client";
export interface ExtensionManifest {
	readonly api: 1;
	readonly id: string;
	readonly version: string;
	readonly title: string;
	readonly facets: {
		readonly agent?: string;
		readonly backend?: string;
		readonly client?: string;
		readonly webui?: { readonly entry: string; readonly publicDir: string };
	};
	readonly services?: readonly string[];
	readonly jobs?: readonly string[];
	readonly actions: readonly ExtensionAction[];
	readonly commands: readonly ExtensionCommand[];
	readonly interfaces: readonly ExtensionInterface[];
}
export interface ExtensionRegistration {
	readonly manifest: ExtensionManifest;
	readonly generation: string;
	readonly facets: readonly ExtensionFacet[];
	readonly phase: "ready" | "disabled" | "unknown";
}
export interface ExtensionCall {
	readonly extension: string;
	readonly generation: string;
	readonly action: string;
	readonly requestId: string;
	readonly input: ExtensionJson;
	readonly target?: {
		readonly key: string;
		readonly sessionId: string;
		readonly conversationId: string;
		readonly incarnation: string;
		readonly profile: string;
	};
}
export interface ExtensionOperation {
	readonly id: string;
	readonly extension: string;
	readonly action: string;
	readonly actorId: string;
	readonly requestId: string;
	readonly state: "done" | "unknown";
	readonly value?: ExtensionJson;
}
export function frozen<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) frozen(child);
		Object.freeze(value);
	}
	return value;
}
export function isRecord(value: unknown): value is Record<string, unknown> {
	return (
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		[Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
		Object.getOwnPropertySymbols(value).length === 0
	);
}
function shape(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
	if (
		!isRecord(value) ||
		required.some((key) => !Object.hasOwn(value, key)) ||
		Object.keys(value).some((key) => ![...required, ...optional].includes(key))
	)
		throw new Error("Invalid closed extension declaration");
}
export function extensionId(value: unknown): value is string {
	return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}
function key(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[A-Za-z_][A-Za-z0-9_.-]{0,79}$/.test(value) &&
		!["__proto__", "constructor", "prototype"].includes(value)
	);
}
function title(value: unknown): value is string {
	return typeof value === "string" && !!value.trim() && value.length <= 120 && !/[\x00-\x1f\x7f]/.test(value);
}
function bound(value: unknown, min: number, max: number): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
export function publicPath(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 240 &&
		value.split("/").every((segment) => /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(segment))
	);
}
function list(value: unknown, max: number): asserts value is unknown[] {
	if (!Array.isArray(value) || value.length > max) throw new Error("Extension declaration capacity exceeded");
}
function scalar(value: unknown): value is null | boolean | string | number {
	return (
		value === null ||
		typeof value === "boolean" ||
		(typeof value === "string" && value.length <= 4096) ||
		(typeof value === "number" && Number.isFinite(value))
	);
}
export function decodeSchema(value: unknown, depth = 0): Schema {
	if (depth > 12 || !isRecord(value)) throw new Error("Invalid finite extension schema");
	if ("enum" in value) {
		shape(value, ["enum"]);
		list(value.enum, 64);
		if (!value.enum.length || !value.enum.every(scalar)) throw new Error("Invalid schema enum");
	} else if ("anyOf" in value) {
		shape(value, ["anyOf"]);
		list(value.anyOf, 8);
		if (!value.anyOf.length) throw new Error("Empty schema alternatives");
		for (const item of value.anyOf) decodeSchema(item, depth + 1);
	} else
		switch (value.type) {
			case "null":
			case "boolean":
				shape(value, ["type"]);
				break;
			case "string":
				shape(value, ["type", "maxLength"], ["minLength"]);
				if (
					!bound(value.maxLength, 0, 262144) ||
					(value.minLength !== undefined && !bound(value.minLength, 0, value.maxLength))
				)
					throw new Error("Invalid bounded string schema");
				break;
			case "integer":
			case "number":
				shape(value, ["type", "minimum", "maximum"]);
				if (
					typeof value.minimum !== "number" ||
					typeof value.maximum !== "number" ||
					!Number.isFinite(value.minimum) ||
					!Number.isFinite(value.maximum) ||
					value.minimum > value.maximum ||
					Math.abs(value.minimum) > Number.MAX_SAFE_INTEGER ||
					Math.abs(value.maximum) > Number.MAX_SAFE_INTEGER
				)
					throw new Error("Invalid bounded number schema");
				break;
			case "array":
				shape(value, ["type", "maxItems", "items"]);
				if (!bound(value.maxItems, 0, 512)) throw new Error("Invalid bounded array schema");
				decodeSchema(value.items, depth + 1);
				break;
			case "object": {
				shape(value, ["type", "properties", "required"]);
				if (
					!isRecord(value.properties) ||
					Object.keys(value.properties).length > 64 ||
					!Object.keys(value.properties).every(key)
				)
					throw new Error("Invalid object schema fields");
				list(value.required, 64);
				if (
					!value.required.every(
						(item) => typeof item === "string" && Object.hasOwn(value.properties as object, item),
					) ||
					new Set(value.required).size !== value.required.length
				)
					throw new Error("Invalid required fields");
				for (const item of Object.values(value.properties)) decodeSchema(item, depth + 1);
				break;
			}
			default:
				throw new Error("Unsupported extension schema");
		}
	// SAFETY: every schema variant, required field, finite bound and nested schema was checked above.
	return frozen(structuredClone(value)) as unknown as Schema;
}
export function decodeValue(schema: Schema, value: unknown): ExtensionJson {
	decodeSchema(schema);
	let nodes = 0;
	function check(rule: Schema, item: unknown, depth: number): boolean {
		if (depth > 16 || ++nodes > 8192) throw new Error("Extension payload capacity exceeded");
		if ("enum" in rule) return rule.enum.includes(item as null);
		if ("anyOf" in rule) return rule.anyOf.some((alternative) => check(alternative, item, depth + 1));
		switch (rule.type) {
			case "null":
				return item === null;
			case "boolean":
				return typeof item === "boolean";
			case "string":
				return (
					typeof item === "string" && item.length <= rule.maxLength && item.length >= (rule.minLength ?? 0)
				);
			case "integer":
			case "number":
				return (
					typeof item === "number" &&
					Number.isFinite(item) &&
					(rule.type !== "integer" || Number.isSafeInteger(item)) &&
					item >= rule.minimum &&
					item <= rule.maximum
				);
			case "array":
				return (
					Array.isArray(item) &&
					item.length <= rule.maxItems &&
					Object.keys(item).length === item.length &&
					item.every((child) => check(rule.items, child, depth + 1))
				);
			case "object":
				return (
					isRecord(item) &&
					rule.required.every((key) => Object.hasOwn(item, key)) &&
					Object.keys(item).every(
						(key) =>
							Object.hasOwn(rule.properties, key) && check(rule.properties[key]!, item[key], depth + 1),
					)
				);
		}
	}
	if (!check(schema, value, 0)) throw new Error("Extension payload rejected by declared schema");
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 262144)
		throw new Error("Extension payload capacity exceeded");
	return frozen(structuredClone(value)) as ExtensionJson;
}
export function decodeManifest(value: unknown): ExtensionManifest {
	shape(
		value,
		["api", "id", "version", "title", "facets", "actions", "commands", "interfaces"],
		["services", "jobs"],
	);
	if (
		value.api !== 1 ||
		!extensionId(value.id) ||
		typeof value.version !== "string" ||
		!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value.version) ||
		!title(value.title)
	)
		throw new Error("Incompatible extension identity");
	shape(value.facets, [], ["agent", "backend", "webui", "client"]);
	if (!Object.keys(value.facets).length) throw new Error("Extension needs a declared facet");
	for (const facet of ["agent", "backend", "client"])
		if (value.facets[facet] !== undefined && !publicPath(value.facets[facet]))
			throw new Error("Unsafe extension entry");
	if (value.facets.webui !== undefined) {
		shape(value.facets.webui, ["entry", "publicDir"]);
		if (!publicPath(value.facets.webui.entry) || !publicPath(value.facets.webui.publicDir))
			throw new Error("Unsafe WebUI entry");
	}
	for (const name of ["services", "jobs"])
		if (value[name] !== undefined) {
			list(value[name], 32);
			if (!value[name].every(extensionId) || new Set(value[name]).size !== value[name].length)
				throw new Error("Invalid extension service names");
		}
	list(value.actions, 64);
	list(value.commands, 64);
	list(value.interfaces, 32);
	const ids = (items: unknown[], field: string) => {
		const keys = items.map((item) => (isRecord(item) ? item[field] : null));
		if (new Set(keys).size !== keys.length) throw new Error("Duplicate extension declaration");
	};
	ids(value.actions, "id");
	ids(value.commands, "id");
	ids(value.commands, "slash");
	ids(value.interfaces, "id");
	for (const row of value.actions) {
		shape(row, ["id", "version", "scope", "permission", "effect", "timeoutMs", "input", "output"]);
		if (
			!extensionId(row.id) ||
			!bound(row.version, 1, 100000) ||
			typeof row.scope !== "string" ||
			!["app", "conversation"].includes(row.scope) ||
			typeof row.permission !== "string" ||
			!["read", "send", "steer", "manage", "extensions.install"].includes(row.permission) ||
			typeof row.effect !== "string" ||
			!["read", "write", "model"].includes(row.effect) ||
			!bound(row.timeoutMs, 25, 30000)
		)
			throw new Error("Invalid action policy");
		decodeSchema(row.input);
		decodeSchema(row.output);
	}
	if (value.actions.length && !value.facets.backend) throw new Error("Actions require backend facet");
	for (const row of value.commands) {
		shape(row, ["id", "title", "slash"], ["action", "interface"]);
		if (
			!extensionId(row.id) ||
			!title(row.title) ||
			!extensionId(row.slash) ||
			["help", "login", "logout", "clear", "new"].includes(row.slash) ||
			(typeof row.action === "string") === (typeof row.interface === "string") ||
			(row.action !== undefined &&
				!value.actions.some((action) => isRecord(action) && action.id === row.action)) ||
			(row.interface !== undefined &&
				!value.interfaces.some((view) => isRecord(view) && view.id === row.interface))
		)
			throw new Error("Invalid command reference");
	}
	for (const row of value.interfaces) {
		shape(row, ["id", "title", "slot", "scope", "export", "navigation"]);
		if (
			!extensionId(row.id) ||
			!title(row.title) ||
			typeof row.slot !== "string" ||
			!["page", "sheet", "panel", "settings"].includes(row.slot) ||
			typeof row.scope !== "string" ||
			!["app", "conversation"].includes(row.scope) ||
			!key(row.export) ||
			typeof row.navigation !== "boolean" ||
			!value.facets.webui
		)
			throw new Error("Invalid public interface");
	}
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	if (bytes.byteLength > 131072) throw new Error("Extension manifest capacity exceeded");
	// SAFETY: the closed manifest and each facet, action/schema, command reference and interface were validated above.
	return frozen(structuredClone(value)) as unknown as ExtensionManifest;
}
