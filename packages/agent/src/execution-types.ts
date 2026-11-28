/** Pi-independent execution data. Binary content is immutable base64, not a native handle or mutable buffer. */
export interface ExecutionBytes {
	readonly base64: string;
}
export interface ExecutionFailure {
	readonly code:
		| "aborted"
		| "not_found"
		| "permission_denied"
		| "not_directory"
		| "is_directory"
		| "invalid"
		| "not_supported"
		| "unknown"
		| "timeout"
		| "shell_unavailable"
		| "spawn_error"
		| "callback_error";
	readonly message: string;
	readonly path?: string;
	readonly spillPath?: string;
}
export type ExecutionResult<T> =
	| Readonly<{ ok: true; value: T }>
	| Readonly<{ ok: false; error: ExecutionFailure }>;
export interface ExecutionFileInfo {
	readonly name: string;
	readonly path: string;
	readonly kind: "file" | "directory" | "symlink";
	readonly size: number;
	readonly mtimeMs: number;
}
export interface ExecutionLineScan {
	readonly newlines: number;
	readonly start: number;
	readonly end: number;
	readonly firstLineEnd: number;
	readonly lastLineStart: number;
	readonly selectedBytes: number;
	readonly firstLineBytes: number;
}
export interface ExecutionBinaryReader {
	info(signal?: AbortSignal): Promise<ExecutionResult<ExecutionFileInfo>>;
	read(offset: number, length: number, signal?: AbortSignal): Promise<ExecutionResult<ExecutionBytes>>;
	/** Zero-based, end-exclusive line interval [startLine, endLine). */
	scanLines(
		options: { readonly startLine: number; readonly endLine?: number },
		signal?: AbortSignal,
	): Promise<ExecutionResult<ExecutionLineScan>>;
	close(): Promise<void>;
}
export interface ExecutionTextReader {
	readLine(
		signal?: AbortSignal,
	): Promise<ExecutionResult<Readonly<{ text: string; terminated: boolean }> | undefined>>;
	close(): Promise<void>;
}
export interface ExecutionDirReader {
	next(
		maxEntries: number,
		signal?: AbortSignal,
	): Promise<ExecutionResult<Readonly<{ entries: readonly ExecutionFileInfo[]; done: boolean }>>>;
	close(): Promise<void>;
}
export interface ExecutionWatchTarget {
	readonly path: string;
	readonly recursive?: boolean;
	readonly exclude?: { readonly hidden?: boolean; readonly names?: readonly string[] };
}
export type ExecutionWatchChange =
	| Readonly<{ paths: readonly string[] }>
	| Readonly<{ overflow: true }>
	| Readonly<{ error: ExecutionFailure }>;
