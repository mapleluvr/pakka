import { createHash } from "node:crypto";
import {
	RecordsRequestRefusedError,
	type ConversationRef,
	type JsonObject,
	type RuntimeRecords,
} from "@pakka/agent";
import { MasRequestDenied } from "./errors.ts";
import type { SendSpec } from "./types.ts";

const MAX_RESPONSES = 256;
const identity = (value: unknown): value is string =>
	typeof value === "string" &&
	!["constructor", "prototype", "__proto__"].includes(value) &&
	/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sameRef = (a: ConversationRef, b: ConversationRef) =>
	a.key === b.key &&
	a.sessionId === b.sessionId &&
	a.conversationId === b.conversationId &&
	a.incarnation === b.incarnation &&
	a.profile === b.profile;
const validRef = (value: unknown): value is ConversationRef => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	// SAFETY: ConversationRef fields are accessed only after confirming every identity string.
	const ref = value as ConversationRef;
	return [ref.key, ref.sessionId, ref.conversationId, ref.incarnation, ref.profile].every(identity);
};
const canonicalRef = (ref: ConversationRef): ConversationRef => ({
	key: ref.key,
	sessionId: ref.sessionId,
	conversationId: ref.conversationId,
	incarnation: ref.incarnation,
	profile: ref.profile,
});

interface ResponseRow {
	readonly kind: "mas-a2a-response";
	readonly version: 1 | 2;
	readonly rootReceiptId: string;
	readonly principal: string;
	readonly source: ConversationRef;
	readonly target: ConversationRef;
	readonly input: Required<SendSpec>;
	readonly fingerprint: string;
	readonly status: "admitting" | "ready" | "retryable";
}
interface CapacityRow {
	readonly kind: "mas-a2a-response-capacity";
	readonly version: 1 | 2;
	readonly count: number;
	readonly roots: number;
}

function responseFingerprint(row: Omit<ResponseRow, "fingerprint" | "status">) {
	return hash({
		kind: row.kind,
		version: row.version,
		rootReceiptId: row.rootReceiptId,
		principal: row.principal,
		source: row.source,
		target: row.target,
		input: row.input,
	});
}

function decodeResponse(value: unknown, rootReceiptId: string): ResponseRow {
	if (
		!value ||
		typeof value !== "object" ||
		(value as ResponseRow).kind !== "mas-a2a-response" ||
		!([1, 2] as unknown[]).includes((value as ResponseRow).version) ||
		(value as ResponseRow).rootReceiptId !== rootReceiptId ||
		!identity((value as ResponseRow).principal) ||
		!validRef((value as ResponseRow).source) ||
		!validRef((value as ResponseRow).target) ||
		!identity((value as ResponseRow).input?.requestId) ||
		typeof (value as ResponseRow).input?.text !== "string" ||
		!((value as ResponseRow).input?.text ?? "").trim() ||
		!((value as ResponseRow).input?.text.length <= 65536) ||
		!["prompt", "steer", "followUp"].includes((value as ResponseRow).input?.mode)
	)
		throw new Error("MAS response reservation is invalid");
	const row = value as ResponseRow,
		status = row.version === 1 ? "admitting" : row.status;
	if (row.version === 2 && !["admitting", "ready", "retryable"].includes(status))
		throw new Error("MAS response reservation state is invalid");
	const decoded = { ...row, status },
		fingerprint = responseFingerprint(decoded);
	if (fingerprint !== row.fingerprint) throw new Error("MAS response reservation fingerprint is invalid");
	return decoded;
}

function decodeCapacity(value: JsonObject, revision: number): CapacityRow {
	if (
		value.kind !== "mas-a2a-response-capacity" ||
		![1, 2].includes(value.version as number) ||
		typeof value.count !== "number" ||
		!Number.isSafeInteger(value.count) ||
		value.count < 0 ||
		value.count > MAX_RESPONSES ||
		(value.version === 2 &&
			(typeof value.roots !== "number" ||
				!Number.isSafeInteger(value.roots) ||
				value.roots < value.count ||
				value.roots > Number.MAX_SAFE_INTEGER))
	)
		throw new Error("MAS response capacity record is invalid");
	const roots = value.version === 1 ? value.count : (value.roots as number);
	if (revision !== roots) throw new Error("MAS response capacity record or append-only index is invalid");
	return { kind: "mas-a2a-response-capacity", version: value.version as 1 | 2, count: value.count, roots };
}

