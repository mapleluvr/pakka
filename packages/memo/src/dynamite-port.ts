/** The public Book capabilities consumed by Memo, supplied by the host.
 * This is a structural consumer port, not a Book implementation. Installed integration
 * typechecks it against Dynamite's actual exported HistoryBookService/HistoryClient.
 * No private types or mandatory runtime import are needed by standalone Memo. */
export interface DynamiteBookPort {
	readonly bookId: string;
	connect(actor: { readonly id: string; readonly check: () => void }): DynamiteBookClient;
}
export interface DynamiteEvidence {
	readonly artifactId: string;
	readonly version: number;
	readonly locator?: string;
}
interface BookQuery {
	readonly revision?: number;
	readonly cursor?: string;
	readonly limit?: number;
	readonly maxBytes?: number;
}
interface BookEntry {
	readonly id: string;
	readonly kind: string;
	readonly title: string;
	readonly excerpt: string;
}
interface BookPage {
	readonly revision: number;
	readonly items: readonly BookEntry[];
	readonly cursor: string | null;
}
export interface DynamiteBookClient {
	/** Empty refs check Book own read authority; nonempty refs also check actual source fetches. */
	checkEvidence(refs: readonly DynamiteEvidence[]): void;
	open(revision?: number): Promise<unknown>;
	list(query?: BookQuery): Promise<BookPage>;
	search(query: BookQuery & { readonly query: string }): Promise<BookPage>;
	read(input: { readonly revision: number; readonly id: string }): Promise<{
		readonly id: string;
		readonly kind: string;
		readonly title: string;
		readonly text: string;
		readonly sources: readonly DynamiteEvidence[];
		readonly links: readonly string[];
	}>;
	source(input: {
		readonly ref: DynamiteEvidence;
		readonly offset?: number;
		readonly limit?: number;
	}): Promise<{
		readonly ref: DynamiteEvidence;
		readonly text: string;
		readonly offset: number;
		readonly nextOffset: number | null;
		readonly sources?: readonly DynamiteEvidence[];
	}>;
}
