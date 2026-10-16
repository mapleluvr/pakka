import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath, readdir, readFile, writeFile, rename, unlink, link, mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import type { ConversationRef, JsonObject, Runtime } from "@pakka/agent";
import type { PocketAuthority, PocketPeople, PocketPermission } from "./pocket-people.ts";

export interface PocketFileRoot {
	readonly id: string;
	readonly path: string;
	readonly resources: "*" | readonly string[];
	readonly writable?: boolean;
	readonly git?: boolean;
	readonly worktreesDir?: string;
}
export interface PocketFileAddress {
	readonly root: string;
	readonly path: string;
}
export interface PocketFileRootView {
	readonly id: string;
	readonly writable: boolean;
	readonly git: boolean;
}
export interface PocketFileView extends PocketFileAddress {
	readonly bytes: number;
	readonly sha256: string;
	readonly type: string;
	readonly text?: string;
	readonly base64?: string;
}
export interface PocketFileExport extends PocketFileAddress {
	readonly bytes: number;
	readonly sha256: string;
	readonly base64: string;
}
export interface PocketFileListing extends PocketFileAddress {
	readonly entries: readonly {
		readonly name: string;
		readonly path: string;
		readonly kind: "file" | "directory";
		readonly bytes: number;
	}[];
	readonly truncated: boolean;
}
export interface PocketFileEffect {
	readonly requestId: string;
	readonly state: "done" | "unknown";
	readonly value?: {
		readonly path?: string;
		readonly sha256?: string;
		readonly name?: string;
		readonly branch?: string;
	};
}
export interface PocketFileWrite extends PocketFileAddress {
	readonly requestId: string;
	readonly expectedSha256: string | null;
	readonly text: string;
}
export interface PocketFileUpload extends PocketFileAddress {
	readonly requestId: string;
	readonly base64: string;
}
export interface PocketGitChanges {
	readonly files: readonly {
		readonly path: string;
		readonly status: string;
		readonly previousPath?: string;
	}[];
}
export interface PocketGitBranch {
	readonly name: string;
	readonly current: boolean;
	readonly commit: string;
}
export interface PocketGitWorktree {
	readonly name: string;
	readonly branch: string;
}
export interface PocketFilesClient {
	roots(ref: ConversationRef): Promise<readonly PocketFileRootView[]>;
	list(ref: ConversationRef, input: PocketFileAddress): Promise<PocketFileListing>;
	read(ref: ConversationRef, input: PocketFileAddress): Promise<PocketFileView>;
	export(ref: ConversationRef, input: PocketFileAddress): Promise<PocketFileExport>;
	write(ref: ConversationRef, input: PocketFileWrite): Promise<PocketFileEffect>;
	upload(ref: ConversationRef, input: PocketFileUpload): Promise<PocketFileEffect>;
	changes(ref: ConversationRef, input: { readonly root: string }): Promise<PocketGitChanges>;
	diff(
		ref: ConversationRef,
		input: PocketFileAddress,
	): Promise<{ readonly path: string; readonly text: string }>;
	branches(ref: ConversationRef, input: { readonly root: string }): Promise<readonly PocketGitBranch[]>;
	switchBranch(
		ref: ConversationRef,
		input: {
			readonly root: string;
			readonly requestId: string;
			readonly name: string;
			readonly create: boolean;
		},
	): Promise<PocketFileEffect>;
	worktrees(ref: ConversationRef, input: { readonly root: string }): Promise<readonly PocketGitWorktree[]>;
	addWorktree(
		ref: ConversationRef,
		input: {
			readonly root: string;
			readonly requestId: string;
			readonly name: string;
			readonly branch: string;
		},
	): Promise<PocketFileEffect>;
	removeWorktree(
		ref: ConversationRef,
		input: {
			readonly root: string;
			readonly requestId: string;
			readonly name: string;
			readonly force: boolean;
		},
	): Promise<PocketFileEffect>;
	receipt(
		ref: ConversationRef,
		input: { readonly root: string; readonly requestId: string },
	): Promise<PocketFileEffect>;
}
export interface PocketFiles {
	/** Optional trusted lifetime/generation check, repeated at reads and immediately before external effects. */
	bind(actor: PocketAuthority, check?: () => void): PocketFilesClient;
}
export interface PocketFilesOptions {
	readonly runtime: Runtime;
	readonly people: PocketPeople;
	readonly namespace: string;
	readonly roots: readonly PocketFileRoot[];
	readonly maxBytes?: number;
	/** Synchronous host guard, repeated directly before a disk/Git effect; never a wire capability. */
	readonly beforeChange?: (actor: PocketAuthority, ref: ConversationRef) => void;
}
/** Raised only by a definite pre-effect hash/existence/dirty-tree guard. */
export class PocketFileConflict extends Error {
	constructor() {
		super("Pocket file conflict");
	}
}
class FileDenied extends Error {
	constructor() {
		super("Pocket file authority/path denied");
	}
}
const deny = (): never => {
		throw new FileDenied();
	},
	conflict = (): never => {
		throw new PocketFileConflict();
	};
