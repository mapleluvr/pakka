import { createHash } from "node:crypto";
import {
	MemoError,
	type SourceProvider,
	type SourceCheck,
	type SourceRef,
	type Entry,
	type Page,
} from "./contracts.ts";
import { data as detached, integer } from "./validation.ts";
import { checkPublication, readPublications } from "./publication.ts";
import type { DynamiteBookPort, DynamiteBookClient, DynamiteEvidence } from "./dynamite-port.ts";
export type { DynamiteBookPort } from "./dynamite-port.ts";

export interface DynamiteSourceProvider extends SourceProvider {
	publicationCheck(result: unknown): () => void;
	search(
		input: SourceCheck & { readonly query: string; readonly limit: number; readonly cursor?: string },
	): Promise<Page<Entry>>;
	read(input: SourceCheck & { readonly offset: number; readonly limit: number }): Promise<{
		readonly ref: SourceRef;
		readonly text: string;
		readonly nextOffset: number | null;
		readonly sources: readonly SourceRef[];
	}>;
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function text(value: unknown, max = 256): asserts value is string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.length > max ||
		/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
	)
		throw new MemoError("invalid", "Invalid Book source text");
}
function object(value: unknown): asserts value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new MemoError("invalid", "Invalid Book source object");
}
function sourceFailure(error: unknown): never {
	if (error instanceof MemoError) throw error;
	if (error && typeof error === "object" && "code" in error) {
		const code = error.code;
		if (
			code === "invalid" ||
			code === "denied" ||
			code === "conflict" ||
			code === "unavailable" ||
			code === "unknown"
		)
			throw new MemoError(code, "Dynamite source request " + code);
	}
	throw new MemoError("unavailable", "Dynamite source request failed");
}

const locator = (kind: string, id: string) => kind + ":" + Buffer.from(id).toString("base64url");
function entryLocation(raw: string): string {
	if (!/^[A-Za-z0-9_-]+$/u.test(raw)) throw new MemoError("invalid", "Invalid Book entry locator");
	const id = Buffer.from(raw, "base64url").toString("utf8");
	text(id, 160);
	if (Buffer.from(id).toString("base64url") !== raw)
		throw new MemoError("invalid", "Invalid Book entry encoding");
	return id;
}
function routeNumber(raw: string, maximum = Number.MAX_SAFE_INTEGER): number {
	if (!/^[0-9a-z]{1,11}$/u.test(raw)) throw new MemoError("invalid", "Invalid source route number");
	const value = Number.parseInt(raw, 36);
	integer(value);
	if (value > maximum || value.toString(36) !== raw)
		throw new MemoError("invalid", "Invalid source route number");
	return value;
}
function sourceWindow(raw: string): {
	offset: number;
	limit: number;
	index: number;
} {
	const parts = raw.split(".");
	if (parts.length !== 3) throw new MemoError("invalid", "Invalid source route window");
	const offset = routeNumber(parts[0]),
		limit = routeNumber(parts[1], 16384),
		index = routeNumber(parts[2], 64);
	if (!limit) throw new MemoError("invalid", "Empty source route window");
	return { offset, limit, index };
}
const windowKey = (offset: number, limit: number, index: number) =>
	[offset, limit, index].map((value) => value.toString(36)).join(".");