async function readCapacity(records: RuntimeRecords, check: () => void) {
	const record = await records.get("response.capacity", check),
		revision = await records.revision("responses", check),
		capacity = record.data
			? decodeCapacity(record.data, revision)
			: { kind: "mas-a2a-response-capacity" as const, version: 2 as const, count: 0, roots: 0 };
	if (capacity.count > MAX_RESPONSES || capacity.roots !== revision)
		throw new Error("MAS response capacity record or append-only index is invalid");
	check();
	return { record, capacity };
}

function responseData(row: ResponseRow): JsonObject {
	return {
		kind: row.kind,
		version: row.version,
		rootReceiptId: row.rootReceiptId,
		principal: row.principal,
		source: {
			key: row.source.key,
			sessionId: row.source.sessionId,
			conversationId: row.source.conversationId,
			incarnation: row.source.incarnation,
			profile: row.source.profile,
		},
		target: {
			key: row.target.key,
			sessionId: row.target.sessionId,
			conversationId: row.target.conversationId,
			incarnation: row.target.incarnation,
			profile: row.target.profile,
		},
		input: { ...row.input },
		fingerprint: row.fingerprint,
		...(row.version === 2 ? { status: row.status } : {}),
	};
}

function capacityData(count: number, roots: number): JsonObject {
	return { kind: "mas-a2a-response-capacity", version: 2, count, roots };
}

function responseKey(rootReceiptId: string) {
	return "response." + hash(rootReceiptId);
}

export async function reserveMasResponse(
	input: {
		readonly rootReceiptId: string;
		readonly principal: string;
		readonly source: ConversationRef;
		readonly target: ConversationRef;
		readonly message: SendSpec;
	},
	records: RuntimeRecords,
	check: () => void,
): Promise<{ readonly status: "claimed" | "ready"; readonly fingerprint: string }> {
	if (
		!identity(input.rootReceiptId) ||
		!identity(input.principal) ||
		!identity(input.message.requestId) ||
		typeof input.message.text !== "string" ||
		!input.message.text.trim() ||
		input.message.text.length > 65536 ||
		input.message.text.startsWith("/") ||
		!["prompt", "steer", "followUp"].includes(input.message.mode ?? "prompt")
	)
		throw new MasRequestDenied("Invalid MAS response payload");
	const message = Object.freeze({
			requestId: input.message.requestId,
			text: input.message.text,
			mode: input.message.mode ?? "prompt",
		}),
		key = responseKey(input.rootReceiptId),
		base = {
			kind: "mas-a2a-response" as const,
			version: 2 as const,
			rootReceiptId: input.rootReceiptId,
			principal: input.principal,
			source: canonicalRef(input.source),
			target: canonicalRef(input.target),
			input: message,
		},
		fingerprint = responseFingerprint(base);
	for (let attempt = 0; attempt < 12; attempt++) {
		check();
		const saved = await records.get(key, check),
			index = await readCapacity(records, check),
			capacity = index.capacity;
		if (saved.data) {
			if (capacity.roots === 0) throw new Error("MAS response record exists without its capacity index");
			const old = decodeResponse(saved.data, input.rootReceiptId);
			if (
				old.principal !== input.principal ||
				!sameRef(old.source, input.source) ||
				!sameRef(old.target, input.target)
			)
				throw new MasRequestDenied("A response is already bound to another responder");
			if (old.status === "ready") {
				if (old.fingerprint !== fingerprint)
					throw new MasRequestDenied(
						"A response is already reserved for this request; reuse its identity and payload",
					);
				return { status: "ready", fingerprint };
			}
			if (old.status === "admitting") {
				if (old.fingerprint !== fingerprint)
					throw new MasRequestDenied(
						"A response outcome is unconfirmed; its identity and payload remain bound",
					);
				throw new Error("Response admission is already in progress or unconfirmed");
			}
			if (capacity.count >= MAX_RESPONSES) throw new MasRequestDenied("MAS response capacity exhausted");
			const row: ResponseRow = { ...base, fingerprint, status: "admitting" };
			try {
				await records.commit(
					{
						requestId: "response-retry." + hash([input.rootReceiptId, saved.version, fingerprint]),
						reads: [
							{ key, version: saved.version },
							{ key: "response.capacity", version: index.record.version },
						],
						writes: [
							{ key, data: responseData(row) },
							{ key: "response.capacity", data: capacityData(capacity.count + 1, capacity.roots) },
						],
						append: [],
					},
					check,
				);
				return { status: "claimed", fingerprint };
			} catch (error) {
				if (error instanceof RecordsRequestRefusedError && error.code === "conflict") continue;
				if (error instanceof RecordsRequestRefusedError && error.code === "capacity")
					throw new MasRequestDenied("MAS response capacity exhausted");
				throw error;
			}
		}
		if (capacity.count >= MAX_RESPONSES || capacity.roots >= Number.MAX_SAFE_INTEGER)
			throw new MasRequestDenied("MAS response capacity exhausted");
		const row: ResponseRow = { ...base, fingerprint, status: "admitting" };
		try {
			await records.commit(
				{
					requestId: "response-save." + hash([input.rootReceiptId, fingerprint]),
					reads: [
						{ key, version: saved.version },
						{ key: "response.capacity", version: index.record.version },
					],
					writes: [
						{ key, data: responseData(row) },
						{ key: "response.capacity", data: capacityData(capacity.count + 1, capacity.roots + 1) },
					],
					append: [{ stream: "responses", data: responseData(row) }],
				},
				check,
			);
			return { status: "claimed", fingerprint };
		} catch (error) {
			if (error instanceof RecordsRequestRefusedError && error.code === "conflict") continue;
			if (error instanceof RecordsRequestRefusedError && error.code === "capacity")
				throw new MasRequestDenied("MAS response capacity exhausted");
			throw error;
		}
	}
	throw new Error("MAS response reservation remained conflicted");
}

