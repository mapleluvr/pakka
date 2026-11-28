import type { JsonObject } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";

/** Byte coordinates in the original immutable entry JSON, not a copy of its body. */
export type EntryContentSpan = {
	readonly path: string;
	readonly offset: number;
	readonly byteLength: number;
	readonly encoding: "json-string" | "json";
};
export type EntryJsonIndex = {
	readonly value: JsonValue;
	readonly spans: readonly EntryContentSpan[];
	readonly truncated: readonly string[];
};
export type EntryBytes = (offset: number, length: number) => Promise<Uint8Array>;

const STRING_LIMIT = 4096;
const PREVIEW_EDGE = 1024;
const MAX_NODES = 16384;
const MAX_DEPTH = 256;
const pointer = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1");
const whitespace = (byte: number) => byte === 32 || byte === 9 || byte === 10 || byte === 13;
const hex = (byte: number) =>
	(byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 70) || (byte >= 97 && byte <= 102);
const decode = (bytes: Uint8Array): string => {
	try {
		return JSON.parse('"' + Buffer.from(bytes).toString("utf8") + '"') as string;
	} catch (cause) {
		throw new Error("Invalid encoded entry string", { cause });
	}
};

/** Last complete JSON-string unit; a unit is one escape or one UTF-8 code point. */
function completeStringBytes(bytes: Uint8Array): number {
	let offset = 0;
	for (; offset < bytes.length; ) {
		const byte = bytes[offset];
		if (byte === undefined) throw new Error("Missing entry string byte");
		let width: number;
		if (byte === 92) {
			if (offset + 1 >= bytes.length) break;
			width = bytes[offset + 1] === 117 ? 6 : 2;
		} else if (byte < 128) width = 1;
		else if (byte >= 194 && byte <= 223) width = 2;
		else if (byte >= 224 && byte <= 239) width = 3;
		else if (byte >= 240 && byte <= 244) width = 4;
		else throw new Error("Invalid UTF-8 string boundary");
		if (offset + width > bytes.length) break;
		offset += width;
	}
	return offset;
}

class StringBuffer {
	readonly prefix = new Uint8Array(STRING_LIMIT);
	readonly tail = new Uint8Array(PREVIEW_EDGE + 16);
	readonly boundaries = new Uint8Array(PREVIEW_EDGE + 16);
	length = 0;
	append(byte: number, boundary: boolean): void {
		if (this.length < this.prefix.length) this.prefix[this.length] = byte;
		const at = this.length % this.tail.length;
		this.tail[at] = byte;
		this.boundaries[at] = boundary ? 1 : 0;
		this.length++;
	}
	value(): string {
		if (this.length <= STRING_LIMIT) return decode(this.prefix.subarray(0, this.length));
		const prefix = this.prefix.subarray(0, PREVIEW_EDGE);
		const head = decode(prefix.subarray(0, completeStringBytes(prefix)));
		let start = this.length - Math.min(PREVIEW_EDGE, this.length);
		while (start < this.length && this.boundaries[start % this.tail.length] !== 1) start++;
		const tail = new Uint8Array(this.length - start);
		for (let i = 0; i < tail.length; i++) {
			const byte = this.tail[(start + i) % this.tail.length];
			if (byte === undefined) throw new Error("Missing entry preview byte");
			tail[i] = byte;
		}
		return head + "\n… [preview; full content available] …\n" + decode(tail);
	}
}

type ObjectFrame = {
	kind: "object";
	state: "keyOrEnd" | "key" | "colon" | "value" | "commaOrEnd";
	value: JsonObject;
	key: string;
	keys: Set<string>;
	start: number;
	path: string;
};
type ArrayFrame = {
	kind: "array";
	state: "valueOrEnd" | "value" | "commaOrEnd";
	value: JsonValue[];
	start: number;
	path: string;
};
type Frame = ObjectFrame | ArrayFrame;
type StringToken = {
	kind: "string";
	key: boolean;
	start: number;
	path: string;
	buffer: StringBuffer;
	escape: boolean;
	hexLeft: number;
	utf8Left: number;
	utf8Min: number;
	utf8Max: number;
};
type ScalarToken = { kind: "scalar"; bytes: number[]; start: number; path: string };

/**
 * Incremental JSON projection. Every source request is at most 64 KiB. Long strings retain only
 * bounded head/tail buffers; container/node limits prevent a tiny-body, huge-node-count projection.
 * Nothing is published before complete syntax and EOF validation. Original bytes remain authoritative.
 */