function documentRange(document: unknown, offset: number, limit: number) {
	const points = Array.from(JSON.stringify(document));
	if (offset > points.length) throw new MemoError("invalid", "Source offset beyond fixed content");
	return {
		text: points.slice(offset, offset + limit).join(""),
		nextOffset: offset + limit < points.length ? offset + limit : null,
	};
}
interface SourceRoute {
	readonly id: string;
	readonly encodedId: string;
	readonly path: string;
	readonly steps: readonly string[];
	readonly navigation: boolean;
	readonly expectedProof: string | undefined;
	readonly expectedChildren: string | undefined;
	readonly window: { offset: number; limit: number; index: number } | undefined;
}
function sourceRoute(location: string): SourceRoute {
	const parts = location.split(":"),
		navigation = parts[0] === "source-refs",
		root = parts[0] === "artifact";
	if (parts.length !== (root ? 3 : navigation ? 6 : 4))
		throw new MemoError("invalid", "Invalid original source route");
	const steps = parts[2].split("~");
	if (steps.length > 33 || (root && steps.length !== 1))
		throw new MemoError("invalid", "Source traversal exceeds depth budget");
	return {
		id: entryLocation(parts[1]),
		encodedId: parts[1],
		path: parts[2],
		steps,
		navigation,
		expectedProof: parts[3],
		expectedChildren: parts[5],
		window: navigation ? sourceWindow(parts[4]) : undefined,
	};
}
async function resolveSourceRoute(
	client: DynamiteBookClient,
	input: SourceCheck,
	route: SourceRoute,
	readSet: DynamiteEvidence[],
) {
	const entry = await client.read({
		revision: Number(input.ref.version),
		id: route.id,
	});
	let evidence: DynamiteEvidence | undefined = entry.sources[routeNumber(route.steps[0], 63)];
	if (!evidence) throw new MemoError("unavailable", "Original Book source reference unavailable");
	readSet.push(evidence);
	client.checkEvidence(readSet);
	let proof = digest([input.address, input.ref.version, route.id, route.steps[0], evidence]);
	for (const step of route.steps.slice(1)) {
		client.checkEvidence(readSet);
		const window = sourceWindow(step),
			page = await client.source({
				ref: evidence,
				offset: window.offset,
				limit: window.limit,
			});
		client.checkEvidence(readSet);
		evidence = page.sources?.[window.index];
		if (!evidence) throw new MemoError("unavailable", "Original child source reference unavailable");
		readSet.push(evidence);
		proof = digest([proof, step, evidence]);
	}
	if (route.expectedProof !== undefined && route.expectedProof !== proof)
		throw new MemoError("unavailable", "Original source route identity changed");
	return { evidence, proof };
}
/** Short navigation carries an entry-rooted route, never arbitrary embedded source metadata. */
async function sourceRange(
	client: DynamiteBookClient,
	input: SourceCheck & {
		readonly offset: number;
		readonly limit: number;
	},
	location: string,
	readSet: DynamiteEvidence[],
) {
	const route = sourceRoute(location),
		{ evidence, proof } = await resolveSourceRoute(client, input, route, readSet);
	client.checkEvidence(readSet);
	const window = route.window ?? {
			offset: input.offset,
			limit: input.limit,
			index: 0,
		},
		page = await client.source({
			ref: evidence,
			offset: window.offset,
			limit: window.limit,
		}),
		children = page.sources ?? [];
	client.checkEvidence(readSet);
	if (route.expectedChildren !== undefined && route.expectedChildren !== digest(children))
		throw new MemoError("unavailable", "Original source window references changed");
	if (window.index > children.length) throw new MemoError("invalid", "Source reference page beyond history");
	if (children.length && route.steps.length === 33)
		throw new MemoError("unavailable", "Source traversal exceeds depth budget");
	const sources: SourceRef[] = children.slice(window.index, window.index + 24).map((ref, index) => {
		const step = windowKey(window.offset, window.limit, window.index + index);
		return {
			...input.ref,
			locator: "source:" + route.encodedId + ":" + route.path + "~" + step + ":" + digest([proof, step, ref]),
		};
	});
	if (window.index + 24 < children.length)
		sources.push({
			...input.ref,
			locator:
				"source-refs:" +
				route.encodedId +
				":" +
				route.path +
				":" +
				proof +
				":" +
				windowKey(window.offset, window.limit, window.index + 24) +
				":" +
				digest(children),
		});
	return {
		...(route.navigation
			? documentRange({ references: sources }, input.offset, input.limit)
			: { text: page.text, nextOffset: page.nextOffset }),
		sources,
	};
}
/** One trusted registration address is one Book, with a separately approved library sharing policy. */
export function createDynamiteSourceProvider(options: {
	readonly book: DynamiteBookPort;
	readonly check: (input: SourceCheck) => void;
}): DynamiteSourceProvider {
	const book = options.book,
		authorize = options.check,
		publications = readPublications();
	if (typeof authorize !== "function") throw new MemoError("invalid", "Source sharing authority required");
	const inputCheck = (raw: SourceCheck): SourceCheck => {
		const input = detached(raw);
		object(input);
		object(input.ref);
		text(input.actorId);
		text(input.libraryId);
		text(input.ref.sourceId);
		if (
			input.address !== book.bookId ||
			input.ref.kind !== "source" ||
			input.ref.libraryId !== input.libraryId ||
			(input.action !== "read" && input.action !== "share")
		)
			throw new MemoError("denied", "History source address or identity mismatch");
		if (typeof input.ref.version !== "string" || !/^[1-9][0-9]{0,14}$/u.test(input.ref.version))
			throw new MemoError("invalid", "A fixed Book version is required");
		if (input.ref.locator !== undefined) text(input.ref.locator, 1024);
		checkPublication(() => authorize(input));
		return input;
	};
	const connect = (input: SourceCheck): DynamiteBookClient =>
		book.connect({
			id: input.actorId,
			check: () => {
				inputCheck(input);
			},
		});
	const publication = (client: DynamiteBookClient, input: SourceCheck, refs: readonly DynamiteEvidence[]) => {
		const fixed = detached(refs);
		return () => {
			inputCheck(input);
			checkPublication(() => client.checkEvidence(fixed));
		};
	};
	return Object.freeze<DynamiteSourceProvider>({
		publicationCheck: publications.capture,
		check: (raw) => {
			const input = inputCheck(raw);
			publication(connect(input), input, [])();
		},
		search: async (raw) => {
			try {
				const input = detached(raw);
				inputCheck(input);
				text(input.query, 256);
				integer(input.limit, 1);
				if (input.limit > 64) throw new MemoError("invalid", "Invalid Book source search limit");
				const client = connect(input),
					revision = Number(input.ref.version);
				const page = await client.search({
					revision,
					query: input.query,
					limit: input.limit,
					...(input.cursor === undefined ? {} : { cursor: input.cursor }),
				});
				return publications.bind(
					detached({
						items: page.items.map((item) => ({
							ref: { ...input.ref, locator: locator("entry", item.id) },
							title: item.title,
							path: "history/" + book.bookId + "/" + item.id,
							excerpt: item.excerpt,
						})),
						cursor: page.cursor,
					}),
					publication(client, input, []),
				);
			} catch (error) {
				return sourceFailure(error);
			}
		},
		read: async (raw) => {
			try {
				const input = detached(raw);
				inputCheck(input);
				integer(input.offset);
				integer(input.limit, 1);
				if (input.limit > 16384) throw new MemoError("invalid", "Invalid Book source read budget");
				const client = connect(input),
					revision = Number(input.ref.version),
					location = input.ref.locator,
					readSet: DynamiteEvidence[] = [];
				let document: unknown,
					content: { text: string; nextOffset: number | null } | undefined,
					sources: SourceRef[] = [];
				if (!location || location.startsWith("directory:")) {
					const cursor = location?.slice("directory:".length),
						head = await client.open(revision),
						page = await client.list({
							revision,
							limit: 8,
							...(cursor ? { cursor } : {}),
							maxBytes: 32 * 1024,
						});
					document = { book: head, entries: page.items };
					sources = page.items.map((item) => ({
						...input.ref,
						locator: locator("entry", item.id),
					}));
					if (page.cursor) sources.push({ ...input.ref, locator: "directory:" + page.cursor });
				} else if (location.startsWith("entry:") || location.startsWith("references:")) {
					const isReferences = location.startsWith("references:"),
						parts = location.split(":"),
						id = entryLocation(parts[1]);
					if (parts.length !== (isReferences ? 3 : 2) || (isReferences && !/^\d{1,3}$/u.test(parts[2])))
						throw new MemoError("invalid", "Invalid source reference page");
					const start = isReferences ? Number(parts[2]) : 0,
						entry = await client.read({ revision, id });
					const all = [
						...entry.links.map((id) => ({
							...input.ref,
							locator: locator("entry", id),
						})),
						...entry.sources.map((_ref, index) => ({
							...input.ref,
							locator: locator("artifact", id) + ":" + index.toString(36),
						})),
					];
					if (start > all.length) throw new MemoError("invalid", "Reference page beyond history");
					sources = all.slice(start, start + 24);
					if (start + 24 < all.length)
						sources.push({
							...input.ref,
							locator: locator("references", id) + ":" + (start + 24),
						});
					document = isReferences ? { references: sources } : entry;
				} else if (
					location.startsWith("artifact:") ||
					location.startsWith("source:") ||
					location.startsWith("source-refs:")
				) {
					const result = await sourceRange(client, input, location, readSet);
					content = result;
					sources = result.sources;
				} else throw new MemoError("invalid", "Unknown History source locator");
				// Keep returned refs bounded and exact; fail instead of silently dropping provenance.
				if (sources.length > 32 || sources.some((ref) => ref.locator!.length > 1024))
					throw new MemoError("unavailable", "Source reference page exceeds budget");
				const range = content ?? documentRange(document, input.offset, input.limit);
				return publications.bind(
					detached({ ref: input.ref, ...range, sources }),
					publication(client, input, readSet),
				);
			} catch (error) {
				return sourceFailure(error);
			}
		},
	});
}