export interface ExecutionWatcher {
	readonly mode: "native" | "polling";
	close(): Promise<void>;
}
export interface ExecutionOutputInfo {
	readonly stream: "stdout" | "stderr";
	readonly skipped?: { readonly bytes: number; readonly newlines: number; readonly endsWithNewline: boolean };
}
export interface ExecutionCommandOptions {
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly inheritEnv?: boolean;
	/** Execution deadline in seconds, not a foreground/background wait budget. */
	readonly timeout?: number;
	readonly onOutput?: (text: string, info: ExecutionOutputInfo) => void;
	readonly spill?: { readonly afterBytes: number; readonly afterLines: number };
	readonly window?: {
		readonly maxBytes: number;
		readonly maxLines: number;
		readonly minIntervalMs: number;
		readonly bytesPerSecond: number;
	};
}
export interface ExecutionListingOptions {
	readonly hidden?: boolean;
	readonly gitignore?: boolean;
	readonly exclude?: readonly string[];
	readonly maxEntries?: number;
	readonly maxBytes?: number;
	readonly timeoutMs?: number;
}
/** Frozen, invocation-bound access. It cannot shut down its environment owner. */
export interface ExecutionAccess {
	/** File namespace identity, independent of cwd and invocation. */
	readonly id: string;
	readonly cwd: string;
	absolutePath(path: string, signal?: AbortSignal): Promise<ExecutionResult<string>>;
	joinPath(parts: readonly string[], signal?: AbortSignal): Promise<ExecutionResult<string>>;
	readTextFile(path: string, signal?: AbortSignal): Promise<ExecutionResult<string>>;
	openTextLineReader(path: string, signal?: AbortSignal): Promise<ExecutionResult<ExecutionTextReader>>;
	readTextLines(
		path: string,
		options?: { readonly maxLines?: number },
		signal?: AbortSignal,
	): Promise<ExecutionResult<readonly string[]>>;
	readBinaryFile(path: string, signal?: AbortSignal): Promise<ExecutionResult<ExecutionBytes>>;
	openBinaryReader(
		path: string,
		options?: { readonly noFollow?: boolean },
		signal?: AbortSignal,
	): Promise<ExecutionResult<ExecutionBinaryReader>>;
	writeFile(
		path: string,
		content: string | ExecutionBytes,
		signal?: AbortSignal,
	): Promise<ExecutionResult<void>>;
	appendFile(
		path: string,
		content: string | ExecutionBytes,
		signal?: AbortSignal,
	): Promise<ExecutionResult<void>>;
	truncateFile(path: string, size: number, signal?: AbortSignal): Promise<ExecutionResult<void>>;
	flushFile(path: string, signal?: AbortSignal): Promise<ExecutionResult<void>>;
	renameFile(
		sourcePath: string,
		destinationPath: string,
		signal?: AbortSignal,
	): Promise<ExecutionResult<void>>;
	fileInfo(path: string, signal?: AbortSignal): Promise<ExecutionResult<ExecutionFileInfo>>;
	listDir(path: string, signal?: AbortSignal): Promise<ExecutionResult<readonly ExecutionFileInfo[]>>;
	listFiles(
		path: string,
		options?: ExecutionListingOptions,
		signal?: AbortSignal,
	): Promise<
		ExecutionResult<
			Readonly<{
				entries: readonly Readonly<{ path: string; kind: ExecutionFileInfo["kind"] }>[];
				truncated: boolean;
			}>
		>
	>;
	openDirReader(path: string, signal?: AbortSignal): Promise<ExecutionResult<ExecutionDirReader>>;
	watch(
		targets: readonly ExecutionWatchTarget[],
		onChange: (change: ExecutionWatchChange) => void,
		signal?: AbortSignal,
	): Promise<ExecutionResult<ExecutionWatcher>>;
	canonicalPath(path: string, signal?: AbortSignal): Promise<ExecutionResult<string>>;
	exists(path: string, signal?: AbortSignal): Promise<ExecutionResult<boolean>>;
	createDir(
		path: string,
		options?: { readonly recursive?: boolean },
		signal?: AbortSignal,
	): Promise<ExecutionResult<void>>;
	remove(
		path: string,
		options?: { readonly recursive?: boolean; readonly force?: boolean },
		signal?: AbortSignal,
	): Promise<ExecutionResult<void>>;
	createTempDir(prefix?: string, signal?: AbortSignal): Promise<ExecutionResult<string>>;
	createTempFile(
		options?: { readonly prefix?: string; readonly suffix?: string },
		signal?: AbortSignal,
	): Promise<ExecutionResult<string>>;
	exec(
		command: string | readonly string[],
		options?: ExecutionCommandOptions,
		signal?: AbortSignal,
	): Promise<ExecutionResult<Readonly<{ exitCode: number; spillPath?: string }>>>;
}
/** Trusted driver input. Missing methods fail explicitly; they never select ambient Node I/O. */
export type ExecutionDriver = Pick<ExecutionAccess, "id" | "cwd"> &
	Partial<Omit<ExecutionAccess, "id" | "cwd">> & {
		cleanup(): Promise<void>;
	};
/** A complete owner-facing implementation, such as the explicit local driver. */
export interface ExecutionEnvironment extends ExecutionAccess {
	cleanup(): Promise<void>;
}
export interface ExecutionTarget {
	readonly sessionId: string;
	readonly conversationId: string;
	readonly profile: string;
	readonly incarnation?: string;
	readonly cwd: string;
}
export type NativeExecutionTool = "read" | "write" | "edit" | "bash" | "powershell";
export interface ExecutionConfiguration {
	/** Bootstrap-owned policy/configuration identity; change it when driver semantics or permissions change. */
	readonly id: string;
	readonly open: (target: ExecutionTarget) => ExecutionDriver | Promise<ExecutionDriver>;
	/** Explicit native tool selection; omitted means access only for cooperating custom tools. */
	readonly tools?: readonly NativeExecutionTool[];
	readonly powershellPrograms?: readonly string[];
}
export interface LocalExecutionOptions {
	readonly cwd: string;
	readonly shellPath?: string;
	readonly shellEnv?: Readonly<Record<string, string>>;
}