const record = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v);
const identity = (v: unknown): v is string =>
	typeof v === "string" && /^[a-zA-Z0-9][-a-zA-Z0-9._:]{0,159}$/.test(v);
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const missing = (e: unknown) => record(e) && e.code === "ENOENT";
const inside = (root: string, path: string) => {
	const value = relative(root, path);
	return !isAbsolute(value) && value !== ".." && !value.startsWith(".." + sep);
};
const same = (a: ConversationRef, b: ConversationRef) =>
	["key", "sessionId", "conversationId", "incarnation", "profile"].every(
		(k) => a[k as keyof ConversationRef] === b[k as keyof ConversationRef],
	);
function freeze<T>(value: T): T {
	if (value && typeof value === "object") {
		Object.values(value).forEach(freeze);
		Object.freeze(value);
	}
	return value;
}
function shape(input: unknown, keys: readonly string[]): void {
	if (!record(input) || Object.keys(input).length !== keys.length || keys.some((key) => !(key in input)))
		throw Error("Invalid file request");
}
function safePath(input: unknown, empty = false): string {
	if (
		typeof input !== "string" ||
		input.length > 512 ||
		(!input && !empty) ||
		/[%\\:\x00-\x1f\x7f<>"|?*]/.test(input) ||
		input.startsWith("/")
	)
		return deny();
	if (!input && empty) return input;
	for (const part of input.split("/"))
		if (
			!part ||
			part === "." ||
			part === ".." ||
			/[. ]$/.test(part) ||
			/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
			/^(?:\.git$|\.ssh$|\.aws$|\.env(?:\.|$)|\.npmrc$|\.netrc$|\.gitconfig$|\.pakka-write-)/i.test(part)
		)
			return deny();
	return input;
}
function branchName(v: unknown): string {
	if (
		typeof v !== "string" ||
		!/^[-a-zA-Z0-9][-/a-zA-Z0-9._]{0,99}$/.test(v) ||
		v.startsWith("-") ||
		v.includes("..") ||
		v.includes("//") ||
		v.endsWith("/") ||
		v.endsWith(".") ||
		v.endsWith(".lock") ||
		v === "HEAD" ||
		v.split("/").some((p) => p.startsWith("."))
	)
		return deny();
	return v;
}
function treeName(v: unknown): string {
	if (typeof v !== "string" || !/^[a-zA-Z0-9][-a-zA-Z0-9_]{0,63}$/.test(v)) return deny();
	return v;
}
function mime(bytes: Buffer): string {
	if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
	if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
	if (bytes.subarray(0, 6).toString() === "GIF89a" || bytes.subarray(0, 6).toString() === "GIF87a")
		return "image/gif";
	return "application/octet-stream";
}
async function checkedPath(root: string, path: string, create = false): Promise<string> {
	const base = await lstat(root);
	if (
		base.isSymbolicLink() ||
		!base.isDirectory() ||
		resolve(await realpath(root)).toLowerCase() !== resolve(root).toLowerCase()
	)
		return deny();
	let full = root;
	const parts = path ? path.split("/") : [];
	for (let i = 0; i < parts.length; i++) {
		full = join(full, parts[i]!);
		try {
			const stat = await lstat(full);
			if (
				stat.isSymbolicLink() ||
				(!stat.isFile() && !stat.isDirectory()) ||
				(stat.isFile() && stat.nlink !== 1) ||
				(i < parts.length - 1 && !stat.isDirectory())
			)
				return deny();
		} catch (error) {
			if (create && i === parts.length - 1 && missing(error)) return full;
			throw error;
		}
	}
	if (!inside(root, full)) return deny();
	return full;
}
interface EffectRow {
	id: string;
	actor: string;
	root: string;
	ref: ConversationRef;
	fingerprint: string;
	state: "running" | "done" | "unknown" | "denied";
	value?: PocketFileEffect["value"];
}
interface State {
	schema: 1;
	configuration: string;
	rows: EffectRow[];
}
function decode(value: JsonObject, version: number, configuration: string): State {
	if (version === 0 && Object.keys(value).length === 0) return { schema: 1, configuration, rows: [] };
	if (
		value.schema !== 1 ||
		value.configuration !== configuration ||
		!Array.isArray(value.rows) ||
		value.rows.length > 256
	)
		throw Error("Unconfirmed file effect storage");
	const rows: EffectRow[] = [];
	for (const row of value.rows) {
		if (
			!record(row) ||
			!identity(row.id) ||
			!identity(row.actor) ||
			!identity(row.root) ||
			typeof row.fingerprint !== "string" ||
			!/^[a-f0-9]{64}$/.test(row.fingerprint) ||
			!record(row.ref) ||
			Object.keys(row).some(
				(k) => !["id", "actor", "root", "ref", "fingerprint", "state", "value"].includes(k),
			)
		)
			throw Error("Unconfirmed file effect storage");
		const ref = row.ref,
			phase = row.state;
		if (
			!identity(ref.key) ||
			!identity(ref.sessionId) ||
			!identity(ref.conversationId) ||
			!identity(ref.incarnation) ||
			!identity(ref.profile) ||
			Object.keys(ref).length !== 5 ||
			(phase !== "running" && phase !== "done" && phase !== "unknown" && phase !== "denied")
		)
			throw Error("Unconfirmed file effect storage");
		let outcome: EffectRow["value"];
		if (row.value !== undefined) {
			const result = row.value;
			if (
				!record(result) ||
				Object.entries(result).some(
					([k, v]) =>
						!["path", "sha256", "name", "branch"].includes(k) || typeof v !== "string" || v.length > 512,
				)
			)
				throw Error("Unconfirmed file effect storage");
			outcome = {
				...(typeof result.path === "string" ? { path: result.path } : {}),
				...(typeof result.sha256 === "string" ? { sha256: result.sha256 } : {}),
				...(typeof result.name === "string" ? { name: result.name } : {}),
				...(typeof result.branch === "string" ? { branch: result.branch } : {}),
			};
		}
		rows.push({
			id: row.id,
			actor: row.actor,
			root: row.root,
			ref: {
				key: ref.key,
				sessionId: ref.sessionId,
				conversationId: ref.conversationId,
				incarnation: ref.incarnation,
				profile: ref.profile,
			},
			fingerprint: row.fingerprint,
			state: phase,
			...(outcome ? { value: outcome } : {}),
		});
	}
	if (new Set(rows.map((row) => `${row.actor}:${row.id}`)).size !== rows.length)
		throw Error("Unconfirmed file request identity");
	return { schema: 1, configuration, rows };
}
const dto = (row: EffectRow): PocketFileEffect =>
	freeze({
		requestId: row.id,
		state: row.state === "done" ? "done" : "unknown",
		...(row.state === "done" ? { value: row.value } : {}),
	});

/** Explicit host-approved filesystem roots; no raw paths or shell are accepted from a browser. */
export async function createPocketFiles(options: PocketFilesOptions): Promise<PocketFiles> {
	const { runtime, people } = options,
		max = options.maxBytes ?? 65536;
	if (
		!identity(options.namespace) ||
		!Number.isSafeInteger(max) ||
		max < 1024 ||
		max > 131072 ||
		!Array.isArray(options.roots) ||
		options.roots.length < 1 ||
		options.roots.length > 16
	)
		throw Error("Invalid file root configuration");
	const roots = new Map<string, PocketFileRoot>();
	const session = await realpath(runtime.view().sessionFile);
	for (const source of options.roots) {
		if (
			!source ||
			!identity(source.id) ||
			roots.has(source.id) ||
			!isAbsolute(source.path) ||
			(source.resources !== "*" &&
				(!Array.isArray(source.resources) ||
					!source.resources.length ||
					source.resources.some((v: unknown) => !identity(v)))) ||
			(source.writable !== undefined && typeof source.writable !== "boolean") ||
			(source.git !== undefined && typeof source.git !== "boolean")
		)
			throw Error("Invalid file root configuration");
		if ((await lstat(source.path)).isSymbolicLink()) return deny();
		const path = await realpath(source.path);
		if (inside(path, session) || inside(dirname(session), path))
			throw Error("Native storage cannot be a file root");
		await checkedPath(path, "");
		let worktreesDir: string | undefined;
		if (source.worktreesDir) {
			if (!isAbsolute(source.worktreesDir)) throw Error("Invalid isolated worktree root");
			worktreesDir = join(await realpath(dirname(source.worktreesDir)), basename(source.worktreesDir));
			if (
				inside(path, worktreesDir) ||
				inside(worktreesDir, path) ||
				inside(worktreesDir, session) ||
				inside(dirname(session), worktreesDir)
			)
				throw Error("Invalid isolated worktree root");
		}
		roots.set(
			source.id,
			freeze({
				...source,
				path,
				resources: source.resources === "*" ? "*" : [...source.resources],
				...(worktreesDir ? { worktreesDir } : {}),
			}),
		);
	}
	const configuration = hash(JSON.stringify([...roots.values()])),
		store = runtime.store({ namespace: options.namespace, maxBytes: 1024 * 1024 });
	let available = true,
		tail: Promise<unknown> = Promise.resolve();
	const snapshot = async () => {
		if (!available) throw Error("File effects unavailable");
		try {
			const saved = await store.snapshot();
			return { version: saved.version, state: decode(saved.data, saved.version, configuration) };
		} catch (error) {
			available = false;
			throw error;
		}
	};
	await snapshot();
	const exclusive = <T>(effect: () => Promise<T>): Promise<T> => {
		const run = tail.then(effect);
		tail = run.then(
			() => {},
			() => {},
		);
		return run;
	};
	async function update(effect: (state: State) => void, check: () => void = () => {}): Promise<void> {
		for (let retry = 0; retry < 64; retry++) {
			const current = await snapshot();
			effect(current.state);
			check();
			const data: JsonObject = {
				schema: 1,
				configuration,
				rows: current.state.rows.map((row) => ({
					id: row.id,
					actor: row.actor,
					root: row.root,
					ref: { ...row.ref },
					fingerprint: row.fingerprint,
					state: row.state,
					...(row.value ? { value: { ...row.value } } : {}),
				})),
			};
			try {
				await store.compareAndSet(current.version, data, check);
				return;
			} catch (error) {
				if ((await snapshot()).version <= current.version) throw error;
			}
		}
		throw Error("Unconfirmed file effect contention");
	}
	const hooks = join(dirname(runtime.view().sessionFile), "disabled-file-git-hooks"),
		nullFile = process.platform === "win32" ? "NUL" : "/dev/null";
	async function command(
		root: PocketFileRoot,
		args: readonly string[],
		check: () => void = () => {},
		cwd = root.path,
	): Promise<string> {
		if (!root.git) return deny();
		await checkedPath(root.path, "");
		try {
			await lstat(hooks);
			return deny();
		} catch (error) {
			if (!missing(error)) throw error;
		}
		check();
		return new Promise((resolveCommand, reject) => {
			execFile(
				"git",
				[
					"--no-pager",
					"--no-optional-locks",
					"-c",
					`core.hooksPath=${hooks}`,
					"-c",
					"core.fsmonitor=false",
					"-c",
					`core.attributesFile=${nullFile}`,
					"-c",
					"credential.helper=",
					"-c",
					"submodule.recurse=false",
					...args,
				],
				{
					cwd,
					timeout: 10000,
					maxBuffer: 256 * 1024,
					encoding: "utf8",
					windowsHide: true,
					env: {
						PATH: process.env.PATH,
						SystemRoot: process.env.SystemRoot,
						ComSpec: process.env.ComSpec,
						TEMP: process.env.TEMP,
						TMP: process.env.TMP,
						GIT_CONFIG_NOSYSTEM: "1",
						GIT_CONFIG_GLOBAL: nullFile,
						GIT_ATTR_NOSYSTEM: "1",
						GIT_TERMINAL_PROMPT: "0",
						GIT_OPTIONAL_LOCKS: "0",
						GIT_LITERAL_PATHSPECS: "1",
						GIT_LFS_SKIP_SMUDGE: "1",
					},
				},
				(error, stdout) => {
					if (error) reject(error);
					else resolveCommand(stdout);
				},
			);
		});
	}
	async function gitReady(root: PocketFileRoot): Promise<void> {
		const directory = join(root.path, ".git"),
			stat = await lstat(directory);
		if (!stat.isDirectory() || stat.isSymbolicLink()) return deny();
		const top = (await command(root, ["rev-parse", "--show-toplevel"])).trim();
		if (resolve(top).toLowerCase() !== root.path.toLowerCase()) return deny();
		// Includes/filters can start processes or read configuration outside the approved root. Refuse them
		// rather than trusting --no-ext-diff or a disabled hook alone. No remote/submodule command exists.
		const config = await command(root, ["config", "--local", "--no-includes", "--list"]);
		if (
			config
				.split(/\r?\n/)
				.some((line) =>
					/^(?:include\.|includeif\.|filter\.|diff\..*\.command=|core\.(?:sshcommand|fsmonitor)=|extensions\.)/i.test(
						line,
					),
				)
		)
			return deny();
	}
	async function gitChanges(root: PocketFileRoot): Promise<PocketGitChanges> {
		await gitReady(root);
		const text = await command(root, [
				"status",
				"--porcelain=v1",
				"-z",
				"--untracked-files=all",
				"--ignore-submodules=all",
			]),
			parts = text.split("\0"),
			files: { path: string; status: string; previousPath?: string }[] = [];
		for (let i = 0; i < parts.length; i++) {
			const row = parts[i];
			if (!row) continue;
			const status = row.slice(0, 2),
				path = row.slice(3),
				previousPath = /[RC]/.test(status) ? parts[++i] : undefined;
			try {
				safePath(path);
				if (previousPath) safePath(previousPath);
			} catch {
				continue;
			}
			files.push({ path, status, ...(previousPath ? { previousPath } : {}) });
		}
		return freeze({ files });
	}
	async function treeDirectory(root: PocketFileRoot, create = false): Promise<string> {
		if (!root.worktreesDir) return deny();
		const path = root.worktreesDir,
			parent = dirname(path);
		await checkedPath(parent, "");
		try {
			const s = await lstat(path);
			if (s.isSymbolicLink() || !s.isDirectory()) return deny();
		} catch (error) {
			if (!create || !missing(error)) throw error;
			await mkdir(path);
		}
		await checkedPath(path, "");
		return path;
	}
	async function gitTrees(root: PocketFileRoot): Promise<readonly PocketGitWorktree[]> {
		await gitReady(root);
		if (!root.worktreesDir) return freeze([]);
		let treeRoot: string;
		try {
			treeRoot = await treeDirectory(root);
		} catch (error) {
			if (missing(error)) return freeze([]);
			throw error;
		}
		const text = await command(root, ["worktree", "list", "--porcelain", "-z"]),
			result: PocketGitWorktree[] = [];
		for (const block of text.split("\0\0")) {
			const lines = block.split("\0"),
				path = lines.find((s) => s.startsWith("worktree "))?.slice(9),
				branch = lines.find((s) => s.startsWith("branch refs/heads/"))?.slice(18);
			if (!path || !branch || dirname(resolve(path)).toLowerCase() !== treeRoot.toLowerCase()) continue;
			const name = relative(treeRoot, resolve(path));
			treeName(name);
			branchName(branch);
			await checkedPath(treeRoot, name);
			result.push({ name, branch });
		}
		return freeze(result);
	}
	return Object.freeze({
		bind(actor: PocketAuthority, liveCheck: () => void = () => {}): PocketFilesClient {
			liveCheck();
			people.current(actor);
			function check(
				ref: ConversationRef,
				id: string,
				permission: PocketPermission = "read",
			): PocketFileRoot {
				liveCheck();
				if (!available || runtime.view().phase !== "ready") throw Error("File service unavailable");
				try {
					people.check(actor, permission, ref.conversationId);
				} catch {
					return deny();
				}
				if (!runtime.view().conversations.some((row) => same(row, ref))) return deny();
				const root = roots.get(id);
				if (
					!root ||
					(root.resources !== "*" && !root.resources.includes(ref.conversationId)) ||
					(permission !== "read" && !root.writable)
				)
					return deny();
				return root;
			}
			function changing(ref: ConversationRef, root: PocketFileRoot, git = false) {
				check(ref, root.id, "manage");
				if (git) {
					const resources =
						root.resources === "*"
							? runtime.view().conversations.map((row) => row.conversationId)
							: root.resources;
					for (const id of resources) {
						try {
							people.check(actor, "manage", id);
						} catch {
							return deny();
						}
					}
				}
				try {
					options.beforeChange?.(actor, ref);
				} catch {
					throw Error("Unconfirmed file host guard");
				}
			}
			async function quiet(ref: ConversationRef, root: PocketFileRoot) {
				changing(ref, root, true);
				const ids =
					root.resources === "*" ? runtime.view().conversations.map((r) => r.conversationId) : root.resources;
				for (const id of ids) {
					const target = runtime.view().conversations.find((r) => r.conversationId === id);
					if (!target) return deny();
					const view = await runtime.readConversation(target, () => changing(ref, root, true));
					if (view.live.busy) return conflict();
				}
				changing(ref, root, true);
			}
			async function bytes(ref: ConversationRef, input: PocketFileAddress) {
				shape(input, ["root", "path"]);
				const root = check(ref, input.root),
					path = await checkedPath(root.path, safePath(input.path)),
					stat = await lstat(path);
				if (!stat.isFile() || stat.size > max) throw Error("File size limit or path refused");
				const data = await readFile(path);
				if (data.length > max) throw Error("File size limit");
				await checkedPath(root.path, input.path);
				check(ref, input.root);
				return data;
			}
			async function mutate(
				ref: ConversationRef,
				input: { root: string; requestId: string },
				operation: string,
				payload: Record<string, unknown>,
				prepare: (root: PocketFileRoot) => Promise<void>,
				effect: (root: PocketFileRoot, check: () => void) => Promise<NonNullable<PocketFileEffect["value"]>>,
				git = false,
			): Promise<PocketFileEffect> {
				if (!identity(input.requestId)) throw Error("Invalid file request identity");
				const root = check(ref, input.root, "manage"),
					actorId = people.current(actor).id,
					fingerprint = hash(JSON.stringify([operation, ref, input.root, payload]));
				return exclusive(async () => {
					changing(ref, root, git);
					let current = await snapshot(),
						row = current.state.rows.find((r) => r.actor === actorId && r.id === input.requestId);
					if (row) {
						if (row.fingerprint !== fingerprint) return conflict();
						if (row.state === "denied") return conflict();
						changing(ref, root, git);
						return dto(row);
					}
					await prepare(root);
					changing(ref, root, git);
					let won = false;
					await update(
						(state) => {
							won = false;
							row = state.rows.find((r) => r.actor === actorId && r.id === input.requestId);
							if (row) {
								if (row.fingerprint !== fingerprint) return conflict();
								return;
							}
							if (state.rows.length >= 256) throw Error("File request capacity");
							state.rows.push({
								id: input.requestId,
								actor: actorId,
								root: input.root,
								ref: { ...ref },
								fingerprint,
								state: "running",
							});
							won = true;
						},
						() => changing(ref, root, git),
					);
					if (!won) {
						current = await snapshot();
						row = current.state.rows.find((r) => r.actor === actorId && r.id === input.requestId)!;
						if (row.state === "denied") return conflict();
						return dto(row);
					}
					let value: PocketFileEffect["value"],
						failure: unknown,
						began = false;
					try {
						value = await effect(root, () => {
							changing(ref, root, git);
							began = true;
						});
					} catch (error) {
						failure = error;
					}
					const phase =
						!began && (failure instanceof PocketFileConflict || failure instanceof FileDenied)
							? "denied"
							: failure
								? "unknown"
								: "done";
					await update((state) => {
						const saved = state.rows.find((r) => r.actor === actorId && r.id === input.requestId);
						if (!saved || saved.fingerprint !== fingerprint) throw Error("Unconfirmed file outcome");
						saved.state = phase;
						if (value) saved.value = value;
					});
					if (phase === "denied") throw failure;
					try {
						check(ref, input.root);
					} catch {
						throw Error("Unconfirmed file outcome after authority change");
					}
					return freeze({
						requestId: input.requestId,
						state: phase === "done" ? "done" : "unknown",
						...(phase === "done" ? { value } : {}),
					});
				});
			}
			async function save(
				ref: ConversationRef,
				input: PocketFileWrite,
				operation = "write",
				data = Buffer.from(input.text, "utf8"),
			): Promise<PocketFileEffect> {
				safePath(input.path);
				if (
					data.length > max ||
					(input.expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(input.expectedSha256))
				)
					throw Error("Invalid file content or hash");
				async function verify(root: PocketFileRoot) {
					const path = await checkedPath(root.path, input.path, true);
					let current: Buffer | undefined;
					try {
						const stat = await lstat(path);
						if (!stat.isFile() || stat.size > max) throw Error("File size or path refused");
						current = await readFile(path);
					} catch (error) {
						if (!missing(error)) throw error;
					}
					if (
						input.expectedSha256 === null
							? current !== undefined
							: !current || hash(current) !== input.expectedSha256
					)
						return conflict();
				}
				return mutate(
					ref,
					input,
					operation,
					{ path: input.path, expected: input.expectedSha256, sha256: hash(data) },
					verify,
					async (root, guard) => {
						const path = await checkedPath(root.path, input.path, true),
							temp = join(dirname(path), ".pakka-write-" + randomUUID());
						let attempted = false;
						try {
							await writeFile(temp, data, { flag: "wx", mode: 0o600 });
							await verify(root);
							guard();
							attempted = true;
							if (input.expectedSha256 === null) {
								try {
									await link(temp, path);
								} catch (error) {
									if (record(error) && error.code === "EEXIST") return conflict();
									throw error;
								}
							} else await rename(temp, path);
							const actual = await readFile(path);
							if (hash(actual) !== hash(data)) throw Error("Unconfirmed file bytes");
							return { path: input.path, sha256: hash(data) };
						} catch (error) {
							if (attempted && !(error instanceof PocketFileConflict)) throw Error("Unconfirmed disk effect");
							throw error;
						} finally {
							try {
								await unlink(temp);
							} catch (error) {
								if (!missing(error)) available = false;
							}
						}
					},
				);
			}
			const client: PocketFilesClient = {
				roots: async (ref) => {
					liveCheck();
					people.check(actor, "read", ref.conversationId);
					const found = [];
					for (const root of roots.values())
						if (root.resources === "*" || root.resources.includes(ref.conversationId)) {
							check(ref, root.id);
							found.push({
								id: root.id,
								writable: !!root.writable && ["admin", "driver"].includes(people.current(actor).role),
								git: !!root.git,
							});
						}
					return freeze(found);
				},
				list: async (ref, input) => {
					shape(input, ["root", "path"]);
					const root = check(ref, input.root),
						path = await checkedPath(root.path, safePath(input.path, true));
					const rows = await readdir(path, { withFileTypes: true }),
						entries: { name: string; path: string; kind: "file" | "directory"; bytes: number }[] = [];
					for (const row of rows.slice(0, 500)) {
						const name = input.path ? input.path + "/" + row.name : row.name;
						try {
							safePath(name);
							await checkedPath(root.path, name);
							const stat = await lstat(join(path, row.name));
							entries.push({
								name: row.name,
								path: name,
								kind: stat.isDirectory() ? "directory" : "file",
								bytes: stat.isFile() ? stat.size : 0,
							});
						} catch (error) {
							if (error instanceof FileDenied || missing(error)) continue;
							throw error;
						}
					}
					check(ref, input.root);
					return freeze({
						root: input.root,
						path: input.path,
						entries: entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
						truncated: rows.length > 500,
					});
				},
				read: async (ref, input) => {
					const data = await bytes(ref, input);
					let text: string | undefined;
					try {
						text = new TextDecoder("utf-8", { fatal: true }).decode(data);
						if (text.includes("\0")) text = undefined;
					} catch {
						/* Binary has an explicit encoding, not replacement characters. */
					}
					return freeze({
						root: input.root,
						path: input.path,
						bytes: data.length,
						sha256: hash(data),
						type: text === undefined ? mime(data) : "text/plain",
						...(text === undefined ? { base64: data.toString("base64") } : { text }),
					});
				},
				export: async (ref, input) => {
					const data = await bytes(ref, input);
					return freeze({
						...input,
						bytes: data.length,
						sha256: hash(data),
						base64: data.toString("base64"),
					});
				},
				write: async (ref, input) => {
					shape(input, ["root", "path", "requestId", "expectedSha256", "text"]);
					if (typeof input.text !== "string") throw Error("Invalid file content");
					return save(ref, input);
				},
				upload: async (ref, input) => {
					shape(input, ["root", "path", "requestId", "base64"]);
					if (
						typeof input.base64 !== "string" ||
						input.base64.length > Math.ceil(max / 3) * 4 ||
						!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)
					)
						throw Error("Invalid file base64");
					const data = Buffer.from(input.base64, "base64");
					if (data.toString("base64") !== input.base64) throw Error("Invalid file base64");
					return save(ref, { ...input, expectedSha256: null, text: "" }, "upload", data);
				},
				changes: async (ref, input) => {
					shape(input, ["root"]);
					const root = check(ref, input.root),
						result = await gitChanges(root);
					check(ref, input.root);
					return result;
				},
				diff: async (ref, input) => {
					shape(input, ["root", "path"]);
					const root = check(ref, input.root);
					safePath(input.path);
					await checkedPath(root.path, input.path);
					await gitReady(root);
					const text = await command(root, [
						"diff",
						"--no-ext-diff",
						"--no-textconv",
						"HEAD",
						"--",
						input.path,
					]);
					check(ref, input.root);
					return freeze({ path: input.path, text });
				},
				branches: async (ref, input) => {
					shape(input, ["root"]);
					const root = check(ref, input.root);
					await gitReady(root);
					const current = (await command(root, ["branch", "--show-current"])).trim(),
						text = await command(root, [
							"for-each-ref",
							"--format=%(refname:short)%00%(objectname)",
							"refs/heads",
						]);
					const result = text
						.trim()
						.split(/\r?\n/)
						.filter(Boolean)
						.map((line) => {
							const [name, commit] = line.split("\0");
							branchName(name);
							if (!commit || !/^[a-f0-9]{40,64}$/.test(commit)) throw Error("Invalid Git branch");
							return { name: name!, commit, current: name === current };
						});
					check(ref, input.root);
					return freeze(result);
				},
				switchBranch: async (ref, input) => {
					shape(input, ["root", "requestId", "name", "create"]);
					const name = branchName(input.name);
					if (typeof input.create !== "boolean") throw Error("Invalid branch operation");
					return mutate(
						ref,
						input,
						"branch",
						{ name, create: input.create },
						async (root) => {
							await quiet(ref, root);
							await gitReady(root);
							if ((await gitChanges(root)).files.length) return conflict();
						},
						async (root, guard) => {
							await quiet(ref, root);
							await command(root, input.create ? ["switch", "-c", name] : ["switch", name], guard);
							if ((await command(root, ["branch", "--show-current"])).trim() !== name)
								throw Error("Unconfirmed Git branch");
							return { branch: name };
						},
						true,
					);
				},
				worktrees: async (ref, input) => {
					shape(input, ["root"]);
					const root = check(ref, input.root),
						result = await gitTrees(root);
					check(ref, input.root);
					return result;
				},
				addWorktree: async (ref, input) => {
					shape(input, ["root", "requestId", "name", "branch"]);
					const name = treeName(input.name),
						branch = branchName(input.branch);
					return mutate(
						ref,
						input,
						"worktree.add",
						{ name, branch },
						async (root) => {
							await quiet(ref, root);
							await gitReady(root);
							if (!root.worktreesDir) return deny();
							try {
								await lstat(join(root.worktreesDir, name));
								return conflict();
							} catch (error) {
								if (!missing(error)) throw error;
							}
						},
						async (root, guard) => {
							const base = await treeDirectory(root, true);
							await quiet(ref, root);
							await command(root, ["worktree", "add", "-b", branch, join(base, name)], guard);
							if (!(await gitTrees(root)).some((row) => row.name === name && row.branch === branch))
								throw Error("Unconfirmed worktree creation");
							return { name, branch };
						},
						true,
					);
				},
				removeWorktree: async (ref, input) => {
					shape(input, ["root", "requestId", "name", "force"]);
					const name = treeName(input.name);
					if (typeof input.force !== "boolean") throw Error("Invalid worktree operation");
					return mutate(
						ref,
						input,
						"worktree.remove",
						{ name, force: input.force },
						async (root) => {
							await quiet(ref, root);
							if (!(await gitTrees(root)).some((row) => row.name === name)) return conflict();
							if (
								!input.force &&
								(
									await command(
										root,
										["status", "--porcelain=v1", "-z", "--untracked-files=all"],
										() => {},
										join(root.worktreesDir!, name),
									)
								).length
							)
								return conflict();
						},
						async (root, guard) => {
							await quiet(ref, root);
							await command(
								root,
								["worktree", "remove", ...(input.force ? ["--force"] : []), join(root.worktreesDir!, name)],
								guard,
							);
							if ((await gitTrees(root)).some((row) => row.name === name))
								throw Error("Unconfirmed worktree removal");
							return { name };
						},
						true,
					);
				},
				receipt: async (ref, input) => {
					shape(input, ["root", "requestId"]);
					check(ref, input.root);
					const current = await snapshot(),
						row = current.state.rows.find(
							(row) => row.actor === people.current(actor).id && row.id === input.requestId,
						);
					if (!row || row.root !== input.root || !same(row.ref, ref)) return deny();
					check(ref, input.root);
					return dto(row);
				},
			};
			return Object.freeze(client);
		},
	});
}