async function transitionResponse(
	rootReceiptId: string,
	fingerprint: string,
	next: "ready" | "retryable",
	records: RuntimeRecords,
	check: () => void,
): Promise<void> {
	const key = responseKey(rootReceiptId);
	for (let attempt = 0; attempt < 12; attempt++) {
		check();
		const saved = await records.get(key, check),
			index = await readCapacity(records, check);
		if (!saved.data) throw new Error("MAS response reservation disappeared");
		const old = decodeResponse(saved.data, rootReceiptId);
		if (old.fingerprint !== fingerprint) throw new Error("MAS response identity changed during admission");
		if (old.status === next) return;
		if (old.status !== "admitting")
			throw new Error("MAS response reservation is not in a transitionable state");
		if (next === "retryable" && index.capacity.count < 1) throw new Error("MAS response capacity underflow");
		const count = index.capacity.count + (next === "ready" ? 0 : -1),
			row: ResponseRow = { ...old, version: 2, status: next };
		try {
			await records.commit(
				{
					requestId: `response-${next}.${hash([rootReceiptId, saved.version, fingerprint])}`,
					reads: [
						{ key, version: saved.version },
						{ key: "response.capacity", version: index.record.version },
					],
					writes: [
						{ key, data: responseData(row) },
						{ key: "response.capacity", data: capacityData(count, index.capacity.roots) },
					],
					append: [],
				},
				check,
			);
			return;
		} catch (error) {
			if (error instanceof RecordsRequestRefusedError && error.code === "conflict") continue;
			throw error;
		}
	}
	throw new Error("MAS response state transition remained conflicted");
}

export async function approveMasResponse(
	rootReceiptId: string,
	fingerprint: string,
	records: RuntimeRecords,
	check: () => void,
): Promise<void> {
	return transitionResponse(rootReceiptId, fingerprint, "ready", records, check);
}

export async function releaseMasResponseAfterRefusal(
	rootReceiptId: string,
	fingerprint: string,
	records: RuntimeRecords,
	check: () => void,
): Promise<void> {
	return transitionResponse(rootReceiptId, fingerprint, "retryable", records, check);
}