export async function indexEntryJson(read: EntryBytes, byteLength: number): Promise<EntryJsonIndex> {
	if (!Number.isSafeInteger(byteLength) || byteLength < 1) throw new Error("Invalid entry JSON size");
	const stack: Frame[] = [];
	const spans: EntryContentSpan[] = [];
	const truncated: string[] = [];
	let token: StringToken | ScalarToken | undefined;
	let root: JsonValue | undefined;
	let done = false,
		nodes = 0,
		position = 0;
	const path = (): string => {
		const frame = stack.at(-1);
		if (!frame) return "";
		const component = frame.kind === "object" ? pointer(frame.key) : frame.value.length;
		return frame.path + "/" + component;
	};
	const put = (value: JsonValue, span: EntryContentSpan): void => {
		if (++nodes > MAX_NODES) throw new Error("Entry preview node budget exceeded");
		spans.push(span);
		const frame = stack.at(-1);
		if (!frame) {
			root = value;
			done = true;
			return;
		}
		if (frame.kind === "object") {
			if (frame.state !== "value") throw new Error("Invalid object value placement");
			Object.defineProperty(frame.value, frame.key, {
				value,
				enumerable: true,
				configurable: true,
				writable: true,
			});
			frame.state = "commaOrEnd";
		} else {
			if (frame.state !== "value" && frame.state !== "valueOrEnd")
				throw new Error("Invalid array value placement");
			frame.value.push(value);
			frame.state = "commaOrEnd";
		}
	};
	const finishScalar = (): void => {
		if (!token || token.kind !== "scalar") throw new Error("Missing entry scalar");
		const raw = Buffer.from(token.bytes).toString("utf8");
		if (!/^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/.test(raw))
			throw new Error("Invalid entry JSON scalar");
		let value: JsonValue;
		if (raw === "null") value = null;
		else if (raw === "true") value = true;
		else if (raw === "false") value = false;
		else value = Number(raw);
		if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Nonfinite entry JSON scalar");
		put(value, { path: token.path, offset: token.start, byteLength: token.bytes.length, encoding: "json" });
		token = undefined;
	};
	while (position < byteLength) {
		const bytes = await read(position, Math.min(65536, byteLength - position));
		if (bytes.length < 1 || bytes.length > Math.min(65536, byteLength - position))
			throw new Error("Entry JSON source ended early or exceeded its range");
		for (let i = 0; i < bytes.length; i++) {
			const byte = bytes[i];
			if (byte === undefined) throw new Error("Missing entry JSON byte");
			const at = position + i;
			if (token?.kind === "scalar") {
				if (whitespace(byte) || byte === 44 || byte === 93 || byte === 125) finishScalar();
				else {
					if (token.bytes.length >= 128) throw new Error("Entry scalar budget exceeded");
					token.bytes.push(byte);
					continue;
				}
			}
			if (token?.kind === "string") {
				const boundary = !token.escape && token.hexLeft === 0 && token.utf8Left === 0;
				if (byte === 34 && boundary) {
					const value = token.buffer.value();
					if (token.key) {
						const frame = stack.at(-1);
						if (!frame || frame.kind !== "object" || token.buffer.length > STRING_LIMIT)
							throw new Error("Entry key budget exceeded");
						if (frame.keys.has(value)) throw new Error("Duplicate entry JSON key");
						frame.keys.add(value);
						frame.key = value;
						frame.state = "colon";
					} else {
						if (token.buffer.length > STRING_LIMIT) truncated.push(token.path);
						put(value, {
							path: token.path,
							offset: token.start + 1,
							byteLength: at - token.start - 1,
							encoding: "json-string",
						});
					}
					token = undefined;
					continue;
				}
				if (token.hexLeft > 0) {
					if (!hex(byte)) throw new Error("Invalid entry Unicode escape");
					token.hexLeft--;
				} else if (token.escape) {
					if (byte === 117) token.hexLeft = 4;
					else if (![34, 92, 47, 98, 102, 110, 114, 116].includes(byte))
						throw new Error("Invalid entry string escape");
					token.escape = false;
				} else if (token.utf8Left > 0) {
					if (byte < token.utf8Min || byte > token.utf8Max)
						throw new Error("Invalid entry UTF-8 continuation");
					token.utf8Left--;
					token.utf8Min = 128;
					token.utf8Max = 191;
				} else if (byte === 92) token.escape = true;
				else if (byte < 32) throw new Error("Unescaped entry control character");
				else if (byte >= 128) {
					if (byte >= 194 && byte <= 223) token.utf8Left = 1;
					else if (byte >= 224 && byte <= 239) token.utf8Left = 2;
					else if (byte >= 240 && byte <= 244) token.utf8Left = 3;
					else throw new Error("Invalid entry UTF-8 leading byte");
					token.utf8Min = 128;
					token.utf8Max = 191;
					if (byte === 224) token.utf8Min = 160;
					if (byte === 240) token.utf8Min = 144;
					if (byte === 237) token.utf8Max = 159;
					if (byte === 244) token.utf8Max = 143;
				}
				token.buffer.append(byte, boundary);
				continue;
			}
			if (whitespace(byte)) continue;
			if (done) throw new Error("Trailing entry JSON data");
			const frame = stack.at(-1);
			if (frame?.kind === "object" && (frame.state === "keyOrEnd" || frame.state === "key")) {
				if (byte === 125 && frame.state === "keyOrEnd") {
					stack.pop();
					put(frame.value, {
						path: frame.path,
						offset: frame.start,
						byteLength: at - frame.start + 1,
						encoding: "json",
					});
					continue;
				}
				if (byte !== 34) throw new Error("Expected entry object key");
				token = {
					kind: "string",
					key: true,
					start: at,
					path: "",
					buffer: new StringBuffer(),
					escape: false,
					hexLeft: 0,
					utf8Left: 0,
					utf8Min: 128,
					utf8Max: 191,
				};
				continue;
			}
			if (frame?.kind === "object" && frame.state === "colon") {
				if (byte !== 58) throw new Error("Expected entry object colon");
				frame.state = "value";
				continue;
			}
			if (frame?.state === "commaOrEnd") {
				if (byte === 44) {
					frame.state = frame.kind === "object" ? "key" : "value";
					continue;
				}
				if ((frame.kind === "object" && byte === 125) || (frame.kind === "array" && byte === 93)) {
					stack.pop();
					put(frame.value, {
						path: frame.path,
						offset: frame.start,
						byteLength: at - frame.start + 1,
						encoding: "json",
					});
					continue;
				}
				throw new Error("Expected entry comma or closing container");
			}
			if (frame?.kind === "array" && frame.state === "valueOrEnd" && byte === 93) {
				stack.pop();
				put(frame.value, {
					path: frame.path,
					offset: frame.start,
					byteLength: at - frame.start + 1,
					encoding: "json",
				});
				continue;
			}
			const location = path();
			if (byte === 123 || byte === 91) {
				if (stack.length >= MAX_DEPTH) throw new Error("Entry preview depth budget exceeded");
				stack.push(
					byte === 123
						? {
								kind: "object",
								state: "keyOrEnd",
								value: {},
								key: "",
								keys: new Set(),
								start: at,
								path: location,
							}
						: { kind: "array", state: "valueOrEnd", value: [], start: at, path: location },
				);
			} else if (byte === 34)
				token = {
					kind: "string",
					key: false,
					start: at,
					path: location,
					buffer: new StringBuffer(),
					escape: false,
					hexLeft: 0,
					utf8Left: 0,
					utf8Min: 128,
					utf8Max: 191,
				};
			else if (byte === 45 || (byte >= 48 && byte <= 57) || byte === 116 || byte === 102 || byte === 110)
				token = { kind: "scalar", bytes: [byte], start: at, path: location };
			else throw new Error("Expected entry JSON value");
		}
		position += bytes.length;
	}
	if (token?.kind === "scalar") finishScalar();
	if (token || stack.length || !done || root === undefined) throw new Error("Incomplete entry JSON");
	return { value: root, spans, truncated };
}

