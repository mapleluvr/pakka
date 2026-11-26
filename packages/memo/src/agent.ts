import type { HostOptions, Runtime, ConversationRef, ToolInvocationScope } from "@pakka/agent";
import { MemoError, type MemoActor, type MemoService, type MemoClient } from "./contracts.ts";
import { shape, string, id, integer, references, reference, frozen, invalid } from "./validation.ts";
type Tool = NonNullable<HostOptions["tools"]>[number];
export interface MemoInvocationBinding {
	readonly runtime: Runtime;
	readonly source: ConversationRef;
	readonly service: MemoService;
	readonly actor: MemoActor;
}
export function bindMemoInvocation(binding: MemoInvocationBinding, scope: ToolInvocationScope): MemoClient {
	const source = structuredClone(binding.source),
		catalog = binding.runtime.catalog({ namespace: "memo.invocations", maxDeliveries: 1, maxPending: 1 });
	return binding.service.connect(binding.actor).withAuthority(() => catalog.checkInvocation(source, scope));
}
const identity = { type: "string", minLength: 1, maxLength: 160 };
const text = { type: "string" };
const positive = { type: "integer", minimum: 1 };
const refs = { type: "array", maxItems: 32, items: { type: "object" } };
const page = {
	cursor: { type: "string", maxLength: 4096 },
	limit: { type: "integer", minimum: 1, maximum: 50 },
};
const definitions: readonly [string, string, Record<string, object>, readonly string[]][] = [
	["memo_libraries", "Browse authorized libraries.", page, []],
	[
		"memo_list",
		"Browse Wiki and authorized source directory. Follow cursor, including empty pages.",
		{ libraryId: identity, prefix: text, ...page },
		["libraryId"],
	],
	[
		"memo_search",
		"Search Wiki and authorized sources through one cursor. Continue empty pages while cursor is present.",
		{ query: text, libraryId: identity, ...page },
		["query"],
	],
	[
		"memo_read",
		"Read a fixed reference in bounded Unicode code-point ranges; continue via nextOffset or returned source refs.",
		{
			ref: { type: "object" },
			offset: { type: "integer", minimum: 0 },
			limit: { type: "integer", minimum: 1, maximum: 16384 },
		},
		["ref"],
	],
	[
		"wiki_write",
		"Save a Wiki page at its base revision. For a new page omit pageId and set baseRevision=0. Preserve requestId for reconciliation.",
		{
			libraryId: identity,
			requestId: identity,
			pageId: identity,
			baseRevision: { type: "integer", minimum: 0 },
			path: text,
			title: text,
			markdown: text,
			summary: text,
			sources: refs,
		},
		["libraryId", "requestId", "baseRevision", "path", "title", "markdown", "summary", "sources"],
	],
	[
		"wiki_history",
		"Read paginated revision metadata for an authorized page.",
		{ libraryId: identity, pageId: identity, ...page },
		["libraryId", "pageId"],
	],
	[
		"wiki_restore",
		"Restore the content of an earlier revision as a new revision, preserving the current page path.",
		{
			libraryId: identity,
			pageId: identity,
			requestId: identity,
			baseRevision: positive,
			revision: positive,
			summary: text,
		},
		["libraryId", "pageId", "requestId", "baseRevision", "revision", "summary"],
	],
	[
		"memo_lookup",
		"Reconcile your original write receipt without repeating effects.",
		{ requestId: identity },
		["requestId"],
	],
];
function pagination(input: Record<string, unknown>) {
	if (input.cursor !== undefined) string(input.cursor, 4096);
	if (input.limit !== undefined) integer(input.limit, 1, 50);
	return {
		...(input.cursor === undefined ? {} : { cursor: input.cursor }),
		...(input.limit === undefined ? {} : { limit: input.limit }),
	};
}
async function execute(client: MemoClient, action: string, input: unknown): Promise<unknown> {
	switch (action) {
		case "memo_libraries":
			shape(input, ["cursor", "limit"]);
			return client.libraries(pagination(input));
		case "memo_list":
			shape(input, ["libraryId", "prefix", "cursor", "limit"]);
			id(input.libraryId);
			if (input.prefix !== undefined) string(input.prefix, 1024, true);
			return client.list({
				libraryId: input.libraryId,
				...(input.prefix === undefined ? {} : { prefix: input.prefix }),
				...pagination(input),
			});
		case "memo_search":
			shape(input, ["query", "libraryId", "cursor", "limit"]);
			string(input.query, 512);
			if (input.libraryId !== undefined) id(input.libraryId);
			return client.search({
				query: input.query,
				...(input.libraryId === undefined ? {} : { libraryId: input.libraryId }),
				...pagination(input),
			});
		case "memo_read":
			shape(input, ["ref", "offset", "limit"]);
			reference(input.ref);
			if (input.offset !== undefined) integer(input.offset);
			if (input.limit !== undefined) integer(input.limit, 1, 16384);
			return client.read(input.ref, {
				...(input.offset === undefined ? {} : { offset: input.offset }),
				...(input.limit === undefined ? {} : { limit: input.limit }),
			});
		case "wiki_write":
			shape(input, [
				"libraryId",
				"requestId",
				"pageId",
				"baseRevision",
				"path",
				"title",
				"markdown",
				"summary",
				"sources",
			]);
			id(input.libraryId);
			id(input.requestId);
			if (input.pageId !== undefined) id(input.pageId);
			integer(input.baseRevision);
			string(input.path, 1024);
			string(input.title, 512);
			string(input.markdown, 256 * 1024, true);
			string(input.summary, 2048, true);
			references(input.sources);
			return client.write({
				libraryId: input.libraryId,
				requestId: input.requestId,
				...(input.pageId === undefined ? {} : { pageId: input.pageId }),
				baseRevision: input.baseRevision,
				path: input.path,
				title: input.title,
				markdown: input.markdown,
				summary: input.summary,
				sources: input.sources,
			});
		case "wiki_history":
			shape(input, ["libraryId", "pageId", "cursor", "limit"]);
			id(input.libraryId);
			id(input.pageId);
			return client.history({ libraryId: input.libraryId, pageId: input.pageId, ...pagination(input) });
		case "wiki_restore":
			shape(input, ["libraryId", "pageId", "requestId", "baseRevision", "revision", "summary"]);
			id(input.libraryId);
			id(input.pageId);
			id(input.requestId);
			integer(input.baseRevision, 1);
			integer(input.revision, 1);
			string(input.summary, 2048, true);
			return client.restore({
				libraryId: input.libraryId,
				pageId: input.pageId,
				requestId: input.requestId,
				baseRevision: input.baseRevision,
				revision: input.revision,
				summary: input.summary,
			});
		case "memo_lookup":
			shape(input, ["requestId"]);
			id(input.requestId);
			return client.lookup(input.requestId);
		default:
			invalid("Unknown Memo action");
	}
}
export function createMemoTools(options: {
	readonly resolve: (scope: ToolInvocationScope) => MemoClient | Promise<MemoClient>;
	readonly timeoutMs?: number;
}): { readonly tools: readonly Tool[]; readonly instructions: string; revoke(): void } {
	if (typeof options.resolve !== "function") invalid("Trusted invocation resolver required");
	const resolve = options.resolve,
		timeoutMs = options.timeoutMs ?? 30000;
	integer(timeoutMs, 1, 120000);
	let revoked = false;
	const tools: Tool[] = definitions.map(([name, description, properties, required]) => ({
		name,
		description,
		parameters: { type: "object", properties, required, additionalProperties: false },
		async execute(input, signal, scope) {
			let active = true,
				timer: ReturnType<typeof setTimeout> | undefined,
				cancel: (() => void) | undefined;
			const check = () => {
				if (!active || revoked || signal?.aborted)
					throw new MemoError("denied", "Memo invocation authority ended");
			};
			try {
				check();
				if (!scope) throw new MemoError("denied", "Native invocation required");
				const interrupted = new Promise<never>((_, reject) => {
					cancel = () => {
						active = false;
						reject(
							new MemoError(
								"unknown",
								"Memo operation interrupted; query the original request before retrying",
							),
						);
					};
					timer = setTimeout(cancel, timeoutMs);
					timer.unref();
					signal?.addEventListener("abort", cancel, { once: true });
				});
				const operation = Promise.resolve().then(async () => {
					const resolved = await resolve(scope);
					check();
					const client = resolved.withAuthority(check),
						value = await execute(client, name, input);
					const verify =
						name === "memo_read" || name === "memo_search" ? client.publicationCheck(value) : undefined;
					return { value, verify };
				});
				const result = await Promise.race([operation, interrupted]);
				try {
					check();
				} catch (error) {
					if (result.verify) throw error;
					throw new MemoError(
						"unknown",
						"Memo response could not be published; reconcile the original request",
					);
				}
				result.verify?.();
				return JSON.stringify({ status: "ok", value: result.value });
			} catch (error) {
				return JSON.stringify(
					error instanceof MemoError
						? { status: error.code, message: error.message }
						: {
								status: "unknown",
								message: "Memo result could not be confirmed; reconcile the original request.",
							},
				);
			} finally {
				active = false;
				if (timer) clearTimeout(timer);
				if (cancel) signal?.removeEventListener("abort", cancel);
			}
		},
	}));
	return Object.freeze({
		tools: frozen(tools),
		instructions:
			"Use memo_libraries/list/search/read to retrieve authorized knowledge. Continue every non-null cursor, including an empty page. References and revisions identify the exact source. Save Wiki only within approved publication scope; original private material remains read-only. Preserve requestId and use memo_lookup after an unknown write. Reading knowledge does not require a librarian or background model work.",
		revoke() {
			revoked = true;
		},
	});
}
