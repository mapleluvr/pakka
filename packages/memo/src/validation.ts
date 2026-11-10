import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MemoError, type MemoRef } from "./contracts.ts";
export function invalid(message = "Invalid Memo input"): never {
	throw new MemoError("invalid", message);
}
/** Snapshot once before validation or authority callbacks can inspect caller-owned values. */
export function data<T>(value: T): T {
	try {
		return frozen(structuredClone(value));
	} catch {
		return invalid("Memo inputs must be cloneable data");
	}
}
export function shape(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).some((k) => !keys.includes(k))
	)
		invalid();
}
export function string(value: unknown, max: number, empty = false): asserts value is string {
	if (
		typeof value !== "string" ||
		(!empty && !value.length) ||
		Buffer.byteLength(value) > max ||
		/\u0000/.test(value) ||
		/[\uD800-\uDFFF]/u.test(value)
	)
		invalid();
}
export function id(value: unknown): asserts value is string {
	string(value, 160);
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) invalid("Invalid identity");
}
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): asserts value is number {
	if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) invalid();
}
export function path(value: unknown): asserts value is string {
	string(value, 1024);
	if (
		!value.endsWith(".md") ||
		/[\\:\x00-\x1f]/.test(value) ||
		value.split("/").some((s) => !s || s === "." || s === "..")
	)
		invalid("Invalid Wiki path");
}
export function reference(value: unknown): asserts value is MemoRef {
	if (!value || typeof value !== "object") invalid();
	const r = value as Record<string, unknown>;
	id(r.libraryId);
	if (r.kind === "wiki") {
		shape(r, ["kind", "libraryId", "pageId", "revision"]);
		id(r.pageId);
		integer(r.revision, 1);
	} else if (r.kind === "source") {
		shape(r, ["kind", "libraryId", "sourceId", "version", "locator"]);
		id(r.sourceId);
		if (r.version !== null) string(r.version, 256);
		if (r.locator !== undefined) string(r.locator, 1024);
	} else invalid("Invalid content reference");
}
export function references(value: unknown): asserts value is readonly MemoRef[] {
	if (!Array.isArray(value) || value.length > 32) invalid();
	for (const r of value) reference(r);
	if (Buffer.byteLength(JSON.stringify(value)) > 48 * 1024)
		invalid("Encoded references exceed metadata budget");
}
export function frozen<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const v of Object.values(value)) frozen(v);
		Object.freeze(value);
	}
	return value;
}
function canonical(value: unknown): string {
	if (value === undefined) return "null";
	if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
	if (value && typeof value === "object")
		return (
			"{" +
			Object.keys(value)
				.sort()
				.filter((k) => (value as Record<string, unknown>)[k] !== undefined)
				.map((k) => JSON.stringify(k) + ":" + canonical((value as Record<string, unknown>)[k]))
				.join(",") +
			"}"
		);
	return JSON.stringify(value);
}
export function hash(value: unknown): string {
	return createHash("sha256").update(canonical(value)).digest("hex");
}
export function encodeCursor(secret: string, scope: unknown, data: Record<string, unknown>): string {
	const iv = randomBytes(12),
		cipher = createCipheriv("aes-256-gcm", Buffer.from(secret, "hex"), iv);
	cipher.setAAD(Buffer.from(hash(scope)));
	const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
export function decodeCursor(secret: string, scope: unknown, cursor: unknown): Record<string, unknown> {
	string(cursor, 4096);
	try {
		const bytes = Buffer.from(cursor, "base64url");
		if (bytes.length < 29 || bytes.toString("base64url") !== cursor) invalid("Invalid cursor");
		const decipher = createDecipheriv("aes-256-gcm", Buffer.from(secret, "hex"), bytes.subarray(0, 12));
		decipher.setAAD(Buffer.from(hash(scope)));
		decipher.setAuthTag(bytes.subarray(12, 28));
		const parsed: unknown = JSON.parse(
			Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"),
		);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) invalid("Invalid cursor");
		return { ...parsed };
	} catch {
		invalid("Invalid cursor");
	}
}
export function persisted<T>(json: string): T {
	try {
		return JSON.parse(json) as T;
	} catch {
		throw new MemoError("unavailable", "Invalid persisted Memo record");
	}
}