/** Decode an independently transportable fragment, ending only at a complete JSON/UTF-8 unit. */
export async function decodeEntryStringRange(
	read: EntryBytes,
	span: EntryContentSpan,
	offset: number,
	length: number,
): Promise<{
	readonly text: string;
	readonly offset: number;
	readonly nextOffset: number;
	readonly byteLength: number;
	readonly complete: boolean;
}> {
	if (
		span.encoding !== "json-string" ||
		!Number.isSafeInteger(offset) ||
		offset < 0 ||
		offset > span.byteLength ||
		!Number.isSafeInteger(length) ||
		length < 8 ||
		length > 65536
	)
		throw new Error("Invalid entry string range");
	const size = Math.min(length, span.byteLength - offset);
	const buffer = new Uint8Array(size);
	let filled = 0;
	while (filled < size) {
		const bytes = await read(span.offset + offset + filled, size - filled);
		if (bytes.length < 1 || bytes.length > size - filled) throw new Error("Entry string range ended early");
		buffer.set(bytes, filled);
		filled += bytes.length;
	}
	const end = completeStringBytes(buffer);
	if (size > 0 && end === 0) throw new Error("Entry range cannot make progress");
	const text = decode(buffer.subarray(0, end));
	return {
		text,
		offset,
		nextOffset: offset + end,
		byteLength: span.byteLength,
		complete: offset + end === span.byteLength,
	};
}
