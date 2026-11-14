import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { applyEdits, getNodeValue, modify, parseTree, visit, type ParseError } from "jsonc-parser";
import { decodeJson } from "@pakka/protocol/extension-rpc";
import { isRecord, type ExtensionJson } from "@pakka/protocol/extensions";
import type { ModelConfigurationChange, ModelConfigurationPath } from "@pakka/protocol/webui";
import { assertPlainPath } from "./private-files.ts";
import { WebUiServiceRefusal } from "./service-refusal.ts";

export interface ModelFileSnapshot {
	readonly content: string;
	readonly digest: string;
	readonly document: Readonly<Record<string, ExtensionJson>>;
}
const MAX_BYTES = 1_048_576;
export const modelFileDigest = (content: string) => createHash("sha256").update(content).digest("hex");
function document(content: string): Readonly<Record<string, ExtensionJson>> {
	if (Buffer.byteLength(content) > MAX_BYTES) throw new WebUiServiceRefusal("CAPACITY");
	const source = content.replace(/^\uFEFF/, "");
	const errors: ParseError[] = [];
	const node = parseTree(source, errors, { allowTrailingComma: false, allowEmptyContent: false });
	if (errors.length || !node || node.type !== "object") throw new WebUiServiceRefusal("INVALID_REQUEST");
	const properties = new Set<string>();
	visit(source, {
		onObjectProperty: (key, _offset, _length, _line, _character, path) => {
			const identity = JSON.stringify([...path(), key]);
			if (properties.has(identity)) throw new WebUiServiceRefusal("INVALID_REQUEST");
			properties.add(identity);
		},
		onLiteralValue: (value) => {
			if (typeof value === "number" && !Number.isFinite(value))
				throw new WebUiServiceRefusal("INVALID_REQUEST");
		},
	});
	// The public AST evaluator uses null-prototype objects and retains native private keys.
	// Public wire constraints apply only after redaction, not to opaque native subtrees.
	return getNodeValue(node) as Readonly<Record<string, ExtensionJson>>;
}
export async function readModelFile(path: string): Promise<ModelFileSnapshot> {
	let before;
	try {
		before = await lstat(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return { content: "{}\n", digest: "missing", document: {} };
		throw error;
	}
	await assertPlainPath(path);
	if (!before.isFile() || before.nlink !== 1) throw new WebUiServiceRefusal("FORBIDDEN");
	if (before.size > MAX_BYTES) throw new WebUiServiceRefusal("CAPACITY");
	const bytes = await readFile(path);
	const after = await lstat(path);
	if (
		before.ino !== after.ino ||
		before.dev !== after.dev ||
		before.size !== after.size ||
		before.mtimeMs !== after.mtimeMs
	)
		throw new WebUiServiceRefusal("CONFLICT");
	const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	return { content, digest: modelFileDigest(content), document: document(content) };
}
function privateField(key: string, value: unknown): boolean {
	if (/^(?:apiKey|oauth|headers)$/i.test(key) || /(?:password|credential|secret|token)$/i.test(key))
		return true;
	if (key === "baseUrl" && typeof value === "string") {
		try {
			const url = new URL(value);
			return (
				!!url.username ||
				!!url.password ||
				[...url.searchParams.keys()].some((name) =>
					/(?:key|auth|password|secret|token|signature)/i.test(name),
				)
			);
		} catch {
			return true;
		}
	}
	return false;
}
/** Preserve protected subtrees without exposing values, executable sources or raw parse errors. */
export function publicModelDocument(input: Readonly<Record<string, unknown>>) {
	const protectedValues = new Map<string, unknown>();
	const protectedPaths: ModelConfigurationPath[] = [];
	const walk = (value: unknown, path: ModelConfigurationPath): unknown => {
		if (Array.isArray(value)) return value.map((child, index) => walk(child, [...path, index]));
		if (!isRecord(value)) return value;
		const result: Record<string, unknown> = Object.create(null);
		for (const key of Object.keys(value)) {
			const location = [...path, key];
			// Provider and model IDs are dictionary identities, not configuration field names.
			const dictionary =
				(path.length === 1 && path[0] === "providers") ||
				(path.length === 3 && path[0] === "providers" && path[2] === "modelOverrides");
			if (!dictionary && privateField(key, value[key])) {
				protectedValues.set(JSON.stringify(location), value[key]);
				protectedPaths.push(location);
			} else result[key] = walk(value[key], location);
		}
		return result;
	};
	const value = decodeJson(walk(input, []));
	if (!isRecord(value)) throw new Error("Invalid model document root");
	return { document: value, protectedPaths, protectedValues };
}
export function editModelFile(
	previous: ModelFileSnapshot,
	change: ModelConfigurationChange,
): ModelFileSnapshot {
	const protectedBefore = publicModelDocument(previous.document).protectedValues;
	const bom = previous.content.startsWith("\uFEFF") ? "\uFEFF" : "";
	let content = previous.content.slice(bom.length);
	try {
		for (const edit of change.edits)
			content = applyEdits(
				content,
				modify(content, [...edit.path], "value" in edit ? edit.value : undefined, {}),
			);
	} catch {
		throw new WebUiServiceRefusal("INVALID_REQUEST");
	}
	content = bom + content;
	const next = document(content);
	const protectedAfter = publicModelDocument(next).protectedValues;
	if (
		protectedBefore.size !== protectedAfter.size ||
		[...protectedBefore].some(
			([path, value]) =>
				!protectedAfter.has(path) || JSON.stringify(protectedAfter.get(path)) !== JSON.stringify(value),
		)
	)
		throw new WebUiServiceRefusal("FORBIDDEN");
	return { content, digest: modelFileDigest(content), document: next };
}
