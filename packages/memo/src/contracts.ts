export type MemoRole = "reader" | "editor" | "manager";
export type MemoErrorCode = "invalid" | "denied" | "conflict" | "busy" | "unavailable" | "unknown";
export class MemoError extends Error {
	readonly code: MemoErrorCode;
	constructor(code: MemoErrorCode, message: string) {
		super(message);
		this.name = "MemoError";
		this.code = code;
	}
}
export interface MemoActor {
	readonly id: string;
	readonly check: () => void;
}
export interface WikiRef {
	readonly kind: "wiki";
	readonly libraryId: string;
	readonly pageId: string;
	readonly revision: number;
}
export interface SourceRef {
	readonly kind: "source";
	readonly libraryId: string;
	readonly sourceId: string;
	readonly version: string | null;
	readonly locator?: string;
}
export type MemoRef = WikiRef | SourceRef;
export interface Page<T> {
	readonly items: readonly T[];
	readonly cursor: string | null;
}
export interface Library {
	readonly id: string;
	readonly title: string;
	readonly role: MemoRole;
}
export interface Entry {
	readonly ref: MemoRef;
	readonly title: string;
	readonly path: string;
	readonly excerpt: string;
}
export interface Revision {
	readonly revision: number;
	readonly actorId: string;
	readonly at: number;
	readonly summary: string;
	readonly sources: readonly MemoRef[];
}
export interface ReadOptions {
	readonly offset?: number;
	readonly limit?: number;
}
/** Offsets and lengths count Unicode code points, not UTF-16 or encoded bytes. */
export interface Content {
	readonly ref: MemoRef;
	readonly title: string;
	readonly path: string;
	readonly text: string;
	readonly offset: number;
	readonly nextOffset: number | null;
	readonly sources: readonly MemoRef[];
}
export interface Receipt {
	readonly actorId: string;
	readonly requestId: string;
	readonly libraryId: string;
	readonly action: string;
	readonly pageId?: string;
	readonly revision?: number;
	readonly sourceId?: string;
	readonly at: number;
}
export interface PageQuery {
	readonly cursor?: string;
	readonly limit?: number;
}
export interface ListQuery extends PageQuery {
	readonly libraryId: string;
	readonly prefix?: string;
}
export interface HistoryQuery extends PageQuery {
	readonly libraryId: string;
	readonly pageId: string;
}
export interface SearchQuery extends PageQuery {
	readonly query: string;
	readonly libraryId?: string;
}
export interface WritePage {
	readonly libraryId: string;
	readonly requestId: string;
	readonly pageId?: string;
	readonly baseRevision: number;
	readonly path: string;
	readonly title: string;
	readonly markdown: string;
	readonly summary: string;
	readonly sources: readonly MemoRef[];
}
export interface RestorePage {
	readonly libraryId: string;
	readonly pageId: string;
	readonly requestId: string;
	readonly baseRevision: number;
	readonly revision: number;
	readonly summary: string;
}
export interface SourceRegistration {
	readonly libraryId: string;
	readonly sourceId: string;
	readonly requestId: string;
	readonly baseVersion: number;
	readonly provider: string;
	readonly address: string;
	readonly version: string | null;
	readonly title: string;
	readonly summary: string;
}
export interface SourceCheck {
	readonly actorId: string;
	readonly action: "read" | "share";
	readonly libraryId: string;
	readonly address: string;
	readonly ref: SourceRef;
}
export interface SourceProvider {
	/** Synchronous current authorization, including authority to share into this library. */
	check(input: SourceCheck): void;
	/** One bounded source-local page. References must retain this source identity/version. */
	search?(
		input: SourceCheck & { readonly query: string; readonly limit: number; readonly cursor?: string },
	): Promise<Page<Entry>>;
	read(input: SourceCheck & { readonly offset: number; readonly limit: number }): Promise<{
		readonly ref: SourceRef;
		readonly text: string;
		readonly nextOffset: number | null;
		readonly sources?: readonly MemoRef[];
	}>;
}
export interface Change {
	readonly sequence: number;
	readonly actorId: string;
	readonly requestId: string;
	readonly action: string;
	readonly objectId: string;
	readonly before: number | null;
	readonly after: number | null;
	readonly at: number;
}
export interface MemoClient {
	libraries(query?: PageQuery): Promise<Page<Library>>;
	list(query: ListQuery): Promise<Page<Entry>>;
	search(query: SearchQuery): Promise<Page<Entry>>;
	read(ref: MemoRef, options?: ReadOptions): Promise<Content>;
	history(query: HistoryQuery): Promise<Page<Revision>>;
	changes(query: { readonly libraryId: string } & PageQuery): Promise<Page<Change>>;
	write(input: WritePage): Promise<Receipt>;
	restore(input: RestorePage): Promise<Receipt>;
	remove(input: {
		readonly libraryId: string;
		readonly pageId: string;
		readonly baseRevision: number;
		readonly requestId: string;
	}): Promise<Receipt>;
	grant(input: {
		readonly libraryId: string;
		readonly requestId: string;
		readonly actorId: string;
		readonly role: MemoRole | null;
	}): Promise<Receipt>;
	registerSource(input: SourceRegistration): Promise<Receipt>;
	lookup(requestId: string): Promise<Receipt | null>;
	exportMarkdown(input: { readonly libraryId: string; readonly pageId: string }): Promise<string>;
	importMarkdown(input: { readonly requestId: string; readonly document: string }): Promise<Receipt>;
	withAuthority(check: () => void): MemoClient;
}
export interface MemoService {
	/** Trusted initial provisioning, deliberately absent from the model-facing client. */
	createLibrary(input: { readonly id: string; readonly title: string; readonly ownerId: string }): void;
	connect(actor: MemoActor): MemoClient;
	close(): void;
}
export interface MemoOptions {
	readonly file: string;
	readonly providers?: Readonly<Record<string, SourceProvider>>;
}
